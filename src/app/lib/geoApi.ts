import { apiUrl } from './apiBase';

export type PlaceKind = 'Region' | 'District' | 'City' | 'Municipality' | 'SubCounty' | 'Parish' | 'Village';

export type GeoNode = {
  id: number;
  name: string;
  kind: PlaceKind;
  centroid: { lat: number; lng: number } | null;
  bbox?: { south: number; west: number; north: number; east: number };
  hasGeometry: boolean;
  children: GeoNode[];
};

export type LevelAvailability = {
  level: string;
  /** Plural wording for display, e.g. "mapped areas" for the ADM2 layer. */
  label?: string;
  count: number;
  geometryAvailable: boolean;
};

export type Hierarchy = {
  regions: GeoNode[];
  levels: LevelAvailability[];
  source: string;
};

/**
 * Fetch the administrative tree. Returns null when the API is unreachable so
 * the map can degrade to a plain message instead of appearing broken.
 */
export async function fetchHierarchy(signal?: AbortSignal): Promise<Hierarchy | null> {
  try {
    const response = await fetch(apiUrl('/api/geo/hierarchy'), { signal });
    if (!response.ok) return null;

    const body = (await response.json()) as {
      data: GeoNode[];
      meta: { levels: LevelAvailability[]; source: string };
    };

    return {
      regions: body.data,
      levels: body.meta.levels,
      source: body.meta.source,
    };
  } catch {
    return null;
  }
}

export type BoundaryStatus =
  | { state: 'loading' }
  | { state: 'ready'; geojson: GeoJSON.FeatureCollection }
  | { state: 'unavailable'; reason: string }
  | { state: 'error'; reason: string };

/**
 * Fetch boundary polygons for one level. Levels with no open dataset resolve to
 * 'unavailable' with the server's explanation, so the UI can say so plainly
 * instead of drawing an empty map that looks broken.
 */
export async function fetchBoundaries(level: 'regions' | 'districts', signal?: AbortSignal): Promise<BoundaryStatus> {
  try {
    const response = await fetch(apiUrl(`/api/geo/boundaries/${level}`), { signal });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      return { state: 'unavailable', reason: body?.error ?? `No boundaries for ${level}` };
    }
    return { state: 'ready', geojson: (await response.json()) as GeoJSON.FeatureCollection };
  } catch {
    return { state: 'error', reason: 'Could not reach the boundary service' };
  }
}

/** Walk a path of ids from the roots down to a single node. */
export function findNode(regions: GeoNode[], path: number[]): GeoNode | null {
  if (path.length === 0) return null;

  let level: GeoNode[] = regions;
  let node: GeoNode | null = null;

  for (const id of path) {
    node = level.find((candidate) => candidate.id === id) ?? null;
    if (!node) return null;
    level = node.children;
  }

  return node;
}

export function regionOf(regions: GeoNode[], path: number[]): GeoNode | null {
  return path.length > 0 ? (regions.find((r) => r.id === path[0]) ?? null) : null;
}

/** Human label for the current drill-down position, e.g. "Central / Kampala". */
export function describePath(regions: GeoNode[], path: number[]): string {
  if (path.length === 0) return 'All of Uganda';

  const names: string[] = [];
  let level: GeoNode[] = regions;

  for (const id of path) {
    const match = level.find((candidate) => candidate.id === id);
    if (!match) break;
    names.push(match.name);
    level = match.children;
  }

  return names.length > 0 ? names.join(' / ') : 'All of Uganda';
}

export type LevelKey = 'region' | 'district' | 'subCounty' | 'parish' | 'village';

export const LEVEL_SEQUENCE: LevelKey[] = [
  'region',
  'district',
  'subCounty',
  'parish',
  'village',
];

export type Selection = Record<LevelKey, string>;

export type SelectionOk = {
  ok: true;
  node: GeoNode;
  resolved: { level: LevelKey; id: number; name: string; kind: string }[];
  missing: LevelKey[];
};

export type SelectionError = {
  ok: false;
  level: LevelKey;
  parentName: string;
  requested: string;
  message: string;
};

/** "Kampala (City)" -> "Kampala" */
function normaliseName(name: string) {
  return name
    .replace(/\s*\((?:City|Municipality|Town|District|Sub-?county|Parish|Village)\)\s*$/i, '')
    .trim()
    .replace(/\s+/g, ' ');
}

/** District, City, Municipality and Town are siblings under a Region. */
function rankOf(kind: string): number {
  switch (kind) {
    case 'District':
    case 'City':
    case 'Municipality':
    case 'Town':
      return 1;
    case 'SubCounty':
      return 2;
    case 'Parish':
      return 3;
    case 'Village':
      return 4;
    default:
      return 0;
  }
}

function humanLevel(level: LevelKey): string {
  return { region: 'Region', district: 'District', subCounty: 'Sub-county', parish: 'Parish', village: 'Village' }[level];
}

/** "no sub-counties recorded", not "no sub-countys". */
function pluralLevel(level: LevelKey): string {
  switch (level) {
    case 'subCounty':
      return 'sub-counties';
    case 'district':
      return 'districts or towns';
    default:
      return `${humanLevel(level).toLowerCase()}s`;
  }
}

