import React from 'react';

/**
 * Headings, in one place.
 *
 * Until now every screen carried its own copy of the markup the Figma export
 * produced: a page title was a <p> buried inside three layout divs, so a
 * reader with a screen reader heard a wall of paragraphs and could not tell one
 * screen from another, and only five of the twenty-odd screens had an <h1> at
 * all. Two of them had two.
 *
 * These are real heading elements. They are centred because the wordmark above
 * them is centred: a title that hangs off the left of a centred header reads as
 * a mistake rather than as a design choice. Labels, field names and body copy
 * stay left-aligned, because centred text is hard to scan when you are reading
 * downward through a form — centring is for the thing you locate once, not for
 * the thing you read twice.
 *
 * Sizes come from the type scale in styles/globals.css rather than a pixel
 * literal, so a screen is laid out in rem and scales with the root font size
 * instead of being pinned to the 393px canvas it was drawn on.
 */

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

type TitleProps = {
  children: React.ReactNode;
  className?: string;
  /**
   * Downgrade the element when the heading level is already taken. A card
   * inside a list of cards is a heading, but not the heading of the page.
   */
  as?: 'h1' | 'h2' | 'h3';
  /**
   * The console packs a table and a form above the fold, so its headings carry
   * their weight by position rather than by size. The shop uses the display and
   * title steps; nothing reaches for a pixel literal.
   */
  size?: 'display' | 'title' | 'small';
  /**
   * `serif` is the shop voice. `label` is the console voice — the interface
   * face at medium weight, for a heading that sits above a table rather than
   * above a page.
   */
  family?: 'serif' | 'label';
};

const SIZES = {
  display: 'text-display',
  title: 'text-title',
  small: 'text-sm',
} as const;

const FAMILIES = {
  serif: 'font-serif font-normal',
  label: 'font-sans font-medium',
} as const;

/** The name of the screen, as a reader would be told it. */
export function PageTitle({ children, className, as = 'h1', size = 'display' }: TitleProps) {
  const Tag = as;
  return (
    <Tag
      className={cx(
        'basis-0 flex-1 font-serif font-normal min-w-0 text-center text-foreground',
        SIZES[size],
        className,
      )}
    >
      {children}
    </Tag>
  );
}

/** A heading for a block within a screen. */
export function SectionTitle({ children, className, as = 'h2', size = 'title', family = 'serif' }: TitleProps) {
  const Tag = as;
  return (
    <Tag
      className={cx('text-center text-foreground', FAMILIES[family], SIZES[size], className)}
    >
      {children}
    </Tag>
  );
}

/**
 * The leading half of a split title — "All Aisles" before "/ Produce". It is a
 * breadcrumb rather than the name of the page, so it is quiet and does not
 * repeat the heading.
 */
export function TitleContext({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cx('text-muted-foreground', className)} aria-hidden={false}>
      {children}
    </span>
  );
}
