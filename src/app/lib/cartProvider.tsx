import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from 'react';
import { resolveCartId, addItem as apiAddItem, updateItem, fetchCart, startFreshCart, reorderOrder, CartError, type ReorderResult } from './cartApi';
import { toAppliedPromo, validatePromo, type AppliedPromo, type PromoResult } from './promoApi';
import { fetchStock, applyStockDelta, type StockLevel } from './stockApi';
import { useCatalogue, type CatalogueProduct } from './catalogue';

/**
 * The compiled-in catalogue. Used as the shop's fallback when the API cannot be
 * reached, and as the source an admin's additions are merged into. The live
 * catalogue comes from /api/products so an admin can add products at runtime.
 */
export const FALLBACK_CATALOGUE: CatalogueProduct[] = [
  {
    id: 1,
    name: "Garlic clove",
    price: "USh 3,524 each",
    priceValue: 3524,
    stock: 120,
    unit: 'each',
    farm: "Bukalasi Farm",
    images: [
      "figma:asset/39a095c5219433210528f313f4db7ed09e8b6466.png",
      "figma:asset/c7319cef2b86a8f71b6765b77a10caccb7fc8b83.png",
    ],
    isFavorite: false,
    description: "Bold, aromatic garlic cloves with a rich, complex flavor. Perfect for roasting, sautéing, or adding depth to any dish.",
    location: "Grown in Sironko District by Bukalasi Farm",
    dietary: ["VG", "GF", "DF"]
  },
  {
    id: 2,
    name: "Sugar snap pea",
    price: "USh 19,992/kg",
    priceValue: 19992,
    stock: 36,
    unit: 'kg',
    farm: "Rwambari Farm",
    images: [
      "figma:asset/1b41f753535d961cfbba08b0eb03a1902c09f7f3.png",
      "figma:asset/c7319cef2b86a8f71b6765b77a10caccb7fc8b83.png",
    ],
    isFavorite: false,
    description: "Crisp, sweet sugar snap peas with edible pods. Enjoy raw as a snack or lightly steamed to preserve their natural crunch.",
    location: "Grown in Kyegegwa District by Rwambari Farm",
    dietary: ["VG", "GF", "DF"]
  },
  {
    id: 3,
    name: "Ginger",
    price: "USh 36,667/kg",
    priceValue: 36667,
    stock: 27,
    unit: 'kg',
    farm: "Bungokho Farm",
    images: ["figma:asset/07e73d3701b2c2cf9a8054b1b2606088545c1b53.png"],
    isFavorite: false,
    description: "Fresh, organic ginger root with a warm, spicy kick. Essential for Asian cooking and natural wellness remedies.",
    location: "Grown in Mbale District by Bungokho Farm",
    dietary: ["VG", "GF", "DF"]
  },
  {
    id: 4,
    name: "Sweet onion",
    price: "USh 3,404/kg",
    priceValue: 3404,
    stock: 91,
    unit: 'kg',
    farm: "Kyarakora Farm",
    images: ["figma:asset/345d9f75120e49e4b6f691447bccd48abfb67431.png"],
    isFavorite: false,
    description: "Mild, sweet onions perfect for caramelizing or eating raw. Low in sulfur with a delicate, pleasant flavor.",
    location: "Grown in Kabale District by Kyarakora Farm",
    dietary: ["VG", "GF", "DF"]
  },
  {
    id: 5,
    name: "Raspberries",
    price: "USh 15,800 pint",
    priceValue: 15800,
    stock: 45,
    unit: 'pint',
    farm: "Ngarama Farm",
    images: ["figma:asset/28818bcf637e7596ffec2602b44c1b407fe11cf9.png"],
    isFavorite: false,
    description: "Juicy, sweet-tart raspberries bursting with flavor. Rich in antioxidants and perfect for snacking or desserts.",
    location: "Grown in Mbarara District by Ngarama Farm",
    dietary: ["VG", "GF", "DF"]
  },
  {
    id: 6,
    name: "Bananas",
    price: "USh 5,587/kg",
    priceValue: 5587,
    stock: 136,
    unit: 'kg',
    farm: "Rwekubo Farm",
    images: ["figma:asset/d55ecea918fdfbe2d236a4386a73a981bf45f319.png"],
    isFavorite: false,
    description: "Sweet, creamy bananas perfect for smoothies, baking, or eating fresh. A great source of potassium and natural energy.",
    location: "Grown in Isingiro District by Rwekubo Farm",
    dietary: ["VG", "GF", "DF"]
  },
  {
    id: 7,
    name: "Avocados",
    price: "USh 4,158 each",
    priceValue: 4158,
    stock: 90,
    unit: 'each',
    farm: "Najjera Farm",
    images: ["figma:asset/464f20b81f02057b5cc69adbc19fb20af709c271.png"],
    isFavorite: false,
    description: "Creamy, buttery avocados rich in healthy fats. Perfect for guacamole, toast, or adding to salads and smoothies.",
    location: "Grown in Wakiso District by Najjera Farm",
    dietary: ["VG", "GF", "DF"]
  },
  {
    id: 8,
    name: "Kale",
    price: "USh 7,880 each",
    priceValue: 7880,
    stock: 75,
    unit: 'each',
    farm: "Kawolo Farm",
    images: ["figma:asset/365c8fc0f53d1bc2bad0988227099e87b4730cbc.png"],
    isFavorite: false,
    description: "Nutrient-dense kale with a robust, earthy flavor. Excellent for salads, smoothies, or crispy kale chips.",
    location: "Grown in Mityana District by Kawolo Farm",
    dietary: ["VG", "GF", "DF"]
  },
  {
    id: 9,
    name: "Radish",
    price: "USh 5,108 each",
    priceValue: 5108,
    stock: 110,
    unit: 'each',
    farm: "Nkolokoto Farm",
    images: ["figma:asset/f286a5e73a18e796afd61d7b68c51addff2c69b6.png"],
    isFavorite: false,
    description: "Crisp, peppery radishes with a fresh, clean bite. Great for salads, pickling, or as a crunchy snack.",
    location: "Grown in Mpigi District by Nkolokoto Farm",
    dietary: ["VG", "GF", "DF"]
  }
];

