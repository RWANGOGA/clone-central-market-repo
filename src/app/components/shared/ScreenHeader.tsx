import React from 'react';
import svgPaths from '../../imports/svg-toln6of0ig';
import { PageTitle } from './PageTitle';

/**
 * The bar every shop screen opens with.
 *
 * Each screen used to carry its own copy of this markup as the Figma export
 * wrote it: a 393px-wide box, a wordmark pinned with `left: calc(50% - 0.5px)`
 * and `translate-x-[-50%]`, a cart icon at `top-[18px]`, a title row at
 * `top-[103px]`. Nothing could reflow, because every position was a distance
 * from the top of a canvas that no longer exists — on a 320px phone the wordmark
 * and the cart badge competed for the same pixel, and on a wider screen the copy
 * stayed in a 393px column while the frame around it grew.
 *
 * This is one flow layout: a grid of `1fr auto 1fr`, which centres the wordmark
 * without measuring anything, and a title row that wraps when it has to. The
 * sixteen copies it replaces differed only in which icon they showed.
 */

type ScreenHeaderProps = {
  /** The name of the screen, as the reader is told it. */
  title: React.ReactNode;
  cartCount?: number;
  onCartClick?: () => void;
  onMenuClick?: () => void;
  /** Renders a quiet "Back" affordance beside the title. */
  back?: { label?: string; onClick: () => void };
  /** Anything between the title row and the body: search, sort chips. */
  children?: React.ReactNode;
};

function CartIcon() {
  return (
    <svg className="block size-full" fill="none" viewBox="0 0 32 32">
      <path d={svgPaths.p2003cd00} fill="var(--fill-0, currentColor)" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg className="block size-full" fill="none" viewBox="0 0 18 8">
      <line stroke="currentColor" strokeWidth="1.5" x2="18" y1="1.25" y2="1.25" />
      <line stroke="currentColor" strokeWidth="1.5" x2="18" y1="7.25" y2="7.25" />
    </svg>
  );
}

export function ScreenHeader({ title, cartCount = 0, onCartClick, onMenuClick, back, children }: ScreenHeaderProps) {
  return (
    <header className="bg-background border-b border-neutral-200 px-5 pb-4 pt-3 shadow-[0_0_20px_0px_rgba(0,0,0,0.06)]">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center">
        <div className="justify-self-start">
          {onMenuClick && (
            <button
              onClick={onMenuClick}
              aria-label="Open menu"
              className="flex size-8 cursor-pointer items-center justify-center rounded-2xl text-foreground"
            >
              <span className="h-1.5 w-[18px]">
                <MenuIcon />
              </span>
            </button>
          )}
        </div>

        <span className="whitespace-nowrap font-serif text-brand text-display font-medium">Mu Katale</span>

        <div className="justify-self-end">
          {onCartClick && (
            <button
              onClick={onCartClick}
              aria-label={cartCount > 0 ? `Basket, ${cartCount} items` : 'Basket, empty'}
              className="relative size-8 cursor-pointer rounded-2xl text-foreground"
            >
              <CartIcon />
              {cartCount > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-lg bg-brand px-0.5 text-[12px] font-medium leading-none text-white">
                  {cartCount}
                </span>
              )}
            </button>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1">
        <PageTitle>{title}</PageTitle>
        {back && (
          <button
            onClick={back.onClick}
            className="flex shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap text-brand text-sm font-normal"
          >
            <span className="size-3">
              <svg className="block size-full" fill="none" viewBox="0 0 12 12">
                <path
                  d="M7.5 9L4.5 6L7.5 3"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            {back.label ?? 'Back'}
          </button>
        )}
      </div>

      {children && <div className="mt-4">{children}</div>}
    </header>
  );
}

export default ScreenHeader;
