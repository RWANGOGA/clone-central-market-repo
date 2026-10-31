import React from 'react';
import QuantityDropdown from './QuantityDropdown';
import IconForward from '../imports/IconForward-2013-176';
import { formatUgx } from '../lib/currency';
import { assetUrl } from '../lib/apiBase';
import { discountFor, promoShortfall, type AppliedPromo, type PromoResult } from '../lib/promoApi';
import ScreenHeader from './shared/ScreenHeader';

interface CartItem {
  id: number;
  name: string;
  price: string;
  priceValue: number;
  image: string;
  quantity: number;
  unit: string;
}

interface BasketPageProps {
  cartItems: CartItem[];
  onBack: () => void;
  onMenuClick: () => void;
  onUpdateQuantity: (productId: number, quantity: number) => void;
  onGoToCheckout?: () => void;
  promo?: AppliedPromo | null;
  onApplyPromo?: (code: string) => Promise<PromoResult>;
  onClearPromo?: () => void;
  errorMessage?: string | null;
}

export default function BasketPage({ 
  cartItems, 
  onBack, 
  onMenuClick, 
  onUpdateQuantity,
  onGoToCheckout,
  promo,
  onApplyPromo,
  onClearPromo,
  errorMessage,
}: BasketPageProps) {
  const totalItems = cartItems.reduce((sum, item) => sum + item.quantity, 0);
  const subtotal = cartItems.reduce((sum, item) => sum + (item.priceValue * item.quantity), 0);
  const discount = promo ? discountFor(promo, subtotal) : 0;
  const shortfall = promo ? promoShortfall(promo, subtotal) : 0;

  const isEmpty = cartItems.length === 0;

  return (
    <div className="relative flex h-full flex-col bg-white">
      {/* Header */}
      <Header 
        cartCount={totalItems}
        onBack={onBack}
        onMenuClick={onMenuClick}
      />
      
      {isEmpty ? (
        /* Empty State */
        <EmptyBasket onReturnToShop={onBack} />
      ) : (
        <>
          {/* Scrollable Content Area */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="px-6 py-5">
              {errorMessage && <p role="alert" className="mb-4 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">{errorMessage}</p>}
              {/* Product List */}
              <div className="flex flex-col gap-4 mb-6">
                {cartItems.map((item) => (
                  <ProductItem
                    key={item.id}
                    item={item}
                    onUpdateQuantity={onUpdateQuantity}
                  />
                ))}
              </div>

              {onApplyPromo && onClearPromo && (
                <PromoSection
                  promo={promo ?? null}
                  subtotal={subtotal}
                  onApply={onApplyPromo}
                  onClear={onClearPromo}
                />
              )}

              {/* Subtotal - 24px below the last product card */}
              <div className="flex justify-between items-center">
                <div className="flex flex-col font-normal justify-center leading-[0] not-italic text-black text-[18px] text-left text-nowrap">
                  <p className="block leading-[1.45] whitespace-pre text-[18px]">Subtotal</p>
                </div>
                <div className="flex flex-col font-normal justify-center leading-[0] not-italic text-brand text-[18px] text-nowrap text-right">
                  <p className="block leading-[1.45] whitespace-pre text-[18px]">{formatUgx(subtotal)}</p>
                </div>
              </div>

              {promo && (
                <div className="mt-3 space-y-2">
                  <div className="flex justify-between items-center font-normal text-[14px]">
                    <span className="text-brand">Discount &middot; {promo.code}</span>
                    <span className="text-brand tabular-nums">
                      {discount > 0 ? `\u2212 ${formatUgx(discount)}` : formatUgx(0)}
                    </span>
                  </div>
                  {shortfall > 0 ? (
                    <p className="rounded-lg bg-amber-50 px-3 py-2 font-normal text-[12px] leading-[18px] text-amber-800">
                      Add {formatUgx(shortfall)} more to this basket and {promo.code} will apply.
                    </p>
                  ) : (
                    <div className="flex justify-between items-center font-medium text-[15px]">
                      <span className="text-black">Total before delivery</span>
                      <span className="text-brand tabular-nums">{formatUgx(subtotal - discount)}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
          
          {/* Footer */}
          <Footer onGoToCheckout={onGoToCheckout} />
        </>
      )}
    </div>
  );
}

interface PromoSectionProps {
  promo: AppliedPromo | null;
  subtotal: number;
  onApply: (code: string) => Promise<PromoResult>;
  onClear: () => void;
}

function PromoSection({ promo, subtotal, onApply, onClear }: PromoSectionProps) {
  const [code, setCode] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);

  const apply = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = code.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setMessage(null);
    const result = await onApply(trimmed);
    setBusy(false);
    if (result.ok) {
      setCode('');
    } else {
      setMessage(result.error);
    }
  };

  if (promo) {
    const shortfall = promoShortfall(promo, subtotal);
    return (
      <div className="mb-6 rounded-xl border border-brand/30 bg-brand/5 p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-medium text-[13px] text-brand">{promo.code}</p>
            {promo.description && (
              <p className="mt-0.5 font-normal text-[11px] leading-[16px] text-muted-foreground">
                {promo.description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClear}
            className="shrink-0 font-normal text-[12px] text-muted-foreground underline"
          >
            Remove
          </button>
        </div>
        {shortfall > 0 && (
          <p className="mt-2 font-normal text-[11px] leading-[16px] text-amber-700">
            Add {formatUgx(shortfall)} more for this code to apply.
          </p>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={apply} className="mb-6">
      <label
        htmlFor="promo-code"
        className="mb-1 block font-normal text-[13px] text-muted-foreground"
      >
        Promo code
      </label>
      <div className="flex gap-2">
        <input
          id="promo-code"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder="e.g. WELCOME10"
          autoCapitalize="characters"
          autoComplete="off"
          className="min-w-0 flex-1 rounded-lg border border-neutral-200 bg-white px-3 py-2 font-normal text-[14px] uppercase"
        />
        <button
          type="submit"
          disabled={busy || code.trim().length === 0}
          className="rounded-lg bg-brand px-4 py-2 font-medium text-[13px] text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? 'Checking…' : 'Apply'}
        </button>
      </div>
      {message && (
        <p role="alert" className="mt-1 font-normal text-[11px] leading-[16px] text-red-600">
          {message}
        </p>
      )}
    </form>
  );
}

interface EmptyBasketProps {
  onReturnToShop: () => void;
}

function EmptyBasket({ onReturnToShop }: EmptyBasketProps) {
  return (
    <div className="m-6 rounded-3xl bg-neutral-100">
      <div className="flex flex-col gap-4 p-6">
        <h2 className="font-serif text-display text-foreground">Your cart is empty!</h2>
        <p className="text-base text-muted-foreground">
          Nothing in the basket yet. Have a look at what is in today.
        </p>
        <button
          onClick={onReturnToShop}
          className="w-full cursor-pointer rounded-full bg-brand px-6 py-2 text-lg text-white"
        >
          Return to shop
        </button>
      </div>
    </div>
  );
}

// The fake phone status bar (9:41 clock, Wi-Fi and battery glyphs, notch) used
// to be drawn here. It has been removed app-wide: on a real handset the OS
// already shows the true clock, signal and battery, so the mock only ever
// duplicated them and overlapped the header. Screens now start at their own
// header.

interface HeaderProps {
  cartCount: number;
  onBack: () => void;
  onMenuClick: () => void;
}

function Header({ cartCount, onBack, onMenuClick }: HeaderProps) {
  return (
    <ScreenHeader
      title="My Basket"
      cartCount={cartCount}
      onMenuClick={onMenuClick}
      back={{ onClick: onBack }}
    />
  );
}

interface ProductItemProps {
  item: CartItem;
  onUpdateQuantity: (productId: number, quantity: number) => void;
}

function ProductItem({ item, onUpdateQuantity }: ProductItemProps) {
  const totalPrice = item.priceValue * item.quantity;

  const handleQuantityChange = (quantity: number) => {
    onUpdateQuantity(item.id, quantity);
  };

  return (
    <div className="bg-white h-[88px] relative shrink-0 w-full">
      <div className="absolute border-[0px_0px_1px] border-neutral-200 border-solid inset-0 pointer-events-none" />
      
      {/* Product Image */}
      <div
        className="absolute bg-[50%_50%] bg-cover bg-no-repeat left-0 rounded size-[72px] top-0"
        style={{ backgroundImage: `url('${assetUrl(item.image)}')` }}
      />
      
      {/* Product Name and Price */}
      <div className="absolute flex flex-col font-normal justify-center leading-[0] left-[86px] not-italic text-black text-[14px] text-left top-4 translate-y-[-50%] w-[173px]">
        <p className="leading-[16px]">
          <span className="text-black">
            {item.name}
            <span className="text-muted-foreground">
              {' '}
              &middot; {item.quantity} {item.unit}
            </span>
          </span>
          <span>
            <br />
          </span>
          <span className="text-brand">{item.price}</span>
        </p>
      </div>
      
      {/* Quantity Dropdown */}
      <div className="absolute left-[86px] top-11">
        <QuantityDropdown
          quantity={item.quantity}
          onQuantityChange={handleQuantityChange}
        />
      </div>
      
      {/* Total Price */}
      <div className="absolute flex flex-col font-normal justify-center leading-[0] not-italic right-0 text-muted-foreground text-[14px] text-nowrap text-right top-[58px] translate-y-[-50%]">
        <p className="block leading-[16px] whitespace-pre text-[16px]">{formatUgx(totalPrice)}</p>
      </div>
    </div>
  );
}

interface FooterProps {
  onGoToCheckout?: () => void;
}

function Footer({ onGoToCheckout }: FooterProps) {
  return (
    <div className="shrink-0 border-t border-neutral-200 bg-white px-6 py-4">
      <button
        onClick={onGoToCheckout}
        className="flex w-full cursor-pointer items-center justify-between rounded-lg bg-brand py-3 pl-6 pr-3 text-white"
      >
        <span className="text-base">Proceed to checkout</span>
        <span className="size-8 shrink-0">
          <IconForward />
        </span>
      </button>
    </div>
  );
}