/** How often the catalogue re-reads stock from the inventory service. */
const STOCK_POLL_MS = 30_000;

type SortOption = 'default' | 'a-z' | 'price';

export interface CartItem {
  id: number;
  name: string;
  price: string;
  priceValue: number;
  image: string;
  quantity: number;
  unit: string;
}

interface OverlayProduct {
  id: number;
  name: string;
  image: string;
}

/** What a reorder actually achieved, for the confirmation the profile shows. */
export interface ReorderOutcome {
  added: number;
  skipped: { name: string; reason: string }[];
}

/**
 * Cart lines are always built from the local catalogue, whether they arrive
 * from a tap or from the API on reload, so the basket always renders with the
 * same name, price and image as the product list.
 */
function buildCartItem(product: CatalogueProduct, quantity: number): CartItem {
  return {
    id: product.id,
    name: product.name,
    price: product.price,
    priceValue: product.priceValue,
    image: product.images[0],
    quantity,
    unit: product.unit,
  };
}

interface CartContextType {
  products: CatalogueProduct[];
  catalogueLive: boolean;
  cartItems: CartItem[];
  cartId: number | null;
  favorites: Set<number>;
  searchTerm: string;
  sortOption: SortOption;
  cartCount: number;
  stockLevels: Map<number, StockLevel>;
  stockLive: boolean;
  overlayProduct: OverlayProduct | null;
  overlayQuantity: number;
  showOverlay: boolean;
  /** The code the shopper applied, as agreed with the server. */
  promo: AppliedPromo | null;
  addToCart: (productId?: number, quantityToAdd?: number) => void;
  updateCartItemQuantity: (productId: number, quantity: number) => void;
  toggleFavorite: (productId: number) => void;
  setSearchTerm: (term: string) => void;
  setSortOption: (option: SortOption) => void;
  applyPromo: (code: string) => Promise<PromoResult>;
  clearPromo: () => void;
  finalizePurchase: (serverCartId: number | null) => void;
  reorderFromOrder: (reference: string) => Promise<ReorderOutcome | null>;
}

