import { createHmac, timingSafeEqual } from 'node:crypto';
import { and, eq, inArray, or } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { notifications, orders, payments, nowText } from '@/db/schema';
import { env } from '@/lib/env';
import { publishOrderEvent } from '@/lib/orderEvents';
import { createCustomerNotification } from '@/lib/notifications';

/**
 * Signed settlement callback from the payment gateway.
 *
 * The payload is authenticated with the shared secret, never with the session:
 * a gateway has no cookie. `PAYMENT_WEBHOOK_SECRET` is required at boot, so a
 * forged request can never be compared against an empty key.
 *
 * Settlement is idempotent. A gateway that retries a delivery finds the
 * payment already succeeded and receives 200 instead of moving the order twice
 * or returning goods that were never paid for.
 */

const eventSchema = z
  .object({
    ref: z.string().trim().min(1).max(120),
    status: z.enum(['succeeded', 'failed', 'cancelled']).default('succeeded'),
    amount: z.number().int().nonnegative().optional(),
    currency: z.string().trim().min(1).max(8).optional(),
    reason: z.string().trim().max(300).optional(),
  })
  .strict();

const SETTLEABLE = ['pending', 'awaiting_approval', 'processing'] as const;

function verify(raw: string, header: string | null): boolean {
  const expected = createHmac('sha256', env.PAYMENT_WEBHOOK_SECRET).update(raw).digest('hex');
  // Gateways differ on decoration; accept the bare hex or a "sha256=" prefix.
  const given = (header ?? '').replace(/^sha256=/i, '').trim().toLowerCase();
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const raw = await request.text();
  if (!verify(raw, request.headers.get('x-signature'))) {
    return new Response('bad signature', { status: 401 });
  }

  let event: z.infer<typeof eventSchema>;
  try {
    event = eventSchema.parse(JSON.parse(raw));
  } catch {
    return new Response('bad payload', { status: 422 });
  }

  const payment = await db.query.payments.findFirst({
    where: or(eq(payments.providerRef, event.ref), eq(payments.reference, event.ref)),
  });
  // Unknown references are acknowledged: a gateway replaying an old event
  // should not keep retrying forever.
  if (!payment) return new Response('ok');

  // An amount that does not match the intent is never settled here. The
  // payment is flagged for review and the order stays where it is.
  if (
    event.status === 'succeeded' &&
    ((event.amount !== undefined && event.amount !== payment.amount) ||
      (event.currency !== undefined && event.currency !== payment.currency))
  ) {
    await db
      .update(payments)
      .set({
        failureReason: `Gateway reported ${event.currency ?? payment.currency} ${event.amount ?? payment.amount}; intent is ${payment.currency} ${payment.amount}. Not settled.`,
        updatedAt: nowText,
      })
      .where(and(eq(payments.id, payment.id), inArray(payments.status, SETTLEABLE)));
    return new Response('amount mismatch', { status: 409 });
  }

  if (event.status === 'succeeded') {
    const order = payment.orderId
      ? await db.query.orders.findFirst({ where: eq(orders.id, payment.orderId) })
      : null;

    const settlement = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(payments)
        .set({
          status: 'succeeded',
          failureReason: null,
          // The browser settlement token dies with the intent; only the
          // gateway may settle from here on.
          settlementTokenHash: null,
          updatedAt: nowText,
        })
        .where(and(eq(payments.id, payment.id), inArray(payments.status, SETTLEABLE)))
        .returning();
      if (!updated) return null;

      // Payment used to move the order to processing. It no longer does: money
      // and goods are separate axes, and the market has to confirm the goods for
      // themselves. What is still needed here is the safety check that the old
      // compare-and-set gave — that a payment has not landed on an order that is
      // no longer waiting for it. Locking the row is what makes that check mean
      // something: a confirmation racing this callback cannot slip between the
      // read and the write.
      const held = payment.orderId
        ? await tx
            .select({ status: orders.status })
            .from(orders)
            .where(eq(orders.id, payment.orderId))
            .for('update')
        : [{ status: 'pending' as const }];
      const orderWasOpen = held.length > 0 && held[0].status === 'pending';

      return { updated, orderWasPending: orderWasOpen };
    });

    if (!settlement) {
      // Already succeeded (or COD): a retry, not an error.
      const current = await db.query.payments.findFirst({ where: eq(payments.id, payment.id) });
      if (current && (current.status === 'succeeded' || current.status === 'cod')) {
        return new Response('ok');
      }
      return new Response('payment is not settleable', { status: 409 });
    }

    const { updated: settled, orderWasPending } = settlement;

    if (!orderWasPending && order) {
      // Money was captured for an order that is no longer waiting for payment —
      // usually cancelled by the stale-order sweep while the prompt was in
      // flight, or already confirmed by the market off a different attempt.
      // Flag it for a refund rather than silently keeping the cash.
      await db.insert(notifications).values({
        type: 'payment',
        marketId: order.marketId ?? null,
        title: `Refund due: ${order.reference}`,
        message: `Payment ${settled.reference} for ${settled.currency} ${settled.amount.toLocaleString('en-US')} succeeded, but order ${order.reference} is ${order.status}. Refund or investigate the duplicate payment.`,
      });

      if (order.customerId) {
        await createCustomerNotification({
          customerId: order.customerId,
          type: 'order',
          title: 'Payment received after cancellation',
          message: `We received your payment for order ${order.reference}, but the order had already been cancelled. Our team will contact you about a refund.`,
        });
      }

      return new Response('ok');
    }

    if (order?.customerId) {
      publishOrderEvent({
        // The money moved; the goods did not. The console refreshes on this and
        // the confirmation gate is what it will find waiting there.
        type: 'order.updated',
        id: order.id,
        reference: order.reference,
        from: order.status,
        to: order.status,
        total: order.total,
        currency: order.currency,
        marketId: order.marketId ?? null,
        region: order.region,
        district: order.district,
        customerName: order.customerName,
        at: order.updatedAt,
      });
      await createCustomerNotification({
        customerId: order.customerId,
        type: 'order',
        title: 'Payment received',
        message: `We received ${settled.currency} ${settled.amount.toLocaleString('en-US')} for order ${order.reference}.`,
      });
    }

    return new Response('ok');
  }

  // A failed or cancelled attempt is recorded but does not release stock on
  // its own: the customer may retry, and the stale-order sweep is what
  // eventually cancels an order nobody paid for.
  const [updated] = await db
    .update(payments)
    .set({
      status: event.status,
      failureReason: event.reason ?? `Gateway reported ${event.status}`,
      settlementTokenHash: null,
      updatedAt: nowText,
    })
    .where(and(eq(payments.id, payment.id), inArray(payments.status, SETTLEABLE)))
    .returning();

  return new Response(updated ? 'ok' : 'already settled', { status: updated ? 200 : 409 });
}
