import { z } from 'zod';
import { requireAdmin } from '@/lib/catalogue';
import { listActivity } from '@/lib/activity';
import { requestedMarket } from '@/lib/marketScope';
import { error, json } from '@/lib/http';

const listSchema = z.object({
  adminId: z.coerce.number().int().positive().optional(),
  action: z.string().max(120).optional(),
  entity: z.string().max(120).optional(),
  from: z.string().max(40).optional(),
  to: z.string().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export async function GET(request: Request) {
  const admin = await requireAdmin(request);
  if (!admin) return error('Not signed in', 401);
  const url = new URL(request.url);

  const market = requestedMarket(admin, url.searchParams.get('marketId'));
  if (!market.ok) return error(market.message, 403);
  const parsed = listSchema.safeParse({
    adminId: url.searchParams.get('adminId') ?? undefined,
    action: url.searchParams.get('action') ?? undefined,
    entity: url.searchParams.get('entity') ?? undefined,
    from: url.searchParams.get('from') ?? undefined,
    to: url.searchParams.get('to') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
    offset: url.searchParams.get('offset') ?? undefined,
  });
  if (!parsed.success) return error(parsed.error.issues[0]?.message ?? 'Invalid query', 422);

  const { rows, total } = await listActivity({ ...parsed.data, admin });

  return json({
    data: rows,
    meta: { total, ...parsed.data },
  });
}