const CartContext = createContext<CartContextType | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [cartId, setCartId] = useState<number | null>(null);
  const [favorites, setFavorites] = useState<Set<number>>(new Set());
  const [searchTerm, setSearchTerm] = useState('');
  const [sortOption, setSortOption] = useState<SortOption>('default');
  const [promo, setPromo] = useState<AppliedPromo | null>(null);

  // Server cart. Null means the API is not running and the cart stays local.
  const cartIdRef = useRef<number | null>(null);

  // Live stock, keyed by product id.
  const [stockLevels, setStockLevels] = useState<Map<number, StockLevel>>(new Map());
  const [stockLive, setStockLive] = useState(false);

  // Add to cart overlay state
  const [showOverlay, setShowOverlay] = useState(false);
  const [overlayProduct, setOverlayProduct] = useState<OverlayProduct | null>(null);
  const [overlayQuantity, setOverlayQuantity] = useState(1);

  const { products, live: catalogueLive } = useCatalogue(FALLBACK_CATALOGUE);

  const cartCount = cartItems.reduce((sum, item) => sum + item.quantity, 0);

  // A code is tied to a basket; once the basket is emptied there is nothing
  // left for it to discount, so it is dropped rather than silently kept.
  useEffect(() => {
    if (cartItems.length === 0) setPromo(null);
  }, [cartItems.length]);

  // Poll stock so the figures stay current without a manual refresh.
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const result = await fetchStock();
      if (cancelled) return;
      if (result) {
        setStockLevels(result.levels);
        setStockLive(true);
      }
    };

    load();
    const timer = window.setInterval(load, STOCK_POLL_MS);

    const onVisible = () => {
      if (document.visibilityState === 'visible') load();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  // Restore the cart on load so a refresh does not empty the basket.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const cartId = await resolveCartId();
      if (cancelled) return;

      if (!cartId) return; // API not running, cart stays local-only
      cartIdRef.current = cartId;
      setCartId(cartId);

      const cart = await fetchCart(cartId);
      if (cancelled || !cart) return;

      const restored = cart.items.flatMap((line) => {
        const product = products.find((p) => p.id === line.productId);
        return product ? [buildCartItem(product, line.quantity)] : [];
      });

      setCartItems(restored);
    })();

    return () => {
      cancelled = true;
    };
  }, [products]);

  const toggleFavorite = (productId: number) => {
    const newFavorites = new Set(favorites);
    if (newFavorites.has(productId)) {
      newFavorites.delete(productId);
    } else {
      newFavorites.add(productId);
    }
    setFavorites(newFavorites);
  };

  const showAddToCartOverlay = (product: CatalogueProduct, quantity = 1) => {
    setOverlayProduct({ id: product.id, name: product.name, image: product.images[0] });
    setOverlayQuantity(quantity);
    setShowOverlay(true);
    setTimeout(() => setShowOverlay(false), 1000);
  };

  const addToCart = (productId?: number, quantityToAdd = 1) => {
    let targetProduct: CatalogueProduct | undefined;

    if (productId) {
      targetProduct = products.find((p) => p.id === productId);
    }

    if (!targetProduct) return;

    const product = targetProduct;
    const wasInCart = cartItems.some((item) => item.id === product.id);

    setCartItems((prevItems) => {
      const existingItem = prevItems.find((item) => item.id === product.id);

      if (existingItem) {
        return prevItems.map((item) =>
          item.id === product.id
            ? { ...item, quantity: item.quantity + quantityToAdd }
            : item
        );
      } else {
        return [...prevItems, buildCartItem(product, quantityToAdd)];
      }
    });

    showAddToCartOverlay(product, quantityToAdd);

    // Sync to the API. A network failure keeps the optimistic line (the cart
    // works offline), but a refusal means the server's stock or cart state is
    // authoritative and the local edit must be undone.
    const rollback = () => {
      setCartItems((prevItems) => {
        if (!wasInCart) return prevItems.filter((item) => item.id !== product.id);
        return prevItems
          .map((item) =>
            item.id === product.id
              ? { ...item, quantity: item.quantity - quantityToAdd }
              : item
          )
          .filter((item) => item.quantity > 0);
      });
    };

    const serverCartId = cartIdRef.current;
    if (serverCartId) {
      apiAddItem(serverCartId, product.id, quantityToAdd).catch((err) => {
        if (err instanceof CartError) rollback();
      });
    } else {
      resolveCartId().then((id) => {
        cartIdRef.current = id;
        setCartId(id);
        if (id) {
          apiAddItem(id, product.id, quantityToAdd).catch((err) => {
            if (err instanceof CartError) rollback();
          });
        }
      });
    }
  };

  const updateCartItemQuantity = (productId: number, quantity: number) => {
    const previous = cartItems.find((item) => item.id === productId);

    if (quantity === 0) {
      setCartItems((prevItems) => prevItems.filter((item) => item.id !== productId));
    } else {
      setCartItems((prevItems) =>
        prevItems.map((item) =>
          item.id === productId ? { ...item, quantity } : item
        )
      );
    }

    const serverCartId = cartIdRef.current;
    if (serverCartId) {
      updateItem(serverCartId, productId, quantity).catch((err) => {
        if (!(err instanceof CartError)) return;
        setCartItems((prevItems) =>
          previous
            ? prevItems.some((item) => item.id === productId)
              ? prevItems.map((item) =>
                  item.id === productId ? { ...item, quantity: previous.quantity } : item
                )
              : [...prevItems, previous]
            : prevItems.filter((item) => item.id !== productId)
        );
      });
    }
  };

  const finalizePurchase = useCallback((_serverCartId: number | null) => {
    setStockLevels((current) => {
      let next = current;
      for (const item of cartItems) {
        next = applyStockDelta(next, item.id, item.quantity);
      }
      return next;
    });
    setCartItems([]);
    setPromo(null);
    // The cart that became this order is `converted`; writing to it would be
    // refused. A new cart is the only correct next state.
    startFreshCart().then((id) => {
      cartIdRef.current = id;
      setCartId(id);
    });
  }, [cartItems]);

  /**
   * Quotes a code against the server's cart total and keeps it only when the
   * server agrees. The discount itself is still recomputed at order time.
   */
  const applyPromo = async (code: string): Promise<PromoResult> => {
    let id = cartIdRef.current;
    if (!id) {
      id = await resolveCartId();
      if (!id) return { ok: false, error: 'The basket service is unavailable right now.' };
      cartIdRef.current = id;
      setCartId(id);
    }
    const result = await validatePromo(id, code);
    if (result.ok) setPromo(toAppliedPromo(result.data));
    return result;
  };

  const clearPromo = () => setPromo(null);

  /**
   * Puts a past order back in the basket.
   *
   * The server owns the decision about what is still buyable; this function
   * only mirrors the cart it returns into local state. A converted cart (the
   * one the order was made from) cannot accept lines, so a fresh one is
   * opened and the request retried once.
   */
  const reorderFromOrder = async (reference: string): Promise<ReorderOutcome | null> => {
    let id = cartIdRef.current;
    if (!id) {
      id = await resolveCartId();
      if (!id) return null; // API not running; there is no server basket to fill
      cartIdRef.current = id;
      setCartId(id);
    }

    let result: ReorderResult | null;
    try {
      result = await reorderOrder(reference, id);
    } catch (err) {
      // A cart that has already become an order refuses new lines, and a cart
      // the browser no longer owns cannot be found. Both mean the saved cart
      // id is stale, so a new cart is opened and the request retried once.
      const stale =
        err instanceof CartError &&
        ((err.status === 409 && /no longer active/i.test(err.message)) ||
          (err.status === 404 && /cart not found/i.test(err.message)));
      if (!stale) throw err;
      const fresh = await startFreshCart();
      if (!fresh) return null;
      cartIdRef.current = fresh;
      setCartId(fresh);
      result = await reorderOrder(reference, fresh);
    }
    if (!result) return null;

    const restored = result.cart.items.flatMap((line) => {
      const product = products.find((p) => p.id === line.productId);
      return product ? [buildCartItem(product, line.quantity)] : [];
    });
    setCartItems(restored);

    return {
      added: result.added.reduce((sum, line) => sum + line.quantity, 0),
      skipped: result.skipped,
    };
  };

  const value: CartContextType = {
    products,
    catalogueLive,
    cartItems,
    cartId,
    favorites,
    searchTerm,
    sortOption,
    cartCount,
    stockLevels,
    stockLive,
    overlayProduct,
    overlayQuantity,
    showOverlay,
    promo,
    addToCart,
    updateCartItemQuantity,
    toggleFavorite,
    setSearchTerm,
    setSortOption,
    applyPromo,
    clearPromo,
    finalizePurchase,
    reorderFromOrder,
  };

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextType {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within a CartProvider');
  return ctx;
}
