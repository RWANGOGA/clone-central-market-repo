import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { nowText, orderItems, orders, payments, products } from '@/db/schema';
import { error, json } from '@/lib/http';
import { csrfCheck } from '@/lib/security';
import { ownsOrder } from '@/lib/orderOwnership';
import { allow } from '@/lib/rateLimit';
import { getClientIp } from '@/lib/clientIp';
import { recordMovement } from '@/lib/stockLedger';
import { StockConflict } from '@/lib/stockErrors';
import { priceCart } from '@/lib/pricing';
import { findPromoForUpdate, promoDiscountFor } from '@/lib/promotions';
import { publishOrderEvent } from '@/lib/orderEvents';
import { createCustomerNotification } from '@/lib/notifications';

/**
 * Add one more item to an order that has not been paid for yet.
 *
 * The testers could not do this at all (Task 5, three participants, three
 * failures). It was not a missing button: `POST /api/orders` converts the cart
 * and draws stock down in the same transaction, so by the time a buyer stands
 * on the payment step there is no basket left to edit — there is an order, with
 * reserved stock, a spent promo redemption and a payment intent whose amount is
 * a copy of `orders.total`. Editing at that point means editing the order, in
 * the same unit of work, with the same money rules.
 *
 * Three limits carry over from order creation rather than being reinvented:
 *   - one order, one market, or no single admin is answerable for the goods;
 *   - stock is reserved on the write, through the ledger, not on payment;
 *   - the price is copied from the product at write time.
 *
 * What closes the basket is payment, not navigation. `orders.status` says where
 * the goods are; whether money has changed hands is read from `payments`, so
 * the lock is expressed on the axis that actually holds that fact.
 */

type Ctx = { params: Promise<{ id: string }> };

const addItemSchema = z
  .object({
    productId: z.number().int().positive(),
    quantity: z.number().int().min(1).max(500),
  })
  .strict();

/** The same ceiling a basket line may reach in the cart. */
const LINE_LIMIT = 500;

