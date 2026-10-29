import { and, eq } from 'drizzle-orm';
import { admins, markets } from './schema';
import { db } from './index';
import { hashPassword } from '@/lib/password';

/**
 * Creates the first admin from the environment.
 *
 * The credential is never committed. If ADMIN_EMAIL or ADMIN_PASSWORD is
 * missing the script explains what to do and exits without touching the
 * database, so there is no default account to accidentally ship.
 *
 * The account it creates is a `super`: the platform, not a market. That is the
 * role the console needs in order to open markets and appoint their owners, and
 * the seeder is the only place a super can come from on a fresh database.
 *
 * Optionally, with SEED_MARKET_OWNERS=1, it also puts one `owner` in every
 * market that has none. That exists for local and demo databases, where a
 * single platform account makes the market boundary invisible: nobody signing in
 * can see what a Nakasero admin is not supposed to see. Those owners share
 * ADMIN_PASSWORD, so the flag is deliberately off by default.
 */

async function seedMarketOwners(passwordHash: string, domain: string) {
  const rows = await db
    .select({ id: markets.id, slug: markets.slug, name: markets.name })
    .from(markets)
    .orderBy(markets.id);

  const created: string[] = [];

  for (const market of rows) {
    // A market that already runs its own owner keeps it. This seeds the missing
    // boundary, it does not overwrite somebody's choice.
    const [owner] = await db
      .select({ id: admins.id })
      .from(admins)
      .where(and(eq(admins.marketId, market.id), eq(admins.role, 'owner')))
      .limit(1);
    if (owner) continue;

    const email = `owner.${market.slug}@${domain}`;
    const [clash] = await db.select({ id: admins.id }).from(admins).where(eq(admins.email, email)).limit(1);
    if (clash) continue;

    await db.insert(admins).values({
      email,
      name: `Owner — ${market.name}`,
      passwordHash,
      role: 'owner',
      marketId: market.id,
    });
    created.push(`${email} (${market.name})`);
  }

  return created;
}

async function seedAdmin() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME?.trim() || 'Platform Admin';
  const seedOwners = process.env.SEED_MARKET_OWNERS === '1';

  if (!email || !password) {
    console.error(
      [
        '',
        'No admin credentials supplied, so nothing was created.',
        '',
        'Set these in api/.env.local and run the command again:',
        '',
        '  ADMIN_EMAIL=you@example.com',
        '  ADMIN_PASSWORD=a-password-of-at-least-10-characters',
        '  ADMIN_NAME=Your Name          # optional',
        '  SEED_MARKET_OWNERS=1          # optional: give every market its own',
        '                                # owner, all on ADMIN_PASSWORD. For a',
        '                                # local or demo database, never live.',
        '',
        'There is deliberately no default account.',
        '',
      ].join('\n'),
    );
    process.exit(1);
  }

  if (password.length < 10) {
    console.error('ADMIN_PASSWORD must be at least 10 characters. Nothing was created.');
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);
  const existing = await db.query.admins.findFirst({ where: eq(admins.email, email) });

  if (existing) {
    console.log(`A ${existing.role} already exists for ${email}. Nothing changed.`);
    console.log('To change the password, update the hash directly rather than re-running this.');
  } else {
    await db.insert(admins).values({
      email,
      name,
      passwordHash,
      role: 'super',
    });
    console.log(`Created super admin ${email}.`);
  }

  if (seedOwners) {
    const at = email.indexOf('@');
    if (at < 0) {
      console.error(
        'ADMIN_EMAIL carries no domain to build owner addresses from, so no market owner was seeded.',
      );
    } else {
      const owners = await seedMarketOwners(passwordHash, email.slice(at + 1));
      if (owners.length === 0) {
        console.log('Every market already has an owner, or the platform has no markets yet.');
      } else {
        // Addresses only. The password is the one already in the environment.
        console.log(`Seeded ${owners.length} market owner(s), each on ADMIN_PASSWORD:`);
        for (const line of owners) console.log(`  ${line}`);
      }
    }
  }

  const all = await db.select({ email: admins.email, role: admins.role }).from(admins);
  console.log(`${all.length} admin account(s) exist.`);
}

seedAdmin()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Admin seed failed:', err);
    process.exit(1);
  });
