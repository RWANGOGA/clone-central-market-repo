import React, { useState, type ReactNode } from 'react';

interface ExpandableCardProps {
  /** Always-visible content: title, price, byline. */
  preview: ReactNode;
  /** Revealed when the card is opened. */
  detail: ReactNode;
  /** Rendered outside the toggle, e.g. a bookmark button. */
  action?: ReactNode;
  /** Label shown while collapsed. */
  expandLabel?: string;
  defaultOpen?: boolean;
  className?: string;
  detailClassName?: string;
}

/**
 * A card the user can tap to read the rest of the content.
 *
 * The whole card body is the primary toggle, with a labelled control beneath
 * it. `action` renders outside both buttons so callers can pass something
 * interactive without nesting one button inside another.
 */
export default function ExpandableCard({
  preview,
  detail,
  action,
  expandLabel = 'Read more',
  defaultOpen = false,
  className = '',
  detailClassName = '',
}: ExpandableCardProps) {
  const [open, setOpen] = useState(defaultOpen);

  // Cards often sit inside a clickable parent row that navigates. Without this,
  // tapping "Read more" would expand and navigate at the same time.
  const toggle = (event: React.MouseEvent) => {
    event.stopPropagation();
    setOpen((value) => !value);
  };

  return (
    <div className={className}>
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          className="flex-1 min-w-0 text-left cursor-pointer"
        >
          {preview}
          {open && <div className={`mt-2 ${detailClassName}`}>{detail}</div>}
        </button>
        {action && <div className="shrink-0">{action}</div>}
      </div>

      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="mt-2 inline-flex items-center gap-1 text-[12px] font-normal text-brand hover:opacity-80 transition-opacity cursor-pointer"
      >
        {open ? 'Show less' : expandLabel}
        <svg
          className={`w-3 h-3 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 12 12"
          aria-hidden="true"
        >
          <path
            d="M2.5 4.5L6 8L9.5 4.5"
            className="stroke-brand"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}