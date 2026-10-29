import { useEffect, useMemo, useState } from 'react';
import { Circle, CircleMarker, GeoJSON, MapContainer, TileLayer, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { fetchBoundaries, locatePlace, type BoundaryStatus, type LocatedPlace } from '../lib/geoApi';

/**
 * Leaflet paints SVG attributes from these JS strings, so the Tailwind token
 * utilities cannot reach them; this mirrors var(--brand) as the single source
 * of the market green for the map layers.
 */
const BRAND = '#426b1f';

interface DeliveryLocationMapProps {
  /** District or town exactly as it was chosen at checkout. */
  district: string;
  region: string;
  /** Free-text street address, shown as the label but not geocoded. */
  address?: string;
  className?: string;
}

/**
 * Radius drawn around the pin to show how precise the fix is. A district
 * centroid is tens of kilometres across, so showing a bare pin would imply a
 * precision the data does not have.
 */
function radiusFor(place: LocatedPlace): number {
  if (place.precision === 'town-centre') return 4000;

  // Derive a sensible radius from the district's own bounding box.
  if (!place.bbox) return 8000;
  const heightKm = (place.bbox.north - place.bbox.south) * 111;
  const widthKm = (place.bbox.east - place.bbox.west) * 111;
  return Math.max(3000, Math.round(Math.sqrt(heightKm * widthKm) * 1000 * 0.5));
}

function FitToPlace({ place }: { place: LocatedPlace }) {
  const map = useMap();

  useEffect(() => {
    const zoom = place.precision === 'town-centre' ? 12 : 10;
    map.flyTo([place.centroid.lat, place.centroid.lng], zoom, { duration: 0 });
  }, [place]);

  return null;
}

/**
 * A real map of where the order is going, centred on the district chosen at
 * checkout.
 *
 * The free-text street address is not geocoded, so the pin marks the district
 * or town, not the doorstep, and the circle states that. To place a marker on
 * the actual address you need a geocoding service; see the note in the caption.
 */
export default function DeliveryLocationMap({
  district,
  region,
  address,
  className = '',
}: DeliveryLocationMapProps) {
  const [place, setPlace] = useState<LocatedPlace | null>(null);
  const [outline, setOutline] = useState<BoundaryStatus>({ state: 'loading' });
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setPlace(null);
    setFailed(false);
    setOutline({ state: 'loading' });

    locatePlace(district, region, controller.signal).then((result) => {
      if (controller.signal.aborted) return;

      if (!result) {
        setFailed(true);
        return;
      }

      setPlace(result);

      // Only fetch the national district file when the district actually has
      // an outline; otherwise this would pull a megabyte for nothing.
      if (result.hasOutline) {
        fetchBoundaries('districts', controller.signal).then((status) => {
          if (!controller.signal.aborted) setOutline(status);
        });
      } else {
        setOutline({ state: 'unavailable', reason: 'No outline for this district' });
      }
    });

    return () => controller.abort();
  }, [district, region]);

  /** The single feature matching the located district, for the highlight. */
  const feature = useMemo(() => {
    if (outline.state !== 'ready' || !place) return null;

    const match = outline.geojson.features.find((f) => {
      const name = (f.properties as { shapeName?: string } | undefined)?.shapeName;
      return name?.toLowerCase() === place.name.toLowerCase();
    });

    return match ? { ...outline.geojson, features: [match] } : null;
  }, [outline, place]);

  if (failed) {
    return (
      <div
        className={`relative rounded-2xl overflow-hidden border border-neutral-200 h-[225px] ${className}`}
      >
        <FallbackMap region={region} district={district} />
        <div className="absolute inset-0 bg-white/85 flex items-center justify-center px-6 text-center">
          <div>
            <p className="text-[13px] font-medium text-black">
              Could not place this order on the map
            </p>
            <p className="mt-1 text-[11px] leading-[16px] font-normal text-muted-foreground"> The geography service did not resolve {district || 'this district'}. The rider still
              has your address.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`relative rounded-2xl overflow-hidden border border-neutral-200 h-[225px] ${className}`}>
      <MapContainer
        center={[1.3, 32.3]}
        zoom={11}
        minZoom={6}
        maxZoom={16}
        style={{ height: '100%', width: '100%' }}
        attributionControl={false}
        // The order screen is a summary, not a map tool. Scroll and drag are
        // off so a stray swipe cannot fight the page's own scrolling.
        scrollWheelZoom={false}
        dragging={false}
        doubleClickZoom={false}
        zoomControl={false}
        touchZoom={false}
        keyboard={false}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution="&copy; OpenStreetMap contributors"
          maxZoom={19}
        />

        {/* Real district outline where the open data has one. */}
        {feature && (
          <GeoJSON
            data={feature}
            style={{
              color: BRAND,
              weight: 1.6,
              fillColor: BRAND,
              fillOpacity: 0.14,
            }}
          />
        )}

        {place && (
          <>
            {/* How wide the uncertainty is, stated rather than implied. */}
            <Circle
              center={[place.centroid.lat, place.centroid.lng]}
              radius={radiusFor(place)}
              pathOptions={{
                color: BRAND,
                weight: 1,
                fillColor: BRAND,
                fillOpacity: 0.08,
                dashArray: '4 4',
              }}
            />
            <CircleMarker
              center={[place.centroid.lat, place.centroid.lng]}
              radius={8}
              pathOptions={{
                color: '#ffffff',
                weight: 2.5,
                fillColor: BRAND,
                fillOpacity: 1,
              }}
            />
            <FitToPlace place={place} />
          </>
        )}
      </MapContainer>

      {/* Caption states what the pin actually means. */}
      <div className="absolute left-2 top-2 right-2 z-[1050] flex items-start justify-between gap-2">
        <div className="bg-white/95 rounded-lg shadow px-2 py-1 min-w-0">
          <p className="text-[11px] font-medium text-black truncate">
            {place ? `${place.name} district` : 'Locating…'}
          </p>
          {place && (
            <p className="text-[10px] leading-[14px] font-normal text-muted-foreground">
              {place.precision === 'town-centre'
                ? 'Pin marks the town centre'
                : 'Pin marks the district centre'}
            </p>
          )}
        </div>
      </div>

      <div className="absolute left-0 right-0 bottom-0 z-[1050] bg-gradient-to-t from-black/55 to-transparent px-2.5 pt-6 pb-1.5">
        <p className="text-[10px] leading-[14px] font-normal text-white/95">
          {place ? 'Dispatch to ' : ''}
          {address ? address : place ? `${place.name}, ${region}` : region}
        </p>
        <p className="text-[9px] leading-[12px] font-normal text-white/70">
          Map data &copy; OpenStreetMap contributors
        </p>
      </div>
    </div>
  );
}

/**
 * Shown when the API cannot resolve the district. Draws the country outline so
 * the card is never blank, without pretending to know where the order goes.
 */
function FallbackMap({ district }: { region: string; district: string }) {
  const [outline, setOutline] = useState<BoundaryStatus>({ state: 'loading' });

  useEffect(() => {
    let cancelled = false;
    fetchBoundaries('regions').then((status) => {
      if (!cancelled) setOutline(status);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="absolute inset-0">
      <MapContainer
        center={[1.3, 32.3]}
        zoom={6}
        style={{ height: '100%', width: '100%' }}
        attributionControl={false}
        scrollWheelZoom={false}
        dragging={false}
        zoomControl={false}
        touchZoom={false}
        keyboard={false}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution="&copy; OpenStreetMap contributors"
          maxZoom={19}
        />
        {outline.state === 'ready' && (
          <GeoJSON
            data={outline.geojson}
            style={{ color: BRAND, weight: 1, fillColor: BRAND, fillOpacity: 0.1 }}
          />
        )}
      </MapContainer>
      <span className="sr-only">Map of Uganda. Delivery district {district || 'unknown'}.</span>
    </div>
  );
}