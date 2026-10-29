import { randomBytes, timingSafeEqual } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { orders, payments, nowText } from '@/db/schema';
import {
  PAYMENT_METHODS,
  detectMobileMoneyProvider,
  approvalInstructions,
  article,
  toPaymentDto,
} from '@/lib/payments';
import { createSessionToken, hashToken } from '@/lib/password';
import { error, json } from '@/lib/http';
import { requireCart } from '@/lib/cartOwnership';
import { ownsOrder } from '@/lib/orderOwnership';
import { allow } from '@/lib/rateLimit';
import { csrfCheck } from '@/lib/security';
import { publishOrderEvent } from '@/lib/orderEvents';
import { createCustomerNotification } from '@/lib/notifications';
import { markOrderProcessing } from '@/lib/orderLifecycle';

/**
 * Create a payment intent for an order.
 *
 * The order is created first and the amount is read from it, never from the
 * request. Card details are deliberately not accepted: the browser must use
 * the gateway's hosted page so the card number never touches this server.
 */
const createSchema = z
  .object({
    cartId: z.number().int().positive(),
    orderReference: z.string().trim().min(4).max(40),
    channel: z.enum(['mobile_money', 'card', 'wallet', 'cod']),
    provider: z.string().trim().min(1).max(60),
    payerName: z.string().trim().min(1).max(120).optional(),
    payerPhone: z.string().trim().max(32).optional(),
    walletId: z.string().trim().max(120).optional(),
  })
  .strict();

function makeReference() {
  return `PAY-${randomBytes(5).toString('hex').toUpperCase()}`;
}

