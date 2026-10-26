import React from 'react';
import StatusBar from './shared/StatusBar';
import ExpandableCard from './shared/ExpandableCard';
import svgPaths from "../imports/svg-s5y93igtx2";

interface AboutPageProps {
  onBack: () => void;
  onMenuClick: () => void;
  onCartClick: () => void;
  cartCount: number;
}

/**
 * Commitments rather than achievements. The figures are real, published
 * Uganda numbers, each labelled with what it actually measures, because the
 * alternative is inventing corporate claims we cannot stand behind.
 */
const VALUES = [
  {
    title: 'Farm-Gate Transparency',
    description:
      'We show the farm-gate reference beside our shelf price, so the gap between what a grower earns and what you pay is visible instead of buried. Uganda shipped 737,766 bags of coffee in August, 13.6% fewer than a year earlier, and firmer prices kept farmer earnings from falling as far as volume did.',
    stat: 'Shs5,750',
    statLabel: 'Farm-gate robusta kiboko, per kg, Aug 2026',
  },
  {
    title: 'Built Around the Dry Spell',
    description:
      'Prolonged drought and unusually high temperatures hit flowering and bean filling in Greater Masaka, Kyotera, Sembabule and Luwero, leaving the out-turn about 10% below normal in those areas. We favour growers and districts investing in irrigation rather than depending on rain-fed supply alone.',
    stat: '1.5m ha',
    statLabel: 'National irrigated land target by 2040',
  },
  {
    title: 'Buying Into the Market Trade',
    description:
      "Kampala's central markets still move most of the fresh produce sold in the city, and KCCA runs 17 of them under the Markets Act. We buy into that trade rather than routing around it, so the traders you meet at Owino, Kisementi and Nakivubo keep their margin.",
    stat: '550',
    statLabel: 'Vacant spaces in KCCA-run markets, Sep 2026',
  }
];

const REGIONS = [
  {
    name: 'Kampala & Wakiso',
    location: 'Central Region',
    specialty: 'Fresh produce moving through Owino, Kisementi and Nakivubo',
    detail:
      'The central region supplies the city daily. Traders here have coped with flooding, rising rents and enforcement drives, and KCCA has said 550 spaces sit vacant across Wandegeya, Rusafi, Nakawa and Luzira while new vendors are turned away.',
  },
  {
    name: 'Masaka & Sembabule',
    location: 'Southern Region',
    specialty: 'Maize, Robusta coffee, and the districts hit hardest by drought',
    detail:
      'Greater Masaka, Kyotera and Sembabule were named directly in this season’s drought reporting, with flowering, cherry development and bean filling all affected. Irrigated smallholders in districts like Agago have kept harvesting while their neighbours could not.',
  },
  {
    name: 'Mbarara & Bushenyi',
    location: 'Western Region',
    specialty: 'Bananas, tea and smallholder dairy',
    detail:
      'Kagadi’s tea growers were among the first to receive this season’s organic mineral fertiliser allocations, distributed at the Muzizi estate. Kagadi records tea as one of the district’s leading export crops.',
  },
  {
    name: 'Mbale & Tororo',
    location: 'Eastern Region',
    specialty: 'Soybean, groundnuts and the oilseed belt',
    detail:
      'The eastern oilseed belt is where Uganda’s crushing shortfall bites hardest. Processors have been paying strong farm-gate prices and still cannot fill capacity, which is a supply problem rather than a demand one.',
  }
];

