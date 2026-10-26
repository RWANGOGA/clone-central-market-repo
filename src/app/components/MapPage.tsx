import React, { useState } from 'react';
import DeliveryMap from './DeliveryMap';
import svgPaths from '../imports/svg-s5y93igtx2';
import type { GeoNode } from '../lib/geoApi';
import { PageTitle } from './shared/PageTitle';

interface MapPageProps {
  cartCount: number;
  onBack: () => void;
  onMenuClick: () => void;
  onCartClick: () => void;
  /** Prefilled district name from the checkout form, if any. */
  initialDistrict?: string;
  onUseAsDeliveryPlace?: (name: string) => void;
}

export default function MapPage({
  cartCount,
  onBack,
  onMenuClick,
  onCartClick,
  initialDistrict,
  onUseAsDeliveryPlace,
}: MapPageProps) {
  const [picked, setPicked] = useState<string | null>(null);

  const handleSelect = (node: GeoNode) => {
    setPicked(node.name);
  };

  return (
    <div className="bg-[#ffffff] relative size-full">
      {/* The map fills the frame below the header. */}
      <div className="absolute inset-x-0 bottom-0 top-[149px]">
        <DeliveryMap onSelectPlace={handleSelect} />
      </div>

      <Header cartCount={cartCount} onBack={onBack} onMenuClick={onMenuClick} onCartClick={onCartClick} />

      {picked && (
        <div className="absolute bottom-24 left-3 right-3 z-[1150] bg-white rounded-xl shadow-lg px-3 py-2.5 flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
              Delivery point
            </p>
            <p className="text-[14px] font-medium text-[#000000] truncate">{picked}</p>
          </div>
          <button
            onClick={() => onUseAsDeliveryPlace?.(picked)}
            className="shrink-0 bg-brand text-white text-[12px] font-medium px-3 py-2 rounded-lg"
          >
            Use this
          </button>
        </div>
      )}

      {initialDistrict && !picked && (
        <div className="absolute bottom-24 left-3 right-3 z-[1150] bg-white rounded-xl shadow-lg px-3 py-2">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
            From your checkout
          </p>
          <p className="text-[14px] font-medium text-[#000000]">
            {initialDistrict}
          </p>
        </div>
      )}
    </div>
  );
}

interface HeaderProps {
  cartCount: number;
  onBack: () => void;
  onMenuClick: () => void;
  onCartClick: () => void;
}

function Header({ cartCount, onBack, onMenuClick, onCartClick }: HeaderProps) {
  return (
    <div className="absolute bg-[#ffffff] h-[149px] left-0 right-0 top-0 z-[1100]">
      <div className="absolute border-[0px_0px_1px] border-neutral-200 border-solid inset-0 pointer-events-none shadow-[0px_0px_20px_0px_rgba(0,0,0,0.1)]" />

      <div className="absolute left-6 right-6 top-[103px]">
        <div className="flex flex-row font-normal items-center justify-start w-full">
          <PageTitle>Coverage</PageTitle>
          <button
            onClick={onBack}
            className="cursor-pointer flex items-center font-normal not-italic shrink-0 text-brand text-[14px] text-nowrap tracking-[-0.14px] hover:opacity-80 transition-opacity"
          >
            <div className="flex flex-row items-center gap-1">
              <div className="w-3 h-3">
                <svg className="block size-full" fill="none" viewBox="0 0 12 12">
                  <path
                    d="M7.5 9L4.5 6L7.5 3"
                    stroke="#426b1f"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              <p className="block leading-[24px] whitespace-pre">Back</p>
            </div>
          </button>
        </div>
      </div>

      {/* Hamburger */}
      <button
        onClick={onMenuClick}
        aria-label="Open navigation menu"
        className="absolute left-5 rounded-2xl size-8 top-[18px] flex items-center justify-center cursor-pointer"
      >
        <div className="h-1.5 w-[18px]">
          <svg className="block size-full" fill="none" viewBox="0 0 18 8">
            <line stroke="var(--stroke-0, black)" strokeWidth="1.5" x2="18" y1="1.25" y2="1.25" />
            <line stroke="var(--stroke-0, black)" strokeWidth="1.5" x2="18" y1="7.25" y2="7.25" />
          </svg>
        </div>
      </button>

      {/* Basket */}
      <button
        onClick={onCartClick}
        aria-label="View basket"
        className="absolute right-5 rounded-2xl size-8 top-[18px] cursor-pointer"
      >
        <svg className="block size-full" fill="none" viewBox="0 0 32 32">
          <path d={svgPaths.p2003cd00} fill="var(--fill-0, black)" />
        </svg>
        {cartCount > 0 && (
          <div className="absolute bg-brand left-[17px] rounded-lg size-4 top-[-1px] flex items-center justify-center">
            <p className="text-[#ffffff] text-[9px] leading-none">{cartCount}</p>
          </div>
        )}
      </button>
    </div>
  );
}
