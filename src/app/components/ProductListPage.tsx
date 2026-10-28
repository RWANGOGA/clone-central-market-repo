import StatusBar from './shared/StatusBar';
import svgPaths from "../imports/svg-s5y93igtx2";
import clsx from "clsx";
import { Input } from './ui/input';
import ExpandableCard from './shared/ExpandableCard';
import StockBadge from './StockBadge';
import type { StockLevel } from '../lib/stockApi';
import ScreenHeader from './shared/ScreenHeader';

interface Product {
  id: number;
  name: string;
  price: string;
  priceValue: number;
  farm: string;
  images: string[];
  isFavorite: boolean;
  description: string;
  location: string;
  dietary: string[];
  /** Live stock figure, replaced by the inventory service when reachable. */
  stock: number;
  unit: string;
}

type SortOption = 'default' | 'a-z' | 'price';

interface ProductListPageProps {
  products: Product[];
  favorites: Set<number>;
  searchTerm: string;
  sortOption: SortOption;
  cartCount: number;
  onSearchChange: (term: string) => void;
  onSortChange: (option: SortOption) => void;
  onToggleFavorite: (productId: number) => void;
  onAddToCart: (productId: number) => void;
  onProductClick: (product: Product) => void;
  onMenuClick: () => void;
  onCartClick: () => void;
  stockLevels: Map<number, StockLevel>;
  stockLive: boolean;
}

export default function ProductListPage({
  products,
  favorites,
  searchTerm,
  sortOption,
  cartCount,
  onSearchChange,
  onSortChange,
  onToggleFavorite,
  onAddToCart,
  onProductClick,
  onMenuClick,
  onCartClick,
  stockLevels,
  stockLive
}: ProductListPageProps) {
  return (
    <div className="flex h-full flex-col bg-[#ffffff]">
      {/* Status Bar */}
      <StatusBar />
      
      {/* Header */}
      <Header 
        cartCount={cartCount}
        searchTerm={searchTerm}
        onSearchChange={onSearchChange}
        sortOption={sortOption}
        onSortChange={onSortChange}
        onMenuClick={onMenuClick}
        onCartClick={onCartClick}
      />
      
      {/* Content */}
      <Content 
        products={products}
        favorites={favorites}
        onToggleFavorite={onToggleFavorite}
        onAddToCart={onAddToCart}
        onProductClick={onProductClick}
        stockLevels={stockLevels}
        stockLive={stockLive}
      />
    </div>
  );
}

interface HeaderProps {
  cartCount: number;
  searchTerm: string;
  onSearchChange: (term: string) => void;
  sortOption: SortOption;
  onSortChange: (option: SortOption) => void;
  onMenuClick: () => void;
  onCartClick: () => void;
}

/**
 * The shop front bar: where you are, what you are searching, and how the
 * aisle is ordered.
 *
 * The sort control used to read `$ -> $$`, which is a bargain-bin idiom from a
 * template and says nothing to someone buying garlic by the kilo; the price
 * field is in USh and the chip now says what it does. The search box used to be
 * a magnifier with the field hidden inside it until focus, so nobody knew the
 * shop could be searched at all.
 */
const SORTS: Array<{ key: SortOption; label: string }> = [
  { key: 'default', label: 'Default' },
  { key: 'a-z', label: 'A to Z' },
  { key: 'price', label: 'Price' },
];

