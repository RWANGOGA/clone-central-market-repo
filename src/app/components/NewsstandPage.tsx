import React from 'react';
import StatusBar from './shared/StatusBar';
import ExpandableCard from './shared/ExpandableCard';
import svgPaths from "../imports/svg-s5y93igtx2";
import { PageTitle } from './shared/PageTitle';

interface NewsstandPageProps {
  onBack: () => void;
  onMenuClick: () => void;
  onCartClick: () => void;
  cartCount: number;
}

interface Article {
  id: string;
  category: string;
  title: string;
  readTime: string;
  date: string;
  author: string;
  source: string;
  summary: string;
  tag: string;
  heroColor: string;
}

/**
 * Newest first, so the lead card is the most recent story. Sourced from
 * Ugandan farm and market reporting; each entry credits its original outlet.
 * Summaries are written for this app rather than lifted from the source.
 */
const ARTICLES: Article[] = [
  {
    id: '1',
    category: 'Drought and irrigation',
    title: 'Three-Quarters of an Acre of Tomatoes Earns an Agago Farmer Shs4.5m',
    readTime: '4 min read',
    date: 'Oct 3, 2026',
    author: 'Kamwokya Times',
    source: 'Kamwokya Times',
    summary: 'Titus Okello of Tee-Ogwang Village harvested through a prolonged dry spell on a government-supported micro-scale irrigation system, one of 14 smallholders in Agago District using them. The district received Shs618m under the programme in 2023/24, and government contributions are capped at Shs7.2m per acre.',
    tag: 'Field Notes',
    heroColor: 'bg-[#5c7f38]/10',
  },
  {
    id: '2',
    category: 'AgriTech',
    title: 'Young Ugandan Innovators Split UGX 205m to Scale Farm Businesses',
    readTime: '5 min read',
    date: 'Oct 2, 2026',
    author: 'Vivian Tumushabe',
    source: 'Africa Agricultural Network',
    summary: 'Heifer International Uganda awarded eight enterprises at the AYuTe Africa Challenge Season 5, with Piipu General Enterprises and Revmake Tech Company taking UGX 50m each. Entries rose sharply to 836 applications from 307 in 2025, and two female-led agribusinesses received UGX 10m apiece.',
    tag: 'Field Notes',
    heroColor: 'bg-brand/10',
  },
  {
    id: '3',
    category: 'Commodity report',
    title: 'Oilseed Crushers in Uganda Run Far Below Capacity on Thin Soybean Supply',
    readTime: '3 min read',
    date: 'Oct 2, 2026',
    author: 'CMB News',
    source: 'CMB News',
    summary: 'One processor needing roughly 1,440 tonnes of oilseeds a year secured only about 240 tonnes in the past twelve months, around 17% of its requirement. Crushing capacity is expanding faster than planted area, and meteorological agencies project near-normal to above-normal rainfall for the September to December season.',
    tag: 'Market Prices',
    heroColor: 'bg-[#8ca862]/15',
  },
  {
    id: '4',
    category: 'Commodity report',
    title: 'Coffee Exports Fell 13.6% by Volume in August as Firmer Prices Cushioned the Drop',
    readTime: '4 min read',
    date: 'Oct 1, 2026',
    author: 'Ministry of Agriculture figures',
    source: 'Uganda Business News',
    summary: 'Uganda shipped 737,766 sixty-kilogram bags worth $181.7mn in August, against 853,543 bags a year earlier. The average export price rose to $4.10 per kilogram from $4.00 in July, and farm-gate robusta kiboko averaged Shs5,750 per kilogram, up from Shs5,500.',
    tag: 'Market Prices',
    heroColor: 'bg-[#8ca862]/15',
  },
  {
    id: '5',
    category: 'Grower profile',
    title: 'From 80kg to 400kg an Acre: What Quality Seed Did for Stella Kwagala',
    readTime: '3 min read',
    date: 'Oct 1, 2026',
    author: 'Ugnewsline',
    source: 'Ugnewsline',
    summary: 'The 32-year-old Buluguyi farmer in Bugiri District collected 983kg of soybean from two acres in Season A 2025 and sold 800kg at UGX 2,000 per kilogram. She expanded to two and a half acres the following season, harvested 1,240kg, and used the UGX 2m to help buy a Bajaj motorcycle for boda work in Kampala.',
    tag: 'Grower Story',
    heroColor: 'bg-[#5c7f38]/10',
  },
  {
    id: '6',
    category: 'Market policy',
    title: 'Kampala Traders Raise Flooding and Rent Concerns, KCCA Promises a Response',
    readTime: '4 min read',
    date: 'Sep 30, 2026',
    author: 'Shabibah Nakirigya',
    source: 'Daily Monitor',
    summary: 'Traders meeting KCCA at Kitante Primary School listed flooding, high rents, poor planning and taxis blocking shopfronts as their biggest pressures. KCCA Executive Director Sharifah Buzeki committed to reviewing flood compensation, market space and landlord relations, and said 550 vacant spaces sit in government markets at Wandegeya, Rusafi, Nakawa and Luzira.',
    tag: 'Market News',
    heroColor: 'bg-brand/10',
  },
];

