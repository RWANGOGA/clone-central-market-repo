import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, GeoJSON, CircleMarker, Popup, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import {
  bboxOf,
  fetchBoundaries,
  fetchHierarchy,
  findNode,
  type BoundaryStatus,
  type GeoNode,
  type Hierarchy,
} from '../lib/geoApi';

/** Uganda's full extent, used as the initial view and the reset target. */
const UGANDA_VIEW: L.LatLngBoundsExpression = [
  [0.9, 28.5],
  [-1.6, 35.2],
];

const BRAND = '#426b1f';
const AMBER = '#b07d2b';

type Path = number[];

/**
 * Pans and zooms whenever `trigger` changes. Leaflet needs an imperative call,
 * so this has to live inside the MapContainer rather than alongside it.
 */
function ViewController({ target, trigger }: { target: unknown; trigger: number }) {
  const map = useMap();

  useEffect(() => {
    if (!target) return;

    const isBounds =
      Array.isArray(target) &&
      (target as unknown[]).length === 4 &&
      (target as unknown[]).every((v) => typeof v === 'number');

    if (isBounds) {
      map.fitBounds(target as L.LatLngBoundsExpression, { padding: [28, 28] });
    } else {
      map.flyTo(target as L.LatLngExpression, 11, { duration: 0.6 });
    }
    // trigger lets the same node be re-selected and still move the map.
  }, [trigger, map]);

  return null;
}