export async function POST(request: Request) {
  const blocked = csrfCheck(request);
  if (blocked) return blocked;
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return error(parsed.error.issues[0]?.message ?? 'Invalid payload', 422);
  }

  const { cartId, orderReference, channel, provider, payerName, payerPhone, walletId } = parsed.data;

  if (channel === 'card') {
    return error(
      'Card details are never sent to this server. Pay by card on the payment gateway’s hosted page.',
      422,
    );
  }

  const cart = await requireCart(request, cartId);
  if (!cart) return error('Cart not found', 404);

  // Cart ownership is the proof here: the reference is useless without the
  // mk_cart cookie, and the order must belong to that same cart. The tracking
  // cookie is scoped to /api/orders, so guests cannot present it at this path.
  const order = await db.query.orders.findFirst({
    where: and(eq(orders.reference, orderReference), eq(orders.cartId, cartId)),
  });
  if (!order) return error('Order not found', 404);
  if (order.status !== 'pending') return error('This order is not awaiting payment.', 409);

  if (!(await allow(`payment-intent-order:${order.id}`, 10, 60 * 60))) {
    return error('Too many payment attempts for this order. Try again later.', 429);
  }

  const settled = await db
    .select({ id: payments.id })
    .from(payments)
    .where(and(eq(payments.orderId, order.id), inArray(payments.status, ['succeeded', 'cod'])));
  if (settled.length > 0) {
    return error('This order is already paid or marked for cash on delivery.', 409);
  }

  // Validate the instrument for the chosen channel. The amount is the order's
  // frozen total, so a price change after checkout cannot alter what is due.
  let providerRef: string | null = null;
  let status: (typeof payments.$inferInsert)['status'] = 'pending';
  let normalisedPhone: string | null = null;

  if (channel === 'mobile_money') {
    const known = PAYMENT_METHODS.mobile_money.find((m) => m.id === provider);
    if (!known) return error(`Unknown mobile money provider "${provider}"`, 422);
    if (!payerPhone) return error('A mobile money number is required', 422);

    const local = payerPhone.replace(/[\s()-]/g, '').replace(/^\+?256/, '0');
    if (!/^07\d{8}$/.test(local)) {
      return error('Enter a Ugandan mobile money number, for example 0772 123 456', 422);
    }

    // A number must match the network it is being paid from.
    const detected = detectMobileMoneyProvider(local);
    if (detected !== provider) {
      const detectedLabel = PAYMENT_METHODS.mobile_money.find((m) => m.id === detected)?.label;
      return error(
        detectedLabel
          ? `That number is ${article(detectedLabel)} ${detectedLabel} number. Choose ${detectedLabel} as the provider.`
          : `That number does not match ${known.label}.`,
        422,
      );
    }

    normalisedPhone = local;
    status = 'awaiting_approval';
    providerRef = `${known.id}-${randomBytes(5).toString('hex')}`;
  } else if (channel === 'wallet') {
    if (!walletId) return error('A wallet identifier is required', 422);
    if (!/^[A-Za-z0-9]{3,}(@[A-Za-z0-9.-]+)?$/.test(walletId)) {
      return error('Enter a wallet number, or an address like allen@stanbic', 422);
    }
    status = 'awaiting_approval';
    providerRef = `wallet-${randomBytes(5).toString('hex')}`;
  } else {
    // Cash on delivery is a confirmed channel with no instrument and no
    // approval step; the rider collects and staff mark it collected.
    status = 'cod';
    providerRef = `cod-${randomBytes(5).toString('hex')}`;
  }

  const simulateSettlement = process.env.NODE_ENV !== 'production';
  const { token: settlementToken, tokenHash: settlementTokenHash } = createSessionToken();

  const payment = await db.transaction(async (tx) => {
    // A newer attempt supersedes anything still waiting for approval, so an
    // abandoned prompt cannot settle an order that has since been paid another
    // way. Attempts already with the gateway for charging are left alone.
    await tx
      .update(payments)
      .set({
        status: 'cancelled',
        failureReason: 'Superseded by a newer payment attempt',
        settlementTokenHash: null,
        updatedAt: nowText,
      })
      .where(and(eq(payments.orderId, order.id), inArray(payments.status, ['pending', 'awaiting_approval'])));

    const [row] = await tx
      .insert(payments)
      .values({
        reference: makeReference(),
        orderId: order.id,
        cartId,
        channel,
        provider,
        status,
        amount: order.total,
        currency: order.currency,
        payerName: payerName ?? null,
        payerPhone: normalisedPhone,
        walletId: channel === 'wallet' ? walletId ?? null : null,
        providerRef,
        settlementTokenHash: simulateSettlement ? settlementTokenHash : null,
      })
      .returning();

    if (channel === 'cod') {
      const moved = await markOrderProcessing(
        tx,
        order.id,
        'Cash on delivery confirmed',
        'customer',
      );
      if (!moved) throw new Error('ORDER_NOT_PENDING');
    }

    return row;
  }).catch((err) => {
    if (err instanceof Error && err.message === 'ORDER_NOT_PENDING') return null;
    throw err;
  });

  if (!payment) return error('This order is not awaiting payment.', 409);

  if (channel === 'cod' && order.customerId) {
    publishOrderEvent({
      type: 'order.status',
      id: order.id,
      reference: order.reference,
      from: 'pending',
      to: 'processing',
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
      title: 'Order confirmed',
      message: `Order ${order.reference} is confirmed for cash on delivery.`,
    });
  }

  return json(
    {
      data: {
        ...toPaymentDto(payment),
        orderReference: order.reference,
        // Returned once, and only where the simulated settlement endpoint is
        // enabled. A production deployment settles from the gateway webhook.
        ...(simulateSettlement ? { settlementToken } : {}),
        nextAction: { channel, provider, status, ...approvalInstructions(channel, provider) },
      },
      totals: {
        subtotal: order.subtotal,
        discount: order.discount,
        promoCode: order.promoCode,
        shipping: order.shipping,
        tax: order.tax,
        total: order.total,
        currency: order.currency,
      },
    },
    { status: 201 },
  );
}

