/**
 * Point-in-polygon reverse geocoding, with no database and no network.
 *
 * The buyer asked to drop a pin at "my current location" instead of drilling a
 * region → district → sub-county cascade by hand. The honest precision available
 * here is the district: the repository's own geoBoundaries ADM2 layer is the only
 * geometry we hold, and it does not draw sub-county, parish or village outlines.
 * So a match is answered at district level and everything finer is left for the
 * cascade — the code never invents a sub-county it cannot see.
 *
 * Geometry is deliberately kept out of the route file: this is pure, it runs
 * against the real GeoJSON in tests, and the ray-casting rule can be reasoned
 * about on its own.
 */

/** A coordinate as GeoJSON stores it: [longitude, latitude]. */
export type Position = [number, number];
/** One linear ring: an outer boundary or a hole. */
export type Ring = Position[];
/** One polygon: the first ring is the outline, the rest are holes. */
export type Polygon = Ring[];

export type BBox = { west: number; south: number; east: number; north: number };

/** A district pulled out of the boundary layer, ready to test against a point. */
export type DistrictShape = {
  district: string;
  polygons: Polygon[];
  bbox: BBox;
};

/** Uganda's extent with a small margin, used to reject obviously wrong pins. */
export const UGANDA_BBOX: BBox = { west: 29.3, south: -1.6, east: 35.2, north: 4.7 };

export function withinUganda(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lng >= UGANDA_BBOX.west &&
    lng <= UGANDA_BBOX.east &&
    lat >= UGANDA_BBOX.south &&
    lat <= UGANDA_BBOX.north
  );
}

function bboxOfRings(rings: Ring[]): BBox {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const ring of rings) {
    for (const [lng, lat] of ring) {
      if (lng < west) west = lng;
      if (lng > east) east = lng;
      if (lat < south) south = lat;
      if (lat > north) north = lat;
    }
  }
  return { west, south, east, north };
}

function joinBBox(a: BBox, b: BBox): BBox {
  return {
    west: Math.min(a.west, b.west),
    south: Math.min(a.south, b.south),
    east: Math.max(a.east, b.east),
    north: Math.max(a.north, b.north),
  };
}

export function bboxContains(bbox: BBox, lat: number, lng: number): boolean {
  return lng >= bbox.west && lng <= bbox.east && lat >= bbox.south && lat <= bbox.north;
}

/**
 * Ray casting: cast a horizontal ray from the point and count how many times it
 * crosses the ring. An odd count is inside. The test is written so a vertex that
 * two edges share is counted once, which is what makes holes and touching
 * boundaries behave.
 */
export function pointInRing(lat: number, lng: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Inside the outline and not inside any of its holes. */
export function pointInPolygon(lat: number, lng: number, polygon: Polygon): boolean {
  if (polygon.length === 0) return false;
  if (!pointInRing(lat, lng, polygon[0])) return false;
  for (let h = 1; h < polygon.length; h++) {
    if (pointInRing(lat, lng, polygon[h])) return false;
  }
  return true;
}

type GeoGeometry =
  | { type: 'Polygon'; coordinates: Position[][] }
  | { type: 'MultiPolygon'; coordinates: Position[][][] }
  | { type: string; coordinates?: unknown };

type GeoFeature = {
  type?: string;
  properties?: Record<string, unknown>;
  geometry?: GeoGeometry;
};

/**
 * Turn a GeoJSON FeatureCollection into testable shapes.
 *
 * Anything that is not a Polygon or MultiPolygon is skipped rather than guessed
 * at, and the district name is taken from geoBoundaries' `shapeName`. A feature
 * with no usable name is dropped: an unnamed polygon cannot be returned as an
 * answer to the customer.
 */
export function parseDistrictFeatures(raw: unknown): DistrictShape[] {
  const collection = raw as { features?: GeoFeature[] };
  const features = Array.isArray(collection?.features) ? collection.features : [];
  const shapes: DistrictShape[] = [];

  for (const feature of features) {
    const geometry = feature?.geometry;
    if (!geometry) continue;
    const name = feature.properties?.shapeName;
    if (typeof name !== 'string' || name.trim() === '') continue;

    let polygons: Polygon[];
    if (geometry.type === 'Polygon') {
      polygons = [geometry.coordinates as Position[][]];
    } else if (geometry.type === 'MultiPolygon') {
      polygons = geometry.coordinates as Position[][][];
    } else {
      continue;
    }

    if (polygons.length === 0) continue;

    let bbox: BBox | null = null;
    for (const polygon of polygons) {
      const box = bboxOfRings(polygon);
      bbox = bbox ? joinBBox(bbox, box) : box;
    }
    if (!bbox) continue;

    shapes.push({ district: name.trim(), polygons, bbox });
  }

  return shapes;
}

/**
 * The district that owns this point, if one of the shapes contains it.
 *
 * The bounding box is only a cheap prefilter — a point inside the rectangle but
 * outside the actual polygon still has to fail the ray test — so this cannot
 * return a district whose outline the pin does not fall inside.
 */
export function reverseDistrict(
  shapes: DistrictShape[],
  lat: number,
  lng: number,
): string | null {
  for (const shape of shapes) {
    if (!bboxContains(shape.bbox, lat, lng)) continue;
    for (const polygon of shape.polygons) {
      if (pointInPolygon(lat, lng, polygon)) return shape.district;
    }
  }
  return null;
}