export default function AboutPage({ onBack, onMenuClick, onCartClick, cartCount }: AboutPageProps) {
  return (
    <div className="bg-[#ffffff] relative size-full select-none">
      {/* Status Bar */}
      <StatusBar />

      {/* Header */}
      <div className="absolute bg-[#ffffff] h-[149px] left-0 right-0 top-0 z-10">
        <div className="absolute border-[0px_0px_1px] border-neutral-200 border-solid inset-0 pointer-events-none shadow-[0px_0px_20px_0px_rgba(0,0,0,0.1)]" />

        {/* Mobile Nav */}
        <div className="absolute bg-[#ffffff] h-16 left-0 overflow-clip right-0 top-[31px]">
          <div className="absolute bg-[#ffffff] h-[66px] left-0 top-0 w-[393px]" />
          <div
            className="absolute flex flex-col font-serif font-medium justify-center leading-[0] text-brand text-[24px] text-center text-nowrap top-9 tracking-[-0.24px] translate-x-[-50%] translate-y-[-50%]"
            style={{ left: "calc(50% - 0.5px)" }}
          >
            <p className="block leading-none whitespace-pre text-[24px]">Mu Katale</p>
          </div>

          {/* Cart Icon */}
          <button 
            onClick={onCartClick}
            aria-label="View basket"
            className="absolute right-5 rounded-2xl size-8 top-[18px] cursor-pointer"
          >
            <div className="size-8">
              <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 32 32">
                <g>
                  <path d={svgPaths.p2003cd00} fill="var(--fill-0, black)" />
                </g>
              </svg>
            </div>
            {cartCount > 0 && (
              <div className="absolute bg-brand left-[17px] rounded-lg size-4 top-[-1px]">
                <div className="flex flex-col items-center justify-center relative size-full">
                  <div className="box-border content-stretch flex flex-col gap-2 items-center justify-center px-0.5 py-px relative size-4">
                    <div className="flex flex-col font-medium justify-center leading-[0] not-italic relative shrink-0 text-[#ffffff] text-[12px] text-center text-nowrap tracking-[-0.12px]">
                      <p className="block leading-none whitespace-pre text-[9px]">{cartCount}</p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </button>

          {/* Menu Hamburger */}
          <button
            onClick={onMenuClick}
            aria-label="Open navigation menu"
            className="absolute left-5 rounded-2xl size-8 top-[18px] flex items-center justify-center cursor-pointer"
          >
            <div className="h-1.5 w-[18px]">
              <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 18 8">
                <g>
                  <line stroke="var(--stroke-0, black)" strokeWidth="1.5" x2="18" y1="1.25" y2="1.25" />
                  <line stroke="var(--stroke-0, black)" strokeWidth="1.5" x2="18" y1="7.25" y2="7.25" />
                </g>
              </svg>
            </div>
          </button>
        </div>

        {/* Sub Nav */}
        <div className="absolute left-6 right-6 top-[103px]">
          <div className="box-border content-stretch flex flex-col gap-4 items-end justify-end p-0 relative w-full">
            <div className="relative shrink-0 w-full">
              <div className="box-border content-stretch flex flex-row font-normal items-center justify-start leading-[0] p-0 relative text-left w-full">
                <div className="basis-0 flex flex-col font-serif font-normal grow justify-center min-h-px min-w-px relative shrink-0 text-[#000000] text-[24px] tracking-[-0.48px]">
                  <p className="block leading-[32px] text-[24px]">Who we are</p>
                </div>
                <button
                  onClick={onBack}
                  className="cursor-pointer flex items-center font-normal not-italic relative shrink-0 text-brand text-[14px] text-nowrap tracking-[-0.14px] hover:opacity-80 transition-opacity"
                >
                  <div className="flex flex-row items-center gap-1">
                    <div className="w-3 h-3">
                      <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 12 12">
                        <path d="M7.5 9L4.5 6L7.5 3" stroke="#426b1f" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                    <p className="block leading-[24px] whitespace-pre">Back</p>
                  </div>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="absolute left-0 right-0 top-[149px] bottom-0 overflow-y-auto">
        <div className="px-6 pt-6 pb-10 space-y-6">
          {/* Mission Statement Hero */}
          <ExpandableCard
            className="border border-brand/20 bg-brand/5 rounded-2xl p-5"
            expandLabel="Read our story"
            preview={
              <div className="space-y-3">
                <span className="text-[11px] font-semibold text-brand uppercase tracking-wider">
                  Our Mission
                </span>
                <h2 className="font-serif font-normal text-[22px] text-[#000000] leading-[28px]">
                  Getting Ugandan produce from the farm to the market without losing the farmer.
                </h2>
                <p className="font-normal text-[14px] text-muted-foreground leading-[22px]">
                  Mu Katale means &ldquo;in the market&rdquo;. Kampala&rsquo;s central markets move most of the fresh produce sold in the city, yet a tomato picked an hour outside Kampala can change hands three or four times before it reaches a plate.
                </p>
              </div>
            }
            detail={
              <div className="font-normal text-[14px] text-muted-foreground leading-[22px] space-y-3">
                <p>
                  Every handover in that chain adds a margin nobody has to justify. We shorten it. We name the
                  district a product came from, we publish the farm-gate reference next to our price, and we price
                  in whole shillings rather than hiding decimals in a currency the grower does not trade in.
                </p>
                <p>
                  Uganda&rsquo;s smallholders are not short of enterprise. They are short of irrigation, storage and a
                  dependable buyer. The national plan is to bring 1.5 million hectares under irrigation by 2040, and
                  district programmes such as Agago&rsquo;s micro-scale irrigation scheme already show what that buys:
                  a farmer earning Shs4.5m from three-quarters of an acre of tomatoes through a dry spell.
                </p>
              </div>
            }
          />

          {/* Commitments */}
          <div className="space-y-3">
            <h3 className="font-medium text-[16px] text-[#000000] tracking-[-0.16px]">
              Our Commitments
            </h3>
            <div className="grid grid-cols-1 gap-3">
              {VALUES.map((item) => (
                <ExpandableCard
                  key={item.title}
                  className="p-4 border border-neutral-200 rounded-xl bg-white"
                  expandLabel="Read more"
                  preview={
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <h4 className="font-serif font-normal text-[18px] text-[#000000]">
                          {item.title}
                        </h4>
                        <span className="shrink-0 text-[14px] font-bold text-brand bg-brand/10 px-2 py-0.5 rounded">
                          {item.stat}
                        </span>
                      </div>
                      <p className="font-normal text-[13px] text-muted-foreground leading-[20px] line-clamp-3">
                        {item.description}
                      </p>
                      <p className="text-[11px] font-normal text-brand leading-[16px]">
                        {item.statLabel}
                      </p>
                    </div>
                  }
                  detail={
                    <div className="space-y-2">
                      <p className="font-normal text-[13px] text-muted-foreground leading-[20px]">
                        {item.description}
                      </p>
                      <p className="text-[11px] font-normal text-brand leading-[16px]">
                        {item.statLabel}
                      </p>
                    </div>
                  }
                />
              ))}
            </div>
          </div>

          {/* Sourcing Regions */}
          <div className="space-y-3">
            <h3 className="font-medium text-[16px] text-[#000000] tracking-[-0.16px]">
              Where We Buy
            </h3>
            <div className="space-y-2">
              {REGIONS.map((region) => (
                <ExpandableCard
                  key={region.name}
                  className="p-3.5 border border-neutral-100 bg-[#fbfbfb] rounded-xl"
                  preview={
                    <div className="space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-[14px] text-[#000000]">
                          {region.name}
                        </span>
                        <span className="shrink-0 text-[12px] text-brand font-medium">
                          {region.location}
                        </span>
                      </div>
                      <p className="text-[12px] font-normal text-muted-foreground line-clamp-2">
                        {region.specialty}
                      </p>
                    </div>
                  }
                  detail={
                    <div className="space-y-1.5">
                      <p className="text-[12px] font-normal text-[#000000]">
                        {region.specialty}
                      </p>
                      <p className="text-[12px] font-normal text-muted-foreground leading-[18px]">
                        {region.detail}
                      </p>
                    </div>
                  }
                />
              ))}
            </div>
          </div>

          {/* Footer note */}
          <div className="pt-2 text-center text-muted-foreground font-normal text-[12px] space-y-1">
            <p>Prices in Ugandan shillings &bull; Figures sourced from Ugandan market reporting</p>
            <p className="text-[11px] text-[#9a9a9a]">
              Mu Katale means &ldquo;in the market&rdquo;
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
