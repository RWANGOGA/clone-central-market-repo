import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { districts, regions } from '@/db/schema';
import { error, json } from '@/lib/http';
import { allow } from '@/lib/rateLimit';
import { getClientIp } from '@/lib/clientIp';
import {
  parseDistrictFeatures,
  reverseDistrict,
  withinUganda,
  type DistrictShape,
} from '@/lib/geoReverse';

/**
 * "Use my current location" — turn a lat/lng into a district.
 *
 * The buyer's third finding was that picking a delivery location by drilling
 * five dropdowns is slow and easy to get wrong. This reads the repository's own
 * ADM2 boundary file, finds the polygon the pin falls inside, and answers at the
 * only precision the data supports: the district. The region comes from the
 * district register when the matched shape is a real registered district.
 *
 * It never guesses below ADM2, and a pin that lands in no polygon is a 404 with
 * `fallback: 'manual'` so the client keeps the cascade rather than storing a
 * wrong answer.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
// this file lives at api/src/app/api/geo/reverse/route.ts, so api/ is five up.
const districtFile = path.resolve(here, '../../../../../data/geo/districts.geojson');

// The boundary layer is static within a deploy, so it is parsed once and kept
// as shapes rather than re-read and re-walked on every request.
let cache: { shapes: DistrictShape[] } | null = null;

function shapes(): DistrictShape[] {
  if (cache) return cache.shapes;
  let raw: unknown = null;
  try {
    raw = JSON.parse(fs.readFileSync(districtFile, 'utf8'));
  } catch {
    raw = null;
  }
  cache = { shapes: parseDistrictFeatures(raw) };
  return cache.shapes;
}

function num(value: string | null): number | null {
  if (value === null || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** The region a matched district belongs to, when it is a registered one. */
async function regionForDistrict(name: string): Promise<string | null> {
  const rows = await db
    .select({ region: regions.name })
    .from(districts)
    .innerJoin(regions, eq(regions.id, districts.regionId))
    .where(and(eq(districts.name, name)))
    .limit(1);
  return rows[0]?.region ?? null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const lat = num(url.searchParams.get('lat'));
  const lng = num(url.searchParams.get('lng'));

  if (lat === null || lng === null) {
    return error('A reverse lookup needs a numeric lat and lng.', 422);
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return error('That coordinate is not on the map.', 422);
  }
  if (!withinUganda(lat, lng)) {
    return error('This service only locates delivery points inside Uganda.', 422);
  }

  // Reverse lookups are cheap CPU but enumerable, so throttle by connection.
  const ip = getClientIp(request);
  if (ip && !(await allow(`geo-reverse:${ip}`, 60, 60 * 60))) {
    return error('Too many location lookups from this connection. Please wait a moment.', 429);
  }

  const district = reverseDistrict(shapes(), lat, lng);
  if (!district) {
    // Not a failure of the browser — the pin is simply outside every outline we
    // hold. The client should keep the manual cascade for this one.
    return new Response(
      JSON.stringify({ error: 'No mapped district covers that point.', fallback: 'manual' }),
      { status: 404, headers: { 'content-type': 'application/json' } },
    );
  }

  const region = await regionForDistrict(district);

  return json({
    data: {
      region,
      district,
      lat,
      lng,
      precision: 'district',
    },
    meta: {
      source: 'geoBoundaries gbOpen UGA ADM2, resolved by point-in-polygon',
      note: 'Sub-county, parish and village are not derived from geometry — choose them in the cascade.',
    },
  });
}
