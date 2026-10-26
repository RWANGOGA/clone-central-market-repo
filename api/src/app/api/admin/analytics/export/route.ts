import { z } from 'zod';
import { requireAdmin } from '@/lib/catalogue';
import { requestedMarket } from '@/lib/marketScope';
import { salesTrend, productPerformance, regionalDemand } from '@/lib/analytics';
import { listActivity } from '@/lib/activity';
import { toCsv } from '@/lib/analytics';
import { error } from '@/lib/http';

const sourceSchema = z.enum(['sales', 'products', 'regions', 'activity']);

export async function GET(request: Request) {
  const admin = await requireAdmin(request);
  if (!admin) return error('Not signed in', 401);

  const url = new URL(request.url);

  // A CSV is the easiest way to hand another market's book to someone who
  // should not have it, so the export is narrowed exactly like the screen.
  const market = requestedMarket(admin, url.searchParams.get('marketId'));
  if (!market.ok) return error(market.message, 403);
  const marketId = market.marketId;
  const parsed = sourceSchema.safeParse(url.searchParams.get('source') ?? 'sales');
  if (!parsed.success) return error('source must be one of: sales, products, regions, activity', 422);

  const source = parsed.data;
  const from = url.searchParams.get('from') ?? undefined;
  const to = url.searchParams.get('to') ?? undefined;

  let rows: Record<string, unknown>[] = [];
  let filename = `${source}-export.csv`;

  switch (source) {
    case 'sales': {
      const bucket = z
        .enum(['day', 'week', 'month'])
        .safeParse(url.searchParams.get('bucket') ?? 'day');
      if (!bucket.success) return error('bucket must be one of: day, week, month', 422);
      rows = await salesTrend({ from, to, bucket: bucket.data, marketId });
      filename = `sales-${bucket.data}-${from ?? 'all'}-${to ?? 'all'}.csv`;
      break;
    }
    case 'products': {
      rows = await productPerformance({ from, to, marketId });
      filename = `products-${from ?? 'all'}-${to ?? 'all'}.csv`;
      break;
    }
    case 'regions': {
      rows = await regionalDemand({ from, to, marketId });
      filename = `regions-${from ?? 'all'}-${to ?? 'all'}.csv`;
      break;
    }
    case 'activity': {
      const result = await listActivity({ from, to, limit: 1000, admin });
      rows = result.rows.map((row) => ({
        id: row.id,
        action: row.action,
        entity: row.entity,
        entityId: row.entityId,
        adminEmail: row.adminEmail,
        createdAt: row.createdAt,
      }));
      filename = `activity-${from ?? 'all'}-${to ?? 'all'}.csv`;
      break;
    }
  }

  return toCsv(rows, filename);
}