/**
 * Client-side mirror of the server's top-down check, so an inconsistent
 * selection is caught before a request is made.
 *
 * This is a convenience, not the boundary. The server re-runs the same rule in
 * api/src/lib/geoValidate.ts and is what actually decides; keeping the two in
 * step matters, so the rules are deliberately identical rather than similar.
 */
export function validateSelection(regions: GeoNode[], selection: Selection): SelectionOk | SelectionError {
  const resolved: SelectionOk['resolved'] = [];
  const missing: LevelKey[] = [];

  // The region is matched against the root list, and every deeper level against
  // the children of the level above it. Handling the region separately keeps
  // the rest of the walk free of null checks.
  const regionName = selection.region;

  if (!regionName || regionName.trim() === '') {
    const firstDeeper = LEVEL_SEQUENCE.slice(1).find(
      (level) => selection[level] && selection[level].trim() !== '',
    );

    return {
      ok: false,
      level: 'region',
      parentName: 'Uganda',
      requested: firstDeeper ? selection[firstDeeper] : '',
      message: firstDeeper
        ? `Choose a region before choosing a ${humanLevel(firstDeeper).toLowerCase()}.`
        : 'Choose a region.',
    };
  }

  const wantedRegion = normaliseName(regionName).toLowerCase();
  const region =
    regions.find((node) => normaliseName(node.name).toLowerCase() === wantedRegion) ?? null;

  if (!region) {
    return {
      ok: false,
      level: 'region',
      parentName: 'Uganda',
      requested: regionName,
      message: `"${regionName}" is not in Uganda. Choose one of: ${regions
        .slice(0, 12)
        .map((r) => r.name)
        .join(', ')}.`,
    };
  }

  resolved.push({ level: 'region', id: region.id, name: region.name, kind: region.kind });

  let current: GeoNode = region;
  let currentLevel: LevelKey = 'region';

  for (const level of LEVEL_SEQUENCE.slice(1)) {
    const raw = selection[level];

    if (!raw || raw.trim() === '') {
      missing.push(level);
      continue;
    }

    const wanted = normaliseName(raw).toLowerCase();
    const child =
      current.children.find((node) => normaliseName(node.name).toLowerCase() === wanted) ?? null;

    if (!child) {
      const names = current.children.map((node) => node.name);
      return {
        ok: false,
        level,
        parentName: current.name,
        requested: raw,
        message:
          names.length === 0
            ? `${current.name} has no ${pluralLevel(level)} recorded yet, so "${raw}" cannot be matched against it.`
            : `"${raw}" is not in ${current.name}. Choose one of: ${names.slice(0, 12).join(', ')}${names.length > 12 ? ', …' : ''}.`,
      };
    }

    if (rankOf(child.kind) <= rankOf(current.kind)) {
      return {
        ok: false,
        level,
        parentName: current.name,
        requested: raw,
        message: `"${child.name}" is recorded as a ${child.kind}, which is not below the level of ${current.name}. The hierarchy data is inconsistent.`,
      };
    }

    resolved.push({ level, id: child.id, name: child.name, kind: child.kind });
    current = child;
    currentLevel = level;
  }

  void currentLevel;
  return { ok: true, node: current, resolved, missing };
}

/** Clear every level below the one that just changed. */
export function clearBelow(selection: Selection, changedLevel: LevelKey): Selection {
  const start = LEVEL_SEQUENCE.indexOf(changedLevel) + 1;
  const next: Selection = { ...selection };
  for (const level of LEVEL_SEQUENCE.slice(start)) next[level] = '';
  return next;
}

export type LocatedPlace = {  name: string;
  kind: string;
  region: string | null;
  centroid: { lat: number; lng: number };
  bbox: { south: number; west: number; north: number; east: number } | null;
  /** 'boundary' means a real centroid and outline, 'town-centre' is approximate. */
  source: 'boundary' | 'town-centre';
  hasOutline: boolean;
  precision: 'district-centroid' | 'town-centre';
};

/**
 * Resolve a place name typed at checkout into coordinates.
 *
 * Returns null when the name cannot be resolved or the API is unreachable, so
 * the caller can fall back to a wider view rather than showing nothing.
 */
export async function locatePlace(
  place: string,
  region?: string,
  signal?: AbortSignal,
): Promise<LocatedPlace | null> {
  if (!place.trim()) return null;

  try {
    const params = new URLSearchParams({ place });
    if (region) params.set('region', region);

    const response = await fetch(apiUrl(`/api/geo/locate?${params.toString()}`), { signal });
    if (!response.ok) return null;

    const body = (await response.json()) as { data: LocatedPlace };
    return body.data;
  } catch {
    return null;
  }
}

export type Bbox = [south: number, west: number, north: number, east: number];
/**
 * Convert a node's bounding box into Leaflet's corner form and pad it so the
 * shape is not flush against the viewport edge. Returning null when there is no
 * bbox lets the caller fall back to the centroid at a fixed zoom, which is what
 * sub-countries and below will need once they are populated.
 */
export function bboxOf(node: GeoNode | null, padRatio = 0.12): Bbox | null {
  if (!node?.bbox) return null;
  const { south, west, north, east } = node.bbox;
  const padLat = (north - south) * padRatio || 0.2;
  const padLng = (east - west) * padRatio || 0.2;
  return [south - padLat, west - padLng, north + padLat, east + padLng];
}
