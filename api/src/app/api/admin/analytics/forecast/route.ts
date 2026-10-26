import { requireAdmin } from '@/lib/catalogue';
import { forecast } from '@/lib/analytics';
import { requestedMarket } from '@/lib/marketScope';
import { error, json } from '@/lib/http';

export async function GET(request: Request) {
  const admin = await requireAdmin(request);

  const url = new URL(request.url);
  if (!admin) return error('Not signed in', 401);
  const market = requestedMarket(admin, url.searchParams.get('marketId'));
  if (!market.ok) return error(market.message, 403);


  const data = await forecast({ marketId: market.marketId });

  return json({
    data,
    meta: {
      generatedAt: new Date().toISOString(),
      note: 'Forecast is a trailing average, not a prediction. Seasonality flags must be entered by staff.',
    },
  });
}