/**
 * Report the outcome of an intent (development only).
 *
 * Mobile money approval is asynchronous. Until a real gateway is wired in,
 * the browser that opened the intent reports the result. Production is refused
 * outright: there, only a signed webhook may settle a payment. The settlement
 * token proves this browser opened the intent and is cleared on use, so a
 * reference on its own is not enough.
 */
export async function PATCH(request: Request) {
  if (process.env.NODE_ENV === 'production') {
    return error('Simulated settlement is disabled in production. Use the gateway webhook.', 404);
  }

  const blocked = csrfCheck(request);
  if (blocked) return blocked;

  const parsed = z
    .object({
      reference: z.string().min(1).max(40),
      status: z.enum(['succeeded', 'failed', 'cancelled']),
      settlementToken: z.string().min(1).max(200),
      failureReason: z.string().max(300).optional(),
    })
    .strict()
    .safeParse(await request.json().catch(() => null));

  if (!parsed.success) return error('Invalid payload', 422);
  const { reference, status, settlementToken, failureReason } = parsed.data;

  const payment = await db.query.payments.findFirst({ where: eq(payments.reference, reference) });
  if (!payment) return error('Payment not found', 404);

  const [cart, order] = await Promise.all([
    payment.cartId ? requireCart(request, payment.cartId) : Promise.resolve(null),
    payment.orderId
      ? db.query.orders.findFirst({ where: eq(orders.id, payment.orderId) })
      : Promise.resolve(null),
  ]);
  const orderOwner = order ? await ownsOrder(request, order) : false;
  if (!cart && !orderOwner) return error('Payment not found', 404);

  // Compare in constant time and treat a missing hash the same as a mismatch,
  // so an already-settled intent cannot be told apart from a wrong token.
  const presented = Buffer.from(hashToken(settlementToken), 'hex');
  const stored = payment.settlementTokenHash ? Buffer.from(payment.settlementTokenHash, 'hex') : Buffer.alloc(0);

  if (presented.length !== stored.length || !timingSafeEqual(presented, stored)) {
    return error(
      'This browser did not open the payment. The settlement token is missing or does not match.',
      403,
    );
  }

  if (payment.status === 'succeeded' || payment.status === 'cod') {
    return error(`Payment ${reference} is already settled`, 409);
  }

  if (status === 'succeeded') {
    const result = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(payments)
        .set({
          status: 'succeeded',
          failureReason: null,
          settlementTokenHash: null,
          updatedAt: nowText,
        })
        .where(
          and(
            eq(payments.id, payment.id),
            inArray(payments.status, ['pending', 'awaiting_approval', 'processing']),
          ),
        )
        .returning();
      if (!updated) return null;

      if (payment.orderId) {
        await markOrderProcessing(
          tx,
          payment.orderId,
          `Payment ${payment.reference} confirmed`,
          'customer',
        );
      }

      return updated;
    });

    if (!result) return error(`Payment ${reference} is already settled`, 409);

    if (order?.customerId) {
      publishOrderEvent({
        type: 'order.status',
        id: order.id,
        reference: order.reference,
        from: order.status,
        to: 'processing',
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
        message: `We received ${result.currency} ${result.amount.toLocaleString('en-US')} for order ${order.reference}.`,
      });
    }

    return json({ data: toPaymentDto(result) });
  }

  // A failed or cancelled attempt is closed, but the order stays pending so
  // the customer can retry with another channel. An order nobody pays for is
  // released by the stale-order sweep, which also returns its stock.
  const result = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(payments)
      .set({
        status,
        failureReason: failureReason ?? null,
        settlementTokenHash: null,
        updatedAt: nowText,
      })
      .where(
        and(
          eq(payments.id, payment.id),
          inArray(payments.status, ['pending', 'awaiting_approval', 'processing']),
        ),
      )
      .returning();

    return updated ?? null;
  });

  if (!result) return error(`Payment ${reference} is already settled`, 409);

  return json({ data: toPaymentDto(result) });
}