export default function NewsstandPage({ onBack, onMenuClick, onCartClick, cartCount }: NewsstandPageProps) {
  const [selectedCategory, setSelectedCategory] = React.useState<string>('All');
  const [bookmarkedIds, setBookmarkedIds] = React.useState<Set<string>>(new Set());

  const categories = ['All', 'Market News', 'Market Prices', 'Field Notes', 'Grower Story'];

  const filteredArticles = selectedCategory === 'All' 
    ? ARTICLES 
    : ARTICLES.filter(a => a.tag === selectedCategory);

  const toggleBookmark = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setBookmarkedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="bg-[#ffffff] relative size-full select-none">
      {/* Status Bar */}
      <StatusBar />

      {/* Header */}
      <div className="absolute bg-[#ffffff] h-[149px] left-0 right-0 top-0 z-10">
        <div className="absolute border-[0px_0px_1px] border-neutral-200 border-solid inset-0 pointer-events-none shadow-[0px_0px_20px_0px_rgba(0,0,0,0.1)]" />

        {/* Mobile Nav Top Bar */}
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
                <PageTitle>Newsstand</PageTitle>
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

      {/* Main Scrollable Content */}
      <div className="absolute left-0 right-0 top-[149px] bottom-0 overflow-y-auto">
        <div className="px-6 pt-5 pb-8 space-y-5">
          {/* Tag Filter Pills */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-3 py-1.5 rounded-full text-[13px] font-normal whitespace-nowrap transition-colors ${
                  selectedCategory === cat 
                    ? 'bg-brand text-white font-medium' 
                    : 'bg-[#f5f5f5] text-muted-foreground hover:bg-neutral-200'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Lead Article Card */}
          {filteredArticles.length > 0 && (
            <div className="border border-neutral-200 rounded-xl overflow-hidden bg-white shadow-sm hover:border-brand/40 transition-all">
              <div className="p-4 bg-gradient-to-br from-brand/10 via-brand/5 to-white border-b border-neutral-100 flex items-start justify-between">
                <span className="text-[11px] uppercase tracking-wider font-semibold text-brand bg-white/80 px-2.5 py-1 rounded-md border border-brand/20">
                  {filteredArticles[0].category}
                </span>
              </div>
              <div className="p-4">
                <ExpandableCard
                  expandLabel="Read full story"
                  preview={
                    <div className="space-y-2.5">
                      <h3 className="font-serif font-normal text-[20px] text-[#000000] leading-[26px]">
                        {filteredArticles[0].title}
                      </h3>
                      <p className="font-normal text-[13px] text-muted-foreground leading-[20px] line-clamp-3">
                        {filteredArticles[0].summary}
                      </p>
                      <p className="text-[11px] font-normal text-[#9a9a9a] leading-[16px]">
                        {filteredArticles[0].source} &bull; {filteredArticles[0].date} &bull;{' '}
                        {filteredArticles[0].readTime}
                      </p>
                    </div>
                  }
                  detail={
                    <div className="space-y-2.5">
                      <p className="font-normal text-[13px] text-muted-foreground leading-[20px]">
                        {filteredArticles[0].summary}
                      </p>
                      <p className="text-[11px] font-normal text-brand leading-[16px]">
                        Reported by {filteredArticles[0].author} &bull; {filteredArticles[0].source} &bull;{' '}
                        {filteredArticles[0].date}
                      </p>
                    </div>
                  }
                  action={
                    <button
                      onClick={(e) => toggleBookmark(filteredArticles[0].id, e)}
                      className="text-brand hover:scale-110 transition-transform"
                      aria-label="Bookmark article"
                    >
                      <svg className="w-5 h-5" fill={bookmarkedIds.has(filteredArticles[0].id) ? "#426b1f" : "none"} viewBox="0 0 24 24" stroke="#426b1f" strokeWidth="1.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z" />
                      </svg>
                    </button>
                  }
                />
              </div>
            </div>
          )}

          {/* Secondary Articles */}
          <div className="space-y-3">
            {filteredArticles.slice(1).map(article => (
              <ExpandableCard
                key={article.id}
                className="p-4 border border-neutral-200 rounded-xl bg-white hover:border-brand/30 transition-all"
                preview={
                  <div className="flex flex-col gap-2">
                    <span className="text-[11px] font-semibold text-brand uppercase tracking-wide">
                      {article.category}
                    </span>
                    <h4 className="font-serif font-normal text-[17px] text-[#000000] leading-[22px]">
                      {article.title}
                    </h4>
                    <p className="font-normal text-[12px] text-muted-foreground leading-[18px] line-clamp-2">
                      {article.summary}
                    </p>
                    <p className="text-[11px] font-normal text-[#9a9a9a] leading-[16px]">
                      {article.source} &bull; {article.date} &bull; {article.readTime}
                    </p>
                  </div>
                }
                detail={
                  <div className="flex flex-col gap-2">
                    <p className="font-normal text-[12px] text-muted-foreground leading-[18px]">
                      {article.summary}
                    </p>
                    <p className="text-[11px] font-normal text-brand leading-[16px]">
                      Reported by {article.author} &bull; {article.source}
                    </p>
                  </div>
                }
                action={
                  <button
                    onClick={(e) => toggleBookmark(article.id, e)}
                    className="text-brand"
                    aria-label="Bookmark article"
                  >
                    <svg className="w-4 h-4" fill={bookmarkedIds.has(article.id) ? "#426b1f" : "none"} viewBox="0 0 24 24" stroke="#426b1f" strokeWidth="1.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z" />
                    </svg>
                  </button>
                }
              />
            ))}
          </div>

          {/* Community Bulletin Note */}
          <div className="bg-[#f8f9fa] border border-neutral-200 rounded-xl p-4 text-center space-y-1">
            <p className="font-serif font-normal text-[16px] text-brand">
              Mu Katale Gazette • Issue No. 42
            </p>
            <p className="font-normal text-[12px] text-muted-foreground">
              Reporting on Ugandan farms and markets. Each story credits its original outlet.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
