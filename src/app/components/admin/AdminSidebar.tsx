import React from 'react';
import type { MarketRow } from '../../lib/adminApi';
import type { Tab } from '../AdminPage';

/**
 * The console's left rail.
 *
 * Navigation used to be a strip of equal pills under the account name, in the
 * header that scrolls away, and it said nothing about which market you were
 * looking at. Two things followed from that. A market admin and the platform
 * saw the same row of pills, so the boundary the API enforces on every request
 * was invisible until a request came back empty. And with twelve areas sharing
 * one row, the handful that make up a market's day — orders, stock, the shelf —
 * had no more weight than the ones nobody opens on a Tuesday.
 *
 * So: areas grouped under what they are for, and the market stated permanently
 * at the foot of the rail. The grouping is a presentation of the `tabs` array
 * the shell already filters by role, which keeps the question "what may this
 * account open" in exactly one place.
 */

export type SectionKey = 'fulfilment' | 'catalogue' | 'insight' | 'setup';

/** Display order of the groups, and what each is called. */
export const SECTIONS: { key: SectionKey; label: string }[] = [
  { key: 'fulfilment', label: 'Fulfilment' },
  { key: 'catalogue', label: 'Catalogue' },
  { key: 'insight', label: 'Insight' },
  { key: 'setup', label: 'Setup' },
];

/**
 * Where each area belongs. A `Record<Tab, …>` rather than a lookup that could
 * miss: add a ninth area to the console and this file fails to compile until it
 * is placed, instead of quietly never rendering.
 */
export const SECTION_FOR_TAB: Record<Tab, SectionKey> = {
  orders: 'fulfilment',
  inventory: 'fulfilment',
  catalogue: 'catalogue',
  analytics: 'insight',
  customers: 'insight',
  people: 'setup',
  markets: 'setup',
  admins: 'setup',
};

/**
 * Line art in the idiom the rest of the app uses — an inline path, 1.5 stroke,
 * round joins, colour from the button it sits in. There is no icon package here
 * and one pill glyph per area is not worth installing a dependency for.
 */
const ICON_PATHS: Record<Tab, React.ReactNode> = {
  orders: (
    <>
      <path d="M4.5 9.5h15l-1.3 7.9a2 2 0 0 1-2 1.6H7.8a2 2 0 0 1-2-1.6z" />
      <path d="M8.5 9.5 12 4.5l3.5 5" />
    </>
  ),
  inventory: (
    <>
      <path d="M4.5 8.6 12 5.2l7.5 3.4v6.8L12 18.8l-7.5-3.4z" />
      <path d="M4.5 8.6 12 12l7.5-3.4M12 12v6.8" />
    </>
  ),
  catalogue: (
    <>
      <path d="M9.5 7h9M9.5 12h9M9.5 17h9" />
      <circle cx="5.4" cy="7" r="1.1" />
      <circle cx="5.4" cy="12" r="1.1" />
      <circle cx="5.4" cy="17" r="1.1" />
    </>
  ),
  analytics: (
    <>
      <path d="M4.5 19.5h15" />
      <path d="M8 19.5v-6M12 19.5V6M16 19.5v-9" />
    </>
  ),
  customers: (
    <>
      <circle cx="12" cy="9" r="3.4" />
      <path d="M5.5 19.5a6.5 6.5 0 0 1 13 0" />
    </>
  ),
  people: (
    <>
      <circle cx="9.5" cy="9" r="3" />
      <path d="M4 19.5a5.5 5.5 0 0 1 11 0" />
      <path d="M16.2 6.4a3 3 0 0 1 0 5.4" />
      <path d="M17.6 19.5a5.2 5.2 0 0 0-2.1-4.4" />
    </>
  ),
  markets: (
    <>
      <path d="M12 20.4s6-5.1 6-9.9a6 6 0 1 0-12 0c0 4.8 6 9.9 6 9.9z" />
      <circle cx="12" cy="10.2" r="2.1" />
    </>
  ),
  admins: (
    <>
      <rect x="4.5" y="6" width="15" height="12" rx="2" />
      <circle cx="9.6" cy="11" r="1.9" />
      <path d="M6.9 15.4a2.9 2.9 0 0 1 5.4 0" />
      <path d="M14.6 10.5h2.9M14.6 13.5h2.9" />
    </>
  ),
};

