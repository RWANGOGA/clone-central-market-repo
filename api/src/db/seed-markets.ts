import { eq, isNull } from 'drizzle-orm';
import { db } from './index';
import { markets, orders, products, suppliers } from './schema';

/**
 * Puts the first market in place and hands the existing rows to it.
 *
 * Two things have to happen together. The platform cannot have a market admin
 * until a market exists, and the catalogue cannot be scoped until every product
 * knows which market sells it. So this creates the starting market and backfills
 * the rows that predate it in one pass.
 *
 * It is idempotent: the market is found by slug, and the backfill only touches
 * rows whose `market_id` is still null. Re-running it after adding a second
 * market moves nothing, because those rows have a market by then.
 *
 * Existing admin accounts are deliberately left at `market_id = null`. That is
 * the platform tier, which is what the first seeded owner needs in order to
 * create and assign the markets; demoting them here would lock them out of the
 * very screen that lists markets.
 */

export const FIRST_MARKET = {
  name: 'Kampala Central Market',
  slug: 'kampala-central',
  district: 'Kampala',
  region: 'Central Region',
};

async function seedMarkets() {
  const existing = await db.query.markets.findFirst({
    where: eq(markets.slug, FIRST_MARKET.slug),
  });

  const market =
    existing ??
    (await db.insert(markets).values({ ...FIRST_MARKET, active: true }).returning())[0];

  if (!existing) console.log(`Created ${market.name} (id ${market.id}).`);
  else console.log(`${market.name} already exists (id ${market.id}).`);

  const counts = { products: 0, orders: 0, suppliers: 0 };

  // `returning` on an UPDATE reports the rows it changed, so the tally is the
  // backfill's own evidence rather than a second query that could race it.
  const movedProducts = await db
    .update(products)
    .set({ marketId: market.id })
    .where(isNull(products.marketId))
    .returning({ id: products.id });
  counts.products = movedProducts.length;

  const movedOrders = await db
    .update(orders)
    .set({ marketId: market.id })
    .where(isNull(orders.marketId))
    .returning({ id: orders.id });
  counts.orders = movedOrders.length;

  const movedSuppliers = await db
    .update(suppliers)
    .set({ marketId: market.id })
    .where(isNull(suppliers.marketId))
    .returning({ id: suppliers.id });
  counts.suppliers = movedSuppliers.length;

  console.log(
    `Backfilled ${counts.products} product(s), ${counts.orders} order(s) and ` +
      `${counts.suppliers} supplier(s) onto ${market.slug}.`,
  );

  const all = await db.select({ id: markets.id, slug: markets.slug }).from(markets);
  console.log(`${all.length} market(s) on the platform.`);
}

seedMarkets()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Market seed failed:', err);
    process.exit(1);
  });
