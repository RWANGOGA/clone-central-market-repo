import { motion, AnimatePresence } from 'framer-motion';

interface MenuProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (screen: string) => void;
  isLoggedIn?: boolean;
}

export default function Menu({ isOpen, onClose, onNavigate, isLoggedIn = false }: MenuProps) {
  const handleNavigation = (screen: string) => {
    onNavigate(screen);
    onClose();
  };

  const menuItems = isLoggedIn
    ? [
        { label: "Shop", screen: "list" },
        { label: "Coverage map", screen: "map" },
        { label: "Newsstand", screen: "newsstand" },
        { label: "Who we are", screen: "about" },
        { label: "My Page", screen: "profile" },
        { label: "Basket", screen: "basket" },
      ]
    : [
        { label: "Shop", screen: "list" },
        { label: "Coverage map", screen: "map" },
        { label: "Newsstand", screen: "newsstand" },
        { label: "Who we are", screen: "about" },
        { label: "Sign in", screen: "login" },
        { label: "Basket", screen: "basket" },
      ];

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="absolute inset-0 bg-black/50 z-40"
            onClick={onClose}
          />

          {/* Menu */}
          <motion.div
            initial={{ x: "-100%" }}
            animate={{ x: "0%" }}
            exit={{ x: "-100%" }}
            transition={{
              type: "spring",
              damping: 25,
              stiffness: 400,
              mass: 0.8
            }}
            className="absolute left-0 top-0 bottom-0 w-[280px] bg-brand z-50 overflow-hidden"
          >
            {/* Background Illustration */}
            <MaskGroup />

            {/* Menu Items */}
            <MenuItems onNavigate={handleNavigation} items={menuItems} />

            {/* Staff door. The admin console is a separate, email-based login at
                /staff, not the shopper phone login. Reached by client-side
                navigation so it works without typing a deep link (which on
                GitHub Pages leans on a fragile 404 fallback). Kept discreet so
                shoppers don't mistake it for their own account. */}
            <button
              onClick={() => handleNavigation('staff')}
              className="absolute bottom-6 left-4 font-sans text-[13px] tracking-wide text-white/60 hover:text-white transition-colors"
            >
              Staff sign in
            </button>

            {/* Close Button */}
            <CloseButton onClick={onClose} />
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function MaskGroup() {
  return null;
}

interface MenuItemsProps {
  onNavigate: (screen: string) => void;
  items: { label: string; screen: string }[];
}

function MenuItems({ onNavigate, items }: MenuItemsProps) {
  return (
    <div className="absolute left-4 top-[95px]">
      <div className="box-border content-stretch flex flex-col gap-8 items-start justify-start p-0 relative">
        {items.map((item) => (
          <button
            key={item.screen}
            onClick={() => onNavigate(item.screen)}
            className="flex flex-col font-serif font-normal justify-center leading-[0] relative shrink-0 text-white text-[26px] text-left text-nowrap tracking-[-0.52px] hover:opacity-80 transition-opacity"
          >
            <p className="block leading-[30px] whitespace-pre text-[36px]">
              {item.label}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}

interface CloseButtonProps {
  onClick: () => void;
}

function CloseButton({ onClick }: CloseButtonProps) {
  return (
    <button
      onClick={onClick}
      className="absolute block cursor-pointer left-[14px] overflow-visible rounded-2xl size-6 top-[35px] hover:opacity-80 transition-opacity"
    >
      <div className="absolute h-[9.5px] left-[5px] top-[5px] w-[9.6px]">
        <div className="absolute bottom-[-4.167%] left-[-4.123%] right-[-4.123%] top-[-4.167%]">
          <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 15 15">
            <g>
              <path
                d="M1 1.00003L13.7279 13.7279"
                stroke="var(--stroke-0, white)"
                strokeWidth="1.5"
              />
              <path
                d="M1.13605 13.7279L13.864 1"
                stroke="var(--stroke-0, white)"
                strokeWidth="1.5"
              />
            </g>
          </svg>
        </div>
      </div>
    </button>
  );
}