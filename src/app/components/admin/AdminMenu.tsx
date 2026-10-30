import { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { MarketRow } from '../../lib/adminApi';
import type { Tab } from '../AdminPage';
import { AreaIcon, SECTIONS, SECTION_FOR_TAB } from './AdminSidebar';

/**
 * The console's drawer, the staff mirror of the shopper home menu (Menu.tsx).
 *
 * Below `lg` the persistent left rail is only 64px, which squeezes eight areas
 * into a column of initials and leaves no room for the market switcher or the
 * account. On a phone that is the whole screen, so the rail gives way to this
 * drawer: full labels, grouped the same way the rail groups them, with the
 * market you are reading and the sign-out door in the one place a thumb reaches.
 *
 * It opens over the page rather than pushing it, exactly like the shopper menu,
 * so the number and behaviour are shared and only the list of destinations
 * differs. Escape closes it, Tab is kept inside, and focus returns to the button
 * that opened it.
 */
interface AdminMenuProps {
  isOpen: boolean;
  onClose: () => void;
  /** Already filtered by role by the shell — the drawer does not decide access. */
  tabs: { value: Tab; label: string; disabled?: boolean }[];
  activeTab: Tab;
  onSelectTab: (tab: Tab) => void;
  adminName: string;
  roleLabel: string;
  isPlatform: boolean;
  marketName: string | null;
  activeMarket: number | null;
  markets: MarketRow[];
  onChooseMarket: (marketId: number | null) => void;
  onSignOut: () => void;
  onBackToShop?: () => void;
}

export default function AdminMenu({
  isOpen,
  onClose,
  tabs,
  activeTab,
  onSelectTab,
  adminName,
  roleLabel,
  isPlatform,
  marketName,
  activeMarket,
  markets,
  onChooseMarket,
  onSignOut,
  onBackToShop,
}: AdminMenuProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  // Same modal discipline as the shopper drawer: Escape closes, Tab stays inside,
  // focus goes back to the opener on close.
  useEffect(() => {
    if (!isOpen) return;

    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    const focusables = () =>
      Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(
          'button, a[href], select, input, [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
    focusables()[0]?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) restoreFocusRef.current?.focus?.();
  }, [isOpen]);

  const choose = (tab: Tab) => {
    onSelectTab(tab);
    onClose();
  };

  // A platform account names the market it reads; a pinned one only ever reads
  // its own, so for them the label is a fact, not a control.
  const readingLabel = isPlatform
    ? activeMarket === null
      ? 'All markets'
      : (markets.find((item) => item.id === activeMarket)?.name ?? `Market ${activeMarket}`)
    : (marketName ?? 'My market');
  const canSwitch = isPlatform && markets.length > 1;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="absolute inset-0 z-40 bg-black/50"
            aria-hidden="true"
            onClick={onClose}
          />

          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Console navigation"
            initial={{ x: '-100%' }}
            animate={{ x: '0%' }}
            exit={{ x: '-100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 400, mass: 0.8 }}
            className="absolute bottom-0 left-0 top-0 z-50 flex w-[280px] flex-col overflow-hidden bg-brand text-white"
          >
            <CloseButton onClick={onClose} />

            {/* Who is signed in, and what they are. */}
            <div className="px-5 pb-4 pt-9">
              <p className="font-serif text-[20px] leading-[24px] tracking-[-0.3px]">Mu Katale</p>
              <p className="mt-0.5 text-[12px] text-white/70">Staff console</p>
              <p className="mt-3 truncate text-[14px] font-medium">{adminName}</p>
              <p className="text-[12px] text-white/70">{roleLabel}</p>
            </div>

            {/* Areas, grouped the way the rail groups them. */}
            <nav aria-label="Console areas" className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
              {SECTIONS.map((section) => {
                const items = tabs.filter((tab) => SECTION_FOR_TAB[tab.value] === section.key);
                if (items.length === 0) return null;
                return (
                  <div key={section.key} role="group" aria-label={section.label} className="mb-4 last:mb-0">
                    <p className="px-2 pb-1.5 text-[10px] font-medium uppercase tracking-[0.1em] text-white/50">
                      {section.label}
                    </p>
                    <div className="space-y-0.5">
                      {items.map((item) => {
                        const active = item.value === activeTab;
                        return (
                          <button
                            key={item.value}
                            onClick={() => choose(item.value)}
                            disabled={item.disabled}
                            aria-current={active ? 'page' : undefined}
                            className={`flex min-h-[44px] w-full items-center gap-3 rounded-lg px-2.5 text-left text-[15px] font-medium transition-colors ${
                              active
                                ? 'bg-white/20 text-white'
                                : item.disabled
                                  ? 'cursor-not-allowed text-white/30'
                                  : 'cursor-pointer text-white/90 hover:bg-white/10'
                            }`}
                          >
                            <AreaIcon tab={item.value} />
                            <span className="truncate">{item.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </nav>

            {/* Market and account actions, pinned where a thumb already is. */}
            <div className="space-y-2 border-t border-white/15 px-4 py-4">
              <div>
                <p className="mb-1 text-[10px] font-medium uppercase tracking-[0.1em] text-white/50">Reading</p>
                {canSwitch ? (
                  <select
                    value={activeMarket === null ? '' : String(activeMarket)}
                    onChange={(event) =>
                      onChooseMarket(event.target.value === '' ? null : Number(event.target.value))
                    }
                    aria-label="Market being read"
                    className="w-full cursor-pointer rounded-lg border border-white/25 bg-white/10 px-2.5 py-2 text-[14px] font-medium text-white outline-none focus:ring-2 focus:ring-white/40"
                  >
                    <option className="text-black" value="">All markets</option>
                    {markets.map((item) => (
                      <option key={item.id} className="text-black" value={String(item.id)}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="text-[14px] font-medium text-white/90">{readingLabel}</p>
                )}
              </div>

              {onBackToShop && (
                <button
                  onClick={() => {
                    onBackToShop();
                    onClose();
                  }}
                  className="min-h-[44px] w-full rounded-lg text-left text-[14px] font-medium text-white/80 transition-colors hover:text-white"
                >
                  Back to shop
                </button>
              )}
              <button
                onClick={() => {
                  onSignOut();
                  onClose();
                }}
                className="min-h-[44px] w-full rounded-lg text-left text-[14px] font-medium text-white/80 transition-colors hover:text-white"
              >
                Sign out
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label="Close menu"
      className="absolute left-4 top-4 flex size-9 cursor-pointer items-center justify-center rounded-xl text-white transition-opacity hover:opacity-80"
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M2 2L14 14M14 2L2 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </button>
  );
}
