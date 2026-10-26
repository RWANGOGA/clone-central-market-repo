import { z } from 'zod';
import { requireAdmin } from '@/lib/catalogue';
import { overview } from '@/lib/analytics';
import { requestedMarket } from '@/lib/marketScope';
import { error, json } from '@/lib/http';

const querySchema = z.object({
  from: z.string().max(40).optional(),
  to: z.string().max(40).optional(),
});

/**
 * One round trip for the staff dashboard. The individual endpoints stay for
 * charts and exports; this is the summary a manager opens first.
 */
export async function GET(request: Request) {
  const admin = await requireAdmin(request);
  if (!admin) return error('Not signed in', 401);
  const url = new URL(request.url);

  const market = requestedMarket(admin, url.searchParams.get('marketId'));
  if (!market.ok) return error(market.message, 403);
  const parsed = querySchema.safeParse({
    from: url.searchParams.get('from') ?? undefined,
    to: url.searchParams.get('to') ?? undefined,
  });
  if (!parsed.success) return error(parsed.error.issues[0]?.message ?? 'Invalid query', 422);

  const data = await overview({ ...parsed.data, marketId: market.marketId });

  return json({
    data,
    meta: {
      from: parsed.data.from ?? null,
      to: parsed.data.to ?? null,
    },
  });
}
