import { z } from 'zod';
import { requireAdmin } from '@/lib/catalogue';
import { productPerformance } from '@/lib/analytics';
import { requestedMarket } from '@/lib/marketScope';
import { error, json } from '@/lib/http';

const listSchema = z.object({
  from: z.string().max(40).optional(),
  to: z.string().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export async function GET(request: Request) {
  const admin = await requireAdmin(request);
  if (!admin) return error('Not signed in', 401);
  const url = new URL(request.url);

  const market = requestedMarket(admin, url.searchParams.get('marketId'));
  if (!market.ok) return error(market.message, 403);
  const parsed = listSchema.safeParse({
    from: url.searchParams.get('from') ?? undefined,
    to: url.searchParams.get('to') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
  });
  if (!parsed.success) return error(parsed.error.issues[0]?.message ?? 'Invalid query', 422);

  const data = await productPerformance({ ...parsed.data, marketId: market.marketId });

  return json({
    data,
    meta: {
      from: parsed.data.from ?? null,
      to: parsed.data.to ?? null,
      returned: data.length,
    },
  });
}