export function AreaIcon({ tab }: { tab: Tab }) {
  return (
    <span className="size-5 shrink-0">
      <svg
        className="block size-full"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {ICON_PATHS[tab]}
      </svg>
    </span>
  );
}

/** Every market at once, which is the platform's default reading. */
function AllMarketsIcon() {
  return (
    <span className="size-5 shrink-0">
      <svg
        className="block size-full"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="4.5" y="4.5" width="6" height="6" rx="1" />
        <rect x="13.5" y="4.5" width="6" height="6" rx="1" />
        <rect x="4.5" y="13.5" width="6" height="6" rx="1" />
        <rect x="13.5" y="13.5" width="6" height="6" rx="1" />
      </svg>
    </span>
  );
}

export type AdminSidebarProps = {
  /** Already filtered by role by the shell — the rail does not decide access. */
  tabs: { value: Tab; label: string; disabled?: boolean }[];
  activeTab: Tab;
  onSelectTab: (tab: Tab) => void;
  isPlatform: boolean;
  /** The pinned account's own market, or null on the platform tier. */
  marketName: string | null;
  /** The market being read. Null is every market, and only the platform gets it. */
  activeMarket: number | null;
  markets: MarketRow[];
  onChooseMarket: (marketId: number | null) => void;
};

export default function AdminSidebar({
  tabs,
  activeTab,
  onSelectTab,
  isPlatform,
  marketName,
  activeMarket,
  markets,
  onChooseMarket,
}: AdminSidebarProps) {
  // A platform account names the market it is reading; a pinned one only ever
  // reads its own, so its name is a fact about the account, not a choice.
  const readingLabel = isPlatform
    ? (activeMarket === null
        ? 'All markets'
        : (markets.find((item) => item.id === activeMarket)?.name ?? `Market ${activeMarket}`))
    : (marketName ?? 'My market');
  // Same condition the header's switcher used: with one market there is nothing
  // to switch between, and the list arrives after the first paint.
  const canSwitch = isPlatform && markets.length > 1;
  // Every market at once, which only the platform tier can be reading. A pinned
  // account has no active market of its own choosing and is not "all of them".
  const readingAllMarkets = isPlatform && activeMarket === null;
  const marketBadge = readingAllMarkets ? (
    <AllMarketsIcon />
  ) : (
    // A single letter is enough to tell two markets apart in a 64px rail, which
    // is why the word only appears once there is room for it above `lg`.
    <span className="text-[12px] font-medium text-brand-deep" aria-hidden="true">
      {readingLabel.slice(0, 1).toUpperCase()}
    </span>
  );
  const selectValue = activeMarket === null ? '' : String(activeMarket);

  const choose = (event: React.ChangeEvent<HTMLSelectElement>) =>
    onChooseMarket(event.target.value === '' ? null : Number(event.target.value));

  const marketOptions = (
    <>
      <option value="">All markets</option>
      {markets.map((item) => (
        <option key={item.id} value={String(item.id)}>
          {item.name}
        </option>
      ))}
    </>
  );

  return (
    <aside className="flex h-full w-16 shrink-0 flex-col border-r border-neutral-200 bg-white lg:w-[208px]">
      <nav aria-label="Console areas" className="min-h-0 flex-1 overflow-y-auto px-1.5 py-3 lg:px-2">
        {SECTIONS.map((section) => {
          // Filtered out of `tabs`, so a shop assistant never sees a Setup group
          // at all rather than seeing it empty.
          const items = tabs.filter((tab) => SECTION_FOR_TAB[tab.value] === section.key);
          if (items.length === 0) return null;
          return (
            <div key={section.key} role="group" aria-label={section.label} className="mb-4 last:mb-0">
              <p className="hidden px-3 pb-1.5 text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground lg:block">
                {section.label}
              </p>
              <div className="space-y-0.5">
                {items.map((item) => {
                  const active = item.value === activeTab;
                  return (
                    <button
                      key={item.value}
                      onClick={() => onSelectTab(item.value)}
                      disabled={item.disabled}
                      aria-current={active ? 'page' : undefined}
                      // The label is only drawn under the icon when this is the
                      // active area, so every item needs its name another way.
                      aria-label={item.label}
                      title={item.label}
                      className={`flex w-full flex-col items-center gap-1 rounded-lg py-2 text-center font-medium lg:flex-row lg:gap-2.5 lg:px-3 lg:text-left ${
                        active
                          ? 'bg-brand text-white'
                          : item.disabled
                            ? 'cursor-not-allowed bg-neutral-200 text-neutral-400'
                            : 'cursor-pointer text-black hover:bg-neutral-100'
                      }`}
                    >
                      <AreaIcon tab={item.value} />
                      {/*
                        Collapsed, the rail is 64px: only the area you are in keeps
                        its word, so the day's context survives without the rail
                        taking width from the table. `hidden` on the inactive ones
                        means an invisible label is not announced twice either.
                        That word has the full 52px inside the rail and no padding
                        of the button's own to spend — measured, the longest label
                        ("Catalogue") needs 44px of it.
                      */}
                      <span
                        className={`block min-w-0 max-w-full truncate text-[9px] leading-[11px] lg:text-[12.5px] lg:leading-[18px] ${
                          active ? '' : 'hidden lg:block'
                        }`}
                      >
                        {item.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      <div className="border-t border-neutral-200 px-1.5 py-3 lg:px-2">
        <p className="mb-1.5 hidden px-1 text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground lg:block">
          Reading
        </p>

        {canSwitch ? (
          <>
            {/*
              Two renderings of one choice, never both visible: below `lg` the
              market is an initial with the select laid over it, above `lg` a
              named select. The hidden one is `display: none`, so it is out of the
              tab order and the accessibility tree rather than merely invisible.
            */}
            <span className="relative flex size-10 items-center justify-center rounded-lg border border-neutral-200 bg-white focus-within:ring-2 focus-within:ring-brand lg:hidden">
              {marketBadge}
              <select
                value={selectValue}
                onChange={choose}
                aria-label={`Market being read: ${readingLabel}`}
                // `opacity-0` hides everything this element paints, its own focus
                // ring included, so the ring that tells a keyboard user where they
                // are lives on the badge around it — see `focus-within` above.
                className="absolute inset-0 size-full cursor-pointer appearance-none opacity-0"
              >
                {marketOptions}
              </select>
            </span>
            <label className="hidden lg:block">
              <span className="mb-1 block text-[11px] font-normal text-muted-foreground">Market</span>
              <select
                value={selectValue}
                onChange={choose}
                className="w-full cursor-pointer rounded-lg border border-neutral-200 bg-white px-2 py-1.5 text-[12px] font-normal text-black"
              >
                {marketOptions}
              </select>
            </label>
          </>
        ) : (
          <>
            {/*
              The same fact twice, because 64px holds either a word or a mark and
              not both. Collapsed it is the market's initial with the name kept
              for a hover and for the accessibility tree; from `lg` up the word
              fits, so it is simply said.
            */}
            <span
              className="flex size-10 items-center justify-center rounded-lg bg-brand-soft lg:hidden"
              title={readingLabel}
            >
              {marketBadge}
              <span className="sr-only">{readingLabel}</span>
            </span>
            <div className="hidden items-center gap-2 rounded-lg bg-brand-soft px-2 py-1.5 lg:flex">
              {readingAllMarkets ? <AllMarketsIcon /> : <AreaIcon tab="markets" />}
              <span className="min-w-0 truncate text-[12px] font-medium text-brand-deep">
                {readingLabel}
              </span>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
