import { useCallback, useEffect, useMemo, useState } from 'react';
import type { GeoNode } from '../lib/geoApi';

/**
 * Cascading administrative selects.
 *
 * Two rules are enforced here, and both are re-checked on the server:
 *
 *  1. a level can only be chosen after the level above it
 *  2. choosing a level clears every level below it
 *
 * Rule 2 is the one that matters most in practice. Without it, switching from
 * Central Region to Northern Region leaves a Central district selected, and the
 * pair on screen no longer describes a real place.
 *
 * Options come from the hierarchy the API serves, not a separate hardcoded
 * list, so what can be selected here is exactly what validation accepts.
 */

export type LevelKey = 'region' | 'district' | 'subCounty' | 'parish' | 'village';

export const LEVELS: { key: LevelKey; label: string; kindLabel: string }[] = [
  { key: 'region', label: 'Region', kindLabel: 'Region' },
  { key: 'district', label: 'District, municipality or town', kindLabel: 'District' },
  { key: 'subCounty', label: 'Sub-county', kindLabel: 'Sub-county' },
  { key: 'parish', label: 'Parish or division', kindLabel: 'Parish' },
  { key: 'village', label: 'Village or zone', kindLabel: 'Village' },
];

export type LocationSelection = Record<LevelKey, string>;

export const EMPTY_SELECTION: LocationSelection = {
  region: '',
  district: '',
  subCounty: '',
  parish: '',
  village: '',
};

interface GeoCascadeProps {
  hierarchy: GeoNode[] | null;
  value: LocationSelection;
  onChange: (next: LocationSelection, changedLevel: LevelKey) => void;
  /** Shown when the hierarchy could not be loaded. */
  error?: string | null;
}

/** Strip the "(City)" style suffix the hierarchy carries. */
function optionLabel(node: Pick<GeoNode, 'name' | 'kind'>) {
  return `${node.name} (${node.kind})`;
}

export default function GeoCascade({ hierarchy, value, onChange, error }: GeoCascadeProps) {
  const [openLevel, setOpenLevel] = useState<LevelKey | null>(null);

  useEffect(() => {
    // A change anywhere closes an open list, so the dropdown cannot sit over a
    // value that has just been replaced.
    setOpenLevel(null);
  }, [value]);

  /** Children available for a level, given the ancestors chosen above it. */
  const optionsFor = useCallback(
    (level: LevelKey): GeoNode[] => {
      if (!hierarchy) return [];

      const index = LEVELS.findIndex((l) => l.key === level);
      if (index === 0) return hierarchy;

      // Walk down from the root using the chosen ancestors. If any ancestor is
      // missing, this level has no options, which is what stops a district
      // being offered before a region exists.
      let nodes: GeoNode[] = hierarchy;
      let chosen: GeoNode | null = null;

      for (let i = 0; i < index; i += 1) {
        const key = LEVELS[i].key;
        const name = value[key];
        if (!name) return [];
        chosen = nodes.find((node) => node.name === name) ?? null;
        if (!chosen) return [];
        nodes = chosen.children;
      }

      return nodes;
    },
    [hierarchy, value],
  );

  const select = (level: LevelKey, node: GeoNode) => {
    const next: LocationSelection = { ...value, [level]: node.name };

    // Clear every level below the one just chosen. This is the integrity rule.
    const index = LEVELS.findIndex((l) => l.key === level);
    for (let i = index + 1; i < LEVELS.length; i += 1) {
      next[LEVELS[i].key] = '';
    }

    onChange(next, level);
  };

  const totals = useMemo(() => {
    const counts = new Map<LevelKey, number>();
    for (const level of LEVELS) counts.set(level.key, optionsFor(level.key).length);
    return counts;
  }, [optionsFor]);

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] leading-[19px] font-normal text-red-700">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {LEVELS.map((level) => {
        const index = LEVELS.findIndex((l) => l.key === level.key);
        const options = optionsFor(level.key);
        const chosen = value[level.key];

        // A level is available once its parent is chosen. Sub-county and below
        // stay available because they may be populated later, but they show
        // the real count rather than pretending to have options.
        const parentChosen =
          index === 0 || Boolean(value[LEVELS[index - 1].key]);
        const disabled = !hierarchy || !parentChosen;
        const isOpen = openLevel === level.key;

        return (
          <div key={level.key} className="space-y-1">
            <div className="flex items-baseline justify-between">
              <p className="text-[14px] font-normal text-muted-foreground">
                {level.label}
              </p>
              {parentChosen && options.length === 0 && (
                <p className="text-[11px] font-normal text-[#b07d2b]">
                  none recorded
                </p>
              )}
            </div>

            <div className="relative">
              <button
                type="button"
                disabled={disabled}
                onClick={() => setOpenLevel(isOpen ? null : level.key)}
                aria-expanded={isOpen}
                className={`w-full border rounded-lg px-4 py-2 text-left font-normal text-[16px] flex items-center justify-between ${
                  disabled
                    ? 'bg-neutral-100 border-neutral-200 text-[#9a9a9a] cursor-not-allowed'
                    : 'bg-white border-neutral-200 text-[#000000] cursor-pointer'
                }`}
              >
                <span className={`text-[12px] truncate ${chosen ? '' : 'text-[#9a9a9a]'}`}>
                  {chosen
                    ? `${chosen} (${options.find((o) => o.name === chosen)?.kind ?? ''})`
                    : parentChosen
                      ? `Select ${level.kindLabel.toLowerCase()}`
                      : `Choose ${LEVELS[index - 1].label.toLowerCase()} first`}
                </span>
                {!disabled && (
                  <svg
                    className={`shrink-0 w-3 h-3 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                    fill="none"
                    viewBox="0 0 12 8"
                    aria-hidden="true"
                  >
                    <path
                      d="M1 1.5L6 6.5L11 1.5"
                      stroke="#000"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </button>

              {isOpen && options.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-neutral-200 rounded-lg max-h-52 overflow-y-auto z-50 shadow-lg">
                  {options.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => select(level.key, option)}
                      className={`w-full px-4 py-2 text-left text-[13px] font-normal hover:bg-brand/5 ${
                        option.name === chosen
                          ? 'text-brand font-medium'
                          : 'text-[#000000]'
                      }`}
                    >
                      {optionLabel(option)}
                    </button>
                  ))}
                </div>
              )}

              {isOpen && options.length === 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-neutral-200 rounded-lg px-4 py-3 z-50 shadow-lg">
                  <p className="text-[13px] leading-[19px] font-normal text-muted-foreground">
                    No {level.kindLabel.toLowerCase()}s are recorded under{' '}
                    {value[LEVELS[index - 1].key] || 'this parent'} yet.
                  </p>
                </div>
              )}
            </div>
          </div>
        );
      })}

      {/* Makes the state of the cascade explicit rather than implied. */}
      <p className="text-[11px] leading-[16px] font-normal text-muted-foreground">
        {hierarchy
          ? `${totals.get('region')} regions · ${totals.get('district')} districts and towns available`
          : 'Loading administrative areas…'}
      </p>
    </div>
  );
}