export default function DeliveryMap({
  onSelectPlace,
}: {
  /** Called with the node the user drilled into. */
  onSelectPlace?: (node: GeoNode) => void;
}) {
  const [hierarchy, setHierarchy] = useState<Hierarchy | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [path, setPath] = useState<Path>([]);
  const [selected, setSelected] = useState<GeoNode | null>(null);
  const [regionOutline, setRegionOutline] = useState<BoundaryStatus>({ state: 'loading' });
  const [districtOutline, setDistrictOutline] = useState<BoundaryStatus>({ state: 'loading' });
  const [zoomTrigger, setZoomTrigger] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    fetchHierarchy(controller.signal)
      .then((result) => {
        if (result) setHierarchy(result);
        else
          setLoadError(
            'Could not reach the geography service. Start the API with npm run dev --prefix api.',
          );
      })
      .catch(() =>
        setLoadError('Could not reach the geography service. Start the API with npm run dev --prefix api.'),
      );

    return () => controller.abort();
  }, []);

  // Region outlines are small and cached for an hour, so fetch once.
  useEffect(() => {
    let cancelled = false;
    fetchBoundaries('regions').then((status) => {
      if (!cancelled) setRegionOutline(status);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // The district file is a megabyte and covers the whole country, so it is
  // only fetched once a region is chosen.
  const regionId = path[0];
  useEffect(() => {
    if (regionId === undefined) return;

    const controller = new AbortController();
    setDistrictOutline({ state: 'loading' });

    fetchBoundaries('districts', controller.signal).then((status) => {
      if (!controller.signal.aborted) setDistrictOutline(status);
    });

    return () => controller.abort();
  }, [regionId]);

  const regions = hierarchy?.regions ?? [];
  const activeRegion = regionId === undefined ? null : (regions.find((r) => r.id === regionId) ?? null);
  const activeNode = regionId === undefined ? null : findNode(regions, path);

  /** District names belonging to the active region, used to filter outlines. */
  const districtNames = useMemo(
    () => new Set((activeRegion?.children ?? []).map((d) => d.name)),
    [activeRegion],
  );

  const filteredDistricts = useMemo(() => {
    if (districtOutline.state !== 'ready' || districtNames.size === 0) return null;

    const features = districtOutline.geojson.features.filter((feature) => {
      const name = (feature.properties as { shapeName?: string } | undefined)?.shapeName;
      return name !== undefined && districtNames.has(name);
    });

    return features.length > 0
      ? { ...districtOutline.geojson, features }
      : null;
  }, [districtOutline, districtNames]);

  const zoomTarget = useMemo(() => {
    const box = bboxOf(activeNode);
    if (box) return box;
    if (activeNode?.centroid) return [activeNode.centroid.lat, activeNode.centroid.lng];
    return null;
  }, [activeNode]);

  /** Nodes offered as markers: districts of the region, or the regions themselves. */
  const markers = activeRegion ? activeRegion.children : regions;

  const drill = (node: GeoNode) => {
    setSelected(node);

    if (node.children.length === 0) {
      onSelectPlace?.(node);
      setZoomTrigger((n) => n + 1);
      return;
    }

    setPath((current) => {
      // Descending inside the current branch just extends it.
      if (current.includes(node.id)) {
        return [...current.slice(0, current.indexOf(node.id)), node.id];
      }
      return [node.id];
    });
    setZoomTrigger((n) => n + 1);
  };

  const goUp = () => {
    setPath((current) => current.slice(0, -1));
    setSelected(null);
    setZoomTrigger((n) => n + 1);
  };

  const focusRegion = (region: GeoNode) => {
    setSelected(region);
    setPath([region.id]);
    setZoomTrigger((n) => n + 1);
  };

  if (loadError) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-[#f7f7f5] px-6">
        <div className="text-center">
          <p className="text-[15px] font-medium text-[#000000]">Map unavailable</p> <p className="mt-2 text-[13px] text-muted-foreground font-normal leading-[20px]">
            {loadError}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <MapContainer
        center={[1.3, 32.3]}
        zoom={7}
        minZoom={5}
        maxZoom={14}
        bounds={UGANDA_VIEW}
        style={{ height: '100%', width: '100%' }}
        attributionControl={true}
        scrollWheelZoom
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution="&copy; OpenStreetMap contributors"
          maxZoom={19}
        />

        {/* Uganda's four regions as real polygons from geoBoundaries ADM1. */}
        {regionOutline.state === 'ready' && (
          <GeoJSON
            key={`regions-${regionId ?? 'all'}`}
            data={regionOutline.geojson}
            style={{
              color: BRAND,
              weight: regionId === undefined ? 1.6 : 0.7,
              fillColor: BRAND,
              fillOpacity: regionId === undefined ? 0.12 : 0.03,
            }}
            onEachFeature={(feature, layer) => {
              const name = (feature.properties as { shapeName?: string } | undefined)?.shapeName;
              const node = regions.find((r) => r.name === name);
              if (!node) return;

              // onEachFeature is typed against the base Layer, but a GeoJSON
              // layer always carries setStyle and bindPopup.
              const pathLayer = layer as L.Path & { bindPopup: (content: string) => void };

              pathLayer.on('click', () => drill(node));
              pathLayer.on('mouseover', () => pathLayer.setStyle({ fillOpacity: 0.26 }));
              pathLayer.on('mouseout', () =>
                pathLayer.setStyle({ fillOpacity: regionId === undefined ? 0.12 : 0.03 }),
              );
              pathLayer.bindPopup(
                `<strong>${name}</strong><br/>${node.children.length} districts &middot; tap to zoom`,
              );
            }}
          />
        )}

        {/* Districts of the selected region, from geoBoundaries ADM2. */}
        {filteredDistricts && (
          <GeoJSON
            key={`districts-${regionId}`}
            data={filteredDistricts}
            style={{ color: '#6b8f3a', weight: 0.7, fillColor: '#8ca862', fillOpacity: 0.12 }}
          />
        )}

        {/* CircleMarker rather than Marker: it needs no icon assets, so there
            is no broken-image problem when leaflet's images are not served. */}
        {markers.map((node) =>
          node.centroid ? (
            <CircleMarker
              key={node.id}
              center={[node.centroid.lat, node.centroid.lng]}
              radius={5}
              pathOptions={{
                color: '#ffffff',
                weight: 1.5,
                fillColor: selected?.id === node.id ? '#b07d2b' : BRAND,
                fillOpacity: 0.95,
              }}
              eventHandlers={{ click: () => drill(node) }}
            >
              <Popup>
                <strong>{node.name}</strong>
                <br />
                {node.kind}
                {node.children.length > 0 ? (
                  <>
                    <br />
                    {node.children.length} below &rarr;
                  </>
                ) : null}
              </Popup>
            </CircleMarker>
          ) : null,
        )}

        <ViewController target={zoomTarget} trigger={zoomTrigger} />
      </MapContainer>

      {/* Drill-down breadcrumb and region quick-jump */}
      <div className="absolute left-3 right-3 top-3 z-[1050] flex flex-col gap-2 pointer-events-none">
        <div className="pointer-events-auto self-start bg-white/95 rounded-xl shadow-lg px-3 py-2">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
            {breadcrumb(regions, path)}
          </p>
          {path.length > 0 && (
            <button
              onClick={goUp}
              className="mt-0.5 text-[12px] text-brand font-medium hover:underline"
            >
              &larr; {path.length > 1 ? 'Back to region' : 'All regions'}
            </button>
          )}
        </div>

        {hierarchy && (
          <div className="pointer-events-auto self-start bg-white/95 rounded-xl shadow-lg px-3 py-2">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5 font-medium">
              Zoom to region
            </p>
            <div className="flex flex-wrap gap-1.5">
              {regions.map((region) => (
                <button
                  key={region.id}
                  onClick={() => focusRegion(region)}
                  className={`text-[11px] px-2.5 py-1 rounded-full border font-normal transition-colors ${
                    regionId === region.id
                      ? 'bg-brand text-white border-brand'
                      : 'bg-white text-[#000000] border-neutral-300 hover:border-brand'
                  }`}
                >
                  {region.name.replace(' Region', '')}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {hierarchy && <Legend levels={hierarchy.levels} drilled={path.length >= 2} />}

      {selected && (
        <div className="absolute bottom-24 left-3 right-3 z-[1050] bg-white/95 rounded-xl shadow-lg px-3 py-2">
          <p className="text-[13px] font-medium text-[#000000]">{selected.name}</p> <p className="text-[11px] text-muted-foreground font-normal">
            {selected.kind}
            {selected.children.length > 0
              ? ` · ${selected.children.length} below`
              : ' · lowest level currently populated'}
          </p>
        </div>
      )}
    </div>
  );
}

function Legend({
  levels,
  drilled,
}: {
  levels: { level: string; label?: string; count: number; geometryAvailable: boolean }[];
  drilled: boolean;
}) {
  return (
    <div className="absolute bottom-3 left-3 z-[1050] bg-white/95 rounded-lg shadow px-2.5 py-1.5 space-y-0.5 max-w-[62%]">
      {levels.map((level) => (
        <p key={level.level} className="text-[10px] font-normal text-muted-foreground"> <span className="text-[#000000]">{level.count}</span> {level.label ?? level.level.toLowerCase() + 's'}
          {!level.geometryAvailable && <span style={{ color: AMBER }}> · no outline data</span>}
        </p>
      ))}
      {drilled && (
        <p className="text-[10px] font-normal pt-0.5" style={{ color: AMBER }}>
          Sub-county, parish and village outlines are not published
        </p>
      )}
    </div>
  );
}

function breadcrumb(regions: GeoNode[], path: Path): string {
  if (path.length === 0) return 'All of Uganda';

  const names: string[] = [];
  let level: GeoNode[] = regions;

  for (const id of path) {
    const match = level.find((node) => node.id === id);
    if (!match) break;
    names.push(match.name);
    level = match.children;
  }

  return names.length > 0 ? names.join(' / ') : 'All of Uganda';
}