export async function POST(request: Request, { params }: Ctx) {
  const blocked = csrfCheck(request);
  if (blocked) return blocked;

  const parsed = addItemSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return error(parsed.error.issues[0]?.message ?? 'Invalid payload', 422);
  const { productId, quantity } = parsed.data;

  // An id or a reference both address an order here, as they do on the tracking
  // page the buyer is one tap away from.
  const { id } = await params;
  const key = Number(id);
  const order = await db.query.orders.findFirst({
    where: Number.isInteger(key) && key > 0 ? eq(orders.id, key) : eq(orders.reference, id),
  });
  if (!order) return error('Order not found', 404);

  // A tracking link proves who may look; it is the same proof this route
  // accepts, because the buyer standing at the payment step is exactly the
  // person holding that link. Anyone else gets the answer a stranger gets.
  if (!(await ownsOrder(request, order))) return error('Order not found', 404);

  const ip = getClientIp(request);
  if (ip && !(await allow(`order-topup-ip:${ip}`, 30, 60 * 60))) {
    return error('Too many changes to orders from this connection. Please wait a moment.', 429);
  }
  if (!(await allow(`order-topup:${order.id}`, 20, 60 * 60))) {
    return error('This order has been changed too many times. Please contact the market.', 429);
  }

  let result: {
    totals: ReturnType<typeof priceCart>;
    added: { productId: number; name: string; unit: string; quantity: number };
    lineCount: number;
    updated: typeof orders.$inferSelect;
  };
  try {
    result = await db.transaction(async (tx) => {
      // Compare-and-set on the status, first statement in the transaction, so a
      // payment settling at this same instant cannot leave a paid order holding
      // goods nobody charged for. Anything past pending is closed for changes.
      const [held] = await tx
        .update(orders)
        .set({ updatedAt: nowText })
        .where(and(eq(orders.id, order.id), eq(orders.status, 'pending')))
        .returning({ id: orders.id });
      if (!held) throw new Error('NOT_PENDING');

      const settled = await tx
        .select({ id: payments.id })
        .from(payments)
        .where(
          and(eq(payments.orderId, order.id), inArray(payments.status, ['succeeded', 'cod'])),
        )
        .limit(1);
      if (settled.length > 0) throw new Error('ALREADY_PAID');

      const product = await tx.query.products.findFirst({ where: eq(products.id, productId) });
      if (!product) throw new Error('PRODUCT_NOT_FOUND');
      if (!product.active) throw new Error(`PRODUCT_INACTIVE:${product.name}`);

      // The order's market was chosen by its first line, not by this request.
      if (order.marketId === null || product.marketId !== order.marketId) throw new Error('MIXED_MARKETS');

      const lines = await tx.select().from(orderItems).where(eq(orderItems.orderId, order.id));

      // Merge into an existing line only while it carries the price this add is
      // being charged at. A product whose price moved since the order was
      // placed gets a second line rather than a silent reprice of the first,
      // so the order keeps showing both what was agreed and what was added.
      const existing = lines.find(
        (line) => line.productId === product.id && line.priceValue === product.priceValue,
      );
      const nextQuantity = (existing?.quantity ?? 0) + quantity;
      if (nextQuantity > LINE_LIMIT) throw new Error(`LINE_LIMIT:${product.name}`);

      try {
        await recordMovement(
          {
            productId: product.id,
            delta: -quantity,
            reason: 'sale',
            reference: order.reference,
            actorLabel: 'customer',
          },
          tx,
        );
      } catch (err) {
        if (!(err instanceof StockConflict)) throw err;
        // The ledger knows the id, not the name it would have to report.
        throw new StockConflict(product.id, product.name);
      }

      if (existing) {
        await tx
          .update(orderItems)
          .set({ quantity: nextQuantity, lineTotal: product.priceValue * nextQuantity })
          .where(eq(orderItems.id, existing.id));
      } else {
        await tx.insert(orderItems).values({
          orderId: order.id,
          productId: product.id,
          name: product.name,
          priceValue: product.priceValue,
          quantity,
          lineTotal: product.priceValue * quantity,
        });
      }

      // Re-read rather than hand-arithmetic the lines above: the totals on the
      // order must always equal what the order actually contains.
      const current = await tx
        .select({ lineTotal: orderItems.lineTotal })
        .from(orderItems)
        .where(eq(orderItems.orderId, order.id));
      const subtotal = current.reduce((sum, line) => sum + line.lineTotal, 0);

      // A code claimed when the order was placed stays claimed. Only its
      // arithmetic is re-run, so a percentage follows the basket up, while a
      // code that has since expired or run out cannot revoke a discount the
      // customer already earned. If the row has gone, the discount stands.
      let discount = order.discount;
      if (order.promoCode) {
        const promo = await findPromoForUpdate(tx, order.promoCode);
        if (promo) discount = promoDiscountFor(promo, subtotal);
      }

      const totals = priceCart(subtotal, discount);
      const [updated] = await tx
        .update(orders)
        .set({
          subtotal: totals.subtotal,
          discount: totals.discount,
          shipping: totals.shipping,
          tax: totals.tax,
          total: totals.total,
          updatedAt: nowText,
        })
        .where(eq(orders.id, order.id))
        .returning();

      // The intent's amount was copied from the old total, so a prompt still
      // waiting for approval would take the wrong money for this basket. Its
      // settlement token goes with it. Attempts already with the gateway for
      // charging are left alone, exactly as a newer attempt leaves them alone.
      await tx
        .update(payments)
        .set({
          status: 'cancelled',
          failureReason: 'Basket changed',
          settlementTokenHash: null,
          updatedAt: nowText,
        })
        .where(
          and(eq(payments.orderId, order.id), inArray(payments.status, ['pending', 'awaiting_approval'])),
        );

      return {
        totals,
        added: { productId: product.id, name: product.name, unit: product.unit, quantity },
        lineCount: current.length,
        updated,
      };
    });
  } catch (err) {
    if (err instanceof StockConflict) {
      return json(
        {
          error: `There is not enough ${err.productName ?? 'stock'} left to add that to this order.`,
          conflict: { productId: err.productId, product: err.productName },
        },
        { status: 409 },
      );
    }
    if (err instanceof Error && err.message === 'NOT_PENDING') {
      return error('This order is no longer open for changes.', 409);
    }
    if (err instanceof Error && err.message === 'ALREADY_PAID') {
      return error('Payment is already confirmed for this order, so the basket is closed.', 409);
    }
    if (err instanceof Error && err.message === 'PRODUCT_NOT_FOUND') return error('Product not found', 404);
    if (err instanceof Error && err.message.startsWith('PRODUCT_INACTIVE:')) {
      return error(`${err.message.slice('PRODUCT_INACTIVE:'.length)} is no longer available`, 409);
    }
    if (err instanceof Error && err.message === 'MIXED_MARKETS') {
      return error(
        'One order can only come from one market. Add it to a new basket and order them separately.',
        422,
      );
    }
    if (err instanceof Error && err.message.startsWith('LINE_LIMIT:')) {
      return error(`${err.message.slice('LINE_LIMIT:'.length)} is limited to ${LINE_LIMIT} per order`, 409);
    }
    throw err;
  }

  const { totals, added, lineCount, updated } = result;

  // The console is watching this order's total, so it hears about the change the
  // same way it hears about a status move. No fulfilment state changed here.
  publishOrderEvent({
    type: 'order.updated',
    id: order.id,
    reference: order.reference,
    from: updated.status,
    to: updated.status,
    total: totals.total,
    currency: updated.currency,
    marketId: updated.marketId,
    region: updated.region,
    district: updated.district,
    customerName: updated.customerName,
    at: updated.updatedAt,
  });

  if (order.customerId) {
    await createCustomerNotification({
      customerId: order.customerId,
      type: 'order',
      title: 'Item added to your order',
      message: `${added.name} × ${added.quantity}${added.unit} was added to ${order.reference}. The new total is ${updated.currency} ${totals.total.toLocaleString('en-US')}.`,
    });
  }

  return json({
    data: {
      id: order.id,
      reference: order.reference,
      status: updated.status,
      total: totals.total,
      currency: updated.currency,
    },
    totals,
    meta: { added, lineCount },
  }, { status: 201 });
}