function Header({ cartCount, searchTerm, onSearchChange, sortOption, onSortChange, onMenuClick, onCartClick }: HeaderProps) {
  return (
    <ScreenHeader
      title={<><span className="text-muted-foreground">All Aisles /</span> Produce</>}
      cartCount={cartCount}
      onCartClick={onCartClick}
      onMenuClick={onMenuClick}
    >
      <div className="flex flex-col gap-3">
        <div className="relative">
          <Input
            type="search"
            aria-label="Search produce"
            placeholder="Search produce"
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
            className="h-10 rounded-xl border border-[#e1e1e1] bg-[#fafaf8] pl-9 pr-3 text-[14px]"
          />
          <svg
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            fill="none"
            viewBox="0 0 20 20"
            stroke="currentColor"
            strokeWidth="1.6"
          >
            <circle cx="9" cy="9" r="6" />
            <path d="M13.5 13.5L17 17" strokeLinecap="round" />
          </svg>
        </div>

        <div className="flex flex-wrap gap-2" role="group" aria-label="Sort products">
          {SORTS.map(({ key, label }) => {
            const active = sortOption === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => onSortChange(key)}
                aria-pressed={active}
                className={clsx(
                  "cursor-pointer rounded-xl px-4 py-2 text-sm font-normal",
                  active ? "bg-brand text-white" : "border border-[#e1e1e1] text-foreground",
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>
    </ScreenHeader>
  );
}

interface ContentProps {
  products: Product[];
  favorites: Set<number>;
  onToggleFavorite: (productId: number) => void;
  onAddToCart: (productId: number) => void;
  onProductClick: (product: Product) => void;
  stockLevels: Map<number, StockLevel>;
  stockLive: boolean;
}

function Content({ products, favorites, onToggleFavorite, onAddToCart, onProductClick, stockLevels, stockLive }: ContentProps) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="box-border content-stretch flex flex-col gap-4 items-start justify-start relative w-full px-6 py-3">
        {products.map((product) => (
          <ProductCard
            key={product.id}
            product={product}
            isFavorite={favorites.has(product.id)}
            onToggleFavorite={() => onToggleFavorite(product.id)}
            onAddToCart={() => onAddToCart(product.id)}
            onClick={() => onProductClick(product)}
            stockLevel={stockLevels.get(product.id) ?? null}
            stockLive={stockLive}
          />
        ))}
      </div>
    </div>
  );
}

interface ProductCardProps {
  product: Product;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  onAddToCart: () => void;
  onClick: () => void;
  stockLevel: StockLevel | null;
  stockLive: boolean;
}

function ProductCard({ product, isFavorite, onToggleFavorite, onAddToCart, onClick, stockLevel, stockLive }: ProductCardProps) {
  // Sold out means the add button is pointless, so it is disabled rather than
  // left to fail later at payment.
  const soldOut = stockLevel?.state === 'out';
  const lowStock = stockLevel?.state === 'low';

  return (
    <div className="bg-[#ffffff] relative shadow-[0px_0px_20px_0px_rgba(0,0,0,0.1)] shrink-0 w-full rounded-[12px]">
      <div className="box-border content-stretch flex flex-row items-start justify-start overflow-clip p-0 relative w-full">
        {/* Product Image */}
        <div
          className="bg-[#ffffff] relative self-stretch shrink-0 w-[93px] cursor-pointer rounded-l-[12px]"
          style={{
            backgroundImage: `url('${product.images[0]}')${product.images[1] ? `, url('${product.images[1]}')` : ''}`,
            backgroundSize: 'cover'
          }}
          onClick={onClick}
        >
          <div className="absolute border-[px_1px_0px_0px] border-[rgba(0,0,0,0.1)] border-solid inset-0 pointer-events-none" />
        </div>
        
        {/* Product Info */}
        <div className="basis-0 grow min-h-px min-w-px relative self-stretch shrink-0 cursor-pointer" onClick={onClick}>
          <div className="flex flex-col justify-center relative size-full">
            <div className="box-border content-stretch flex flex-col gap-1 items-start justify-center pl-4 pr-8 py-4 relative size-full">
              <div className="relative shrink-0 w-full">
                <div className="box-border content-stretch flex flex-col font-normal gap-2 items-start justify-start leading-[0] not-italic p-0 relative text-left w-full">
                  <div className="flex flex-col justify-center relative shrink-0 text-[#000000] text-[0px] w-[173px]">
                    <p className="leading-[16px] text-[14px]">
                      {product.name}
                      <br />
                      <span className="text-brand">{product.price}</span>
                    </p>
                  </div>
                  <div className="relative shrink-0 text-muted-foreground text-[12px] text-nowrap">
                    <p className="block leading-[1.6] whitespace-pre text-[12px]">{product.farm} →</p>
                  </div>
                  <div className="pt-0.5">
                    <StockBadge level={stockLevel} stale={!stockLive} />
                  </div>
                  <ExpandableCard
                    className="w-full"
                    expandLabel="More"
                    preview={
                      <p className="text-[11px] font-normal text-muted-foreground leading-[16px] line-clamp-2">
                        {product.description}
                      </p>
                    }
                    detail={
                      <div className="space-y-2">
                        <p className="text-[11px] font-normal text-[#000000] leading-[16px]">
                          {product.description}
                        </p>
                        <p className="text-[11px] font-normal text-muted-foreground leading-[16px]">
                          {product.location}
                        </p>
                        <div className="flex flex-wrap gap-1">
                          {product.dietary.map((tag) => (
                            <span
                              key={tag}
                              className="text-[10px] font-medium text-brand bg-brand/10 border border-brand/20 rounded px-1.5 py-0.5"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      </div>
                    }
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
        
        {/* Heart Icon */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite();
          }}
          className="absolute right-2 top-2 size-8"
        >
          <HeartIcon filled={isFavorite} />
        </button>
        
        {/* Add to Cart Button. Disabled when sold out, because the order would
            only be refused at payment. */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (!soldOut) onAddToCart();
          }}
          disabled={soldOut}
          aria-label={soldOut ? `${product.name} is sold out` : `Add ${product.name} to basket`}
          className={`absolute bottom-2 right-2 rounded-lg size-8 flex items-center justify-center ${
            soldOut
              ? 'bg-neutral-200 cursor-not-allowed'
              : lowStock
                ? 'bg-[#b07d2b] hover:bg-[#96691f]'
                : 'bg-brand hover:bg-[#355214]'
          }`}
        >
          {soldOut ? <SoldOutIcon /> : <PlusIcon />}
        </button>
      </div>
    </div>
  );
}

function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <div className="size-8">
      <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 32 32">
        <g>
          {filled ? (
            <>
              <path
                d={svgPaths.p297cea80}
                fill="var(--fill-0, #FF8577)"
                fillOpacity="0.98"
              />
              <path
                d={svgPaths.p3bfbe380}
                fill="var(--fill-0, #FF8577)"
                fillOpacity="0.98"
              />
            </>
          ) : (
            <>
              <path
                d={svgPaths.p1177b300}
                stroke="var(--stroke-0, black)"
              />
              <path
                d={svgPaths.p1d24580}
                fill="var(--fill-0, #FF8577)"
                fillOpacity="0.98"
              />
            </>
          )}
        </g>
      </svg>
    </div>
  );
}

function SoldOutIcon() {
  return (
    <div className="size-8 flex items-center justify-center">
      <svg className="w-4 h-4" fill="none" viewBox="0 0 16 16" aria-hidden="true">
        <line stroke="#9a9a9a" strokeWidth="1.75" strokeLinecap="round" x1="4" y1="4" x2="12" y2="12" />
        <line stroke="#9a9a9a" strokeWidth="1.75" strokeLinecap="round" x1="12" y1="4" x2="4" y2="12" />
      </svg>
    </div>
  );
}

function PlusIcon() {
  return (
    <div className="size-8">
      <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 32 32">
        <g>
          <path d={svgPaths.p367b3d00} fill="var(--fill-0, white)" />
        </g>
      </svg>
    </div>
  );
}