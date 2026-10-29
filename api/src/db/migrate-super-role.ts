import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { admins } from './schema';
import { db } from './index';

/**
 * Turns the platform tier into a role instead of an accident.
 *
 * Until `super` existed, "sees every market" was carried by `market_id IS NULL`
 * alone, and the most senior account in a fresh database was an ordinary owner
 * that happened to hold no market. This moves those rows onto the role that
 * means the same thing, so the two axes of the access model agree.
 *
 * Run it before anything that reads the role as authoritative. It is idempotent:
 * a second pass finds nothing to promote and only repeats the audit.
 *
 * `admins.role` is a plain text column: the allowed values are declared in the
 * TypeScript schema only, and the live database carries no CHECK on the column
 * (confirmed against `pg_constraint` for `admins`), so widening the role needs
 * no DDL — this update is the whole migration.
 */

async function migrate() {
  console.log('Promoting unscoped owners to super admin...');

  const promoted = await db
    .update(admins)
    .set({ role: 'super' })
    .where(and(isNull(admins.marketId), eq(admins.role, 'owner')))
    .returning({ id: admins.id, email: admins.email });

  for (const row of promoted) console.log(`  ${row.email} -> super`);
  console.log(`  ${promoted.length} account(s) promoted.`);

  // Two ways a row can still contradict the model. Neither is rewritten here:
  // guessing a market for a super, or a role for an unscoped account, is a
  // decision for whoever owns the platform.
  const pinnedSuper = await db
    .select({ email: admins.email, marketId: admins.marketId })
    .from(admins)
    .where(and(eq(admins.role, 'super'), isNotNull(admins.marketId)));

  const unscoped = await db
    .select({ email: admins.email, role: admins.role })
    .from(admins)
    .where(and(isNull(admins.marketId), eq(admins.active, true)));
  const unscopedUnderSuper = unscoped.filter((row) => row.role !== 'super');

  if (pinnedSuper.length === 0 && unscopedUnderSuper.length === 0) {
    console.log('Every active super holds no market, and every account with no market is a super.');
    return;
  }

  for (const row of pinnedSuper) {
    console.error(
      `  ${row.email} is a super pinned to market ${row.marketId}: it will not be treated as the platform. Move it off that market or demote it.`,
    );
  }
  for (const row of unscopedUnderSuper) {
    console.error(
      `  ${row.email} is a ${row.role} with no market, so it reads every market. Pin it to the one it runs.`,
    );
  }
  console.error('Unresolved rows remain, so the account table is not yet consistent.');
  process.exit(1);
}

migrate()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Super-role migration failed:', err);
    process.exit(1);
  });
