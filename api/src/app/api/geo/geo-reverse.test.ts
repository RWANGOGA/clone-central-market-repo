import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  bboxContains,
  parseDistrictFeatures,
  pointInPolygon,
  reverseDistrict,
  withinUganda,
  type Ring,
} from '@/lib/geoReverse';

/**
 * Reverse geocoding for finding F3.
 *
 * The rule that must not silently break is the one the comment in the library
 * states: a pin is answered only when it is inside the drawn outline, never
 * merely inside its bounding rectangle. These fixtures make that visible without
 * depending on a live database or network.
 */

const square: Ring = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
  [0, 0],
];

// A triangle whose hypotenuse runs from lng 10 / lat 0 to lng 0 / lat 10. Its
// bounding box is the whole 0–10 square, so a point past the hypotenuse sits in
// the box but outside the shape.
const triangle: Ring = [
  [0, 0],
  [10, 0],
  [0, 10],
  [0, 0],
];

const hole: Ring = [
  [4, 4],
  [6, 4],
  [6, 6],
  [4, 6],
  [4, 4],
];

function collection(features: unknown[]) {
  return { type: 'FeatureCollection', features };
}

function feature(district: string, geometry: unknown) {
  return { type: 'Feature', properties: { shapeName: district }, geometry };
}

describe('withinUganda', () => {
  it('accepts a real coordinate and rejects those off the map', () => {
    expect(withinUganda(0.347, 32.581)).toBe(true); // Kampala
    expect(withinUganda(51.5, -0.12)).toBe(false); // London
    expect(withinUganda(Number.NaN, 32)).toBe(false);
  });
});

describe('bboxContains', () => {
  it('is a cheap rectangle test, not the answer', () => {
    const box = { west: 0, south: 0, east: 10, north: 10 };
    expect(bboxContains(box, 5, 5)).toBe(true);
    expect(bboxContains(box, 5, 15)).toBe(false);
  });
});

describe('pointInPolygon', () => {
  it('accepts the interior and rejects the exterior', () => {
    expect(pointInPolygon(5, 5, [square])).toBe(true);
    expect(pointInPolygon(5, 15, [square])).toBe(false);
  });

  it('honours a hole', () => {
    const polygon = [square, hole];
    expect(pointInPolygon(5, 5, polygon)).toBe(false); // inside the hole
    expect(pointInPolygon(2, 2, polygon)).toBe(true); // inside the outline, outside the hole
  });
});

describe('parseDistrictFeatures', () => {
  it('keeps polygons and multipolygons and skips the rest', () => {
    const shapes = parseDistrictFeatures(
      collection([
        feature('Alpha', { type: 'Polygon', coordinates: [square] }),
        feature('Beta', { type: 'MultiPolygon', coordinates: [[square], [triangle]] }),
        feature('Gamma', { type: 'Point', coordinates: [1, 1] }),
        { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [square] } },
      ]),
    );
    const names = shapes.map((s) => s.district).sort();
    expect(names).toEqual(['Alpha', 'Beta']);
  });
});

describe('reverseDistrict', () => {
  it('returns the district whose outline holds the point', () => {
    const shapes = parseDistrictFeatures(
      collection([feature('Alpha', { type: 'Polygon', coordinates: [square] })]),
    );
    expect(reverseDistrict(shapes, 5, 5)).toBe('Alpha');
  });

  it('does not return a district merely because the box holds the point', () => {
    const shapes = parseDistrictFeatures(
      collection([feature('Tri', { type: 'Polygon', coordinates: [triangle] })]),
    );
    // lng 8, lat 8 is inside the 0–10 bounding box but past the hypotenuse.
    expect(reverseDistrict(shapes, 8, 8)).toBeNull();
    // lng 2, lat 2 is genuinely inside the triangle.
    expect(reverseDistrict(shapes, 2, 2)).toBe('Tri');
  });

  it('searches every part of a multipolygon', () => {
    const shapes = parseDistrictFeatures(
      collection([
        feature(
          'Isles',
          {
            type: 'MultiPolygon',
            coordinates: [
              [[ ...square.slice(0, 4), square[0] ]],
              [
                [
                  [100, 100],
                  [110, 100],
                  [110, 110],
                  [100, 110],
                  [100, 100],
                ],
              ],
            ],
          },
        ),
      ]),
    );
    expect(reverseDistrict(shapes, 105, 105)).toBe('Isles');
    expect(reverseDistrict(shapes, 5, 5)).toBe('Isles');
  });

  it('answers null for a point no outline covers', () => {
    const shapes = parseDistrictFeatures(
      collection([feature('Alpha', { type: 'Polygon', coordinates: [square] })]),
    );
    expect(reverseDistrict(shapes, 99, 99)).toBeNull();
  });
});

describe('the real boundary file', () => {
  it('parses into named district shapes', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const file = path.resolve(here, '../../../../data/geo/districts.geojson');
    const shapes = parseDistrictFeatures(JSON.parse(fs.readFileSync(file, 'utf8')));
    expect(shapes.length).toBeGreaterThan(0);
    // Every shape must carry a usable name and a finite box to prefilter on.
    for (const shape of shapes.slice(0, 20)) {
      expect(shape.district.length).toBeGreaterThan(0);
      expect(Number.isFinite(shape.bbox.west)).toBe(true);
      expect(shape.polygons.length).toBeGreaterThan(0);
    }
  });
});
