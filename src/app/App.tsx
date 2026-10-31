import { useState, type ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useParams, useLocation } from 'react-router';
import { MotionConfig } from 'framer-motion';
import { CartProvider, useCart } from './lib/cartProvider';
import { AuthProvider, useAuth, type CustomerInfo } from './lib/authProvider';
import { TopUpProvider, useTopUp, type TopUpContextType } from './lib/topUpProvider';
import TopUpBar from './components/TopUpBar';
import { createOrder } from './lib/customerApi';

// Import all page components
import ProductListPage from './components/ProductListPage';
import ProductDetailPage from './components/ProductDetailPage';
import BasketPage from './components/BasketPage';
import CheckoutPage from './components/CheckoutPage';
import PaymentPage from './components/PaymentPage';
import OrderConfirmationPage from './components/OrderConfirmationPage';
import NewsstandPage from './components/NewsstandPage';
import AboutPage from './components/AboutPage';
import ProfilePage from './components/ProfilePage';
import LoginPage from './components/LoginPage';
import SignupPage from './components/SignupPage';
import AddToCartOverlay from './components/AddToCartOverlay';
import Menu from './components/Menu';
import MapPage from './components/MapPage';
import AdminPage from './components/AdminPage';

function ProductDetailRoute({ onMenuClick, topUp }: { onMenuClick: () => void; topUp: TopUpContextType }) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { products, cartCount, stockLevels, stockLive, addToCart } = useCart();
  const toppingUp = !!topUp.order;

  const productId = id ? Number(id) : NaN;
  const product = products.find((p) => p.id === productId);
  if (!product) return <Navigate to="/" replace />;

  return (
    <ProductDetailPage
      product={product}
      cartCount={cartCount}
      stockLevel={stockLevels.get(product.id) ?? null}
      stockLive={stockLive}
      onBack={() => navigate('/')}
      onAddToCart={async (quantity) => {
        // While an order is being topped up there is no basket to add to: the
        // cart became an order at checkout. The shop, with the order named in
        // its bar, is where the customer watches the total move.
        if (toppingUp) {
          if (await topUp.add(product.id, quantity)) navigate('/');
          return;
        }
        addToCart(product.id, quantity);
      }}
      onMenuClick={onMenuClick}
      onCartClick={() => navigate(toppingUp && topUp.reference ? `/?topUp=${topUp.reference}` : '/basket')}
      toppingUp={toppingUp}
      topUpBar={<TopUpBar topUp={topUp} />}
    />
  );
}

function OrderConfirmationRoute({ onMenuClick }: { onMenuClick: () => void }) {
  const { reference } = useParams<{ reference: string }>();
  const navigate = useNavigate();
  const { cartCount } = useCart();
  const { customerInfo } = useAuth();

  return (
    <OrderConfirmationPage
      cartCount={cartCount}
      customerInfo={customerInfo}
      orderReference={reference ?? null}
      onShop={() => navigate('/')}
      onMenuClick={onMenuClick}
      onPay={reference ? () => navigate(`/pay/${reference}`) : undefined}
    />
  );
}

function PaymentRoute({ onMenuClick, topUp }: { onMenuClick: () => void; topUp: TopUpContextType }) {
  const { reference } = useParams<{ reference: string }>();
  const navigate = useNavigate();
  const { cartCount, cartId } = useCart();
  const { customerInfo } = useAuth();

  return (
    <PaymentPage
      cartCount={cartCount}
      cartId={cartId}
      // The order was created at checkout; the URL is its reference, and the
      // server reads the amount from it.
      orderReference={reference ?? null}
      customerName={customerInfo.fullName}
      // The order was created (and the cart rotated) at checkout, so Back cannot
      // return to an editable checkout — it would be empty. Send the buyer to the
      // order itself, where it shows as awaiting payment with Pay available.
      onBack={() => navigate(reference ? `/order/${reference}` : '/basket')}
      onMenuClick={onMenuClick}
      onAddMore={() => reference && topUp.start(reference)}
      onProceedToConfirmation={() => navigate(`/order/${reference ?? ''}`)}
    />
  );
}

/**
 * GitHub Pages serves a project site under /<repository>/, while every route in
 * this app is written from the root. Vite injects the base it built with, so the
 * router can take it back off rather than read "/repo" as part of a route name.
 */
const BASENAME = import.meta.env.BASE_URL.replace(/\/+$/, '');

/**
 * Providers must wrap every component that reads their context, and the router
 * must wrap everything that calls useNavigate (including AuthProvider itself).
 * The shell below is the first component that is allowed to use those hooks.
 */
export default function App() {
  return (
    <BrowserRouter basename={BASENAME || undefined}>
      {/* framer-motion drives its animations in JavaScript, setting transforms
          frame by frame — the CSS prefers-reduced-motion block in globals.css
          cannot reach them. This honours the same user preference for the drawer
          and overlay motion. */}
      <MotionConfig reducedMotion="user">
        <CartProvider>
          <AuthProvider>
            <TopUpProvider>
              <AppShell />
            </TopUpProvider>
          </AuthProvider>
        </CartProvider>
      </MotionConfig>
    </BrowserRouter>
  );
}

function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const staffConsole = location.pathname.startsWith('/staff');
  const [isNavOpen, setIsNavOpen] = useState(false);
  const openMenu = () => setIsNavOpen(true);

  const {
    products,
    cartItems,
    cartId,
    cartReady,
    cartCount,
    favorites,
    addToCart,
    updateCartItemQuantity,
    toggleFavorite,
    searchTerm,
    sortOption,
    setSearchTerm,
    setSortOption,
    stockLevels,
    stockLive,
    showOverlay,
    overlayProduct,
    overlayQuantity,
    promo,
    applyPromo,
    clearPromo,
    reorderFromOrder,
    finalizePurchase,
  } = useCart();
  const {
    customerSession,
    customerInfo,
    login,
    logout,
    setCustomerInfo,
    purchaseError,
    setPurchaseError,
    setOrderReference,
  } = useAuth();
  const topUp = useTopUp();
  // An open order being topped up changes what "add" means everywhere in the
  // shop: it writes to the order instead of a cart that no longer exists.
  const toppingUp = !!topUp.order;

  const handleMenuNavigation = (screen: string) => {
    const routeMap: Record<string, string> = {
      list: '/',
      map: '/map',
      newsstand: '/news',
      about: '/about',
      profile: '/profile',
      basket: '/basket',
      login: '/login',
      staff: '/staff',
    };
    if (screen === 'profile' && !customerSession) {
      navigate('/login');
      return;
    }
    navigate(routeMap[screen] || '/');
  };

  const handleProceedToPayment = async (customerData: CustomerInfo) => {
    setCustomerInfo(customerData);
    setPurchaseError(null);
    if (!cartId || cartItems.length === 0) {
      setPurchaseError('Your basket could not be checked out. Please refresh and try again.');
      return;
    }

    try {
      const subtotal = cartItems.reduce((sum, item) => sum + item.priceValue * item.quantity, 0);
      // Only a code that still applies to this basket is sent; the server
      // recomputes it and refuses the order if it has since been exhausted.
      const promoCode = promo && subtotal >= promo.minSubtotal ? promo.code : undefined;
      const order = await createOrder(cartId, {
        fullName: customerData.fullName.trim(),
        phone: customerData.phone.trim(),
        region: customerData.region,
        district: customerData.district || undefined,
        subCounty: customerData.subCounty || undefined,
        parish: customerData.parish || undefined,
        village: customerData.village || undefined,
        address: customerData.address.trim(),
        // Only carried when the buyer actually used their current location; the
        // delivery is still routed on the validated region and district above.
        lat: customerData.lat,
        lng: customerData.lng,
        accuracyM: customerData.accuracyM,
        locationSource: customerData.locationSource,
      }, promoCode);
      if (!order.reference) throw new Error('The server did not return an order reference.');
      setOrderReference(order.reference);
      // The cart became this order on the server the instant it was created,
      // so spend it here rather than after payment. Otherwise a Back or reload
      // keeps pointing at the converted cart and every retry earns a 409.
      finalizePurchase(cartId);
      navigate(`/pay/${order.reference}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'We could not place your order. Please try again.';
      // A spent cart left over from an older session would otherwise retry
      // forever; rotate to a fresh basket and say so plainly instead of the
      // raw server wording.
      if (/no longer active/i.test(message)) {
        finalizePurchase(cartId);
        setPurchaseError('That basket had already been used to place an order. Start a new one below.');
      } else {
        setPurchaseError(message);
      }
      if (message.toLowerCase().includes('sold out')) {
        navigate('/basket');
      }
    }
  };

  return (
    <ShellFrame staff={staffConsole}>
        <Routes>
          <Route
            path="/"
            element={
              <ProductListPage
                products={products}
                favorites={favorites}
                searchTerm={searchTerm}
                sortOption={sortOption}
                cartCount={cartCount}
                onSearchChange={setSearchTerm}
                onSortChange={setSortOption}
                onToggleFavorite={toggleFavorite}
                onAddToCart={(productId) => {
                  if (toppingUp) {
                    void topUp.add(productId, 1);
                    return;
                  }
                  addToCart(productId, 1);
                }}
                onProductClick={(product) => navigate(`/product/${product.id}`)}
                onMenuClick={openMenu}
                onCartClick={() => navigate(toppingUp && topUp.reference ? `/?topUp=${topUp.reference}` : '/basket')}
                stockLevels={stockLevels}
                stockLive={stockLive}
                addableMarketId={toppingUp ? topUp.order?.marketId ?? null : undefined}
                topUpBar={<TopUpBar topUp={topUp} />}
              />
            }
          />
          <Route path="/product/:id" element={<ProductDetailRoute onMenuClick={openMenu} topUp={topUp} />} />
          <Route
            path="/basket"
            element={
              <BasketPage
                cartItems={cartItems}
                cartReady={cartReady}
                onBack={() => navigate('/')}
                onMenuClick={openMenu}
                onUpdateQuantity={updateCartItemQuantity}
                onGoToCheckout={() => navigate('/checkout')}
                promo={promo}
                onApplyPromo={applyPromo}
                onClearPromo={clearPromo}
                errorMessage={purchaseError}
              />
            }
          />
          <Route
            path="/checkout"
            element={
              <CheckoutPage
                cartCount={cartCount}
                customerInfo={customerInfo}
                signedIn={!!customerSession}
                onBack={() => navigate('/basket')}
                onMenuClick={openMenu}
                onProceedToPayment={handleProceedToPayment}
                errorMessage={purchaseError}
              />
            }
          />
          <Route path="/pay/:reference" element={<PaymentRoute onMenuClick={openMenu} topUp={topUp} />} />
          <Route path="/order/:reference" element={<OrderConfirmationRoute onMenuClick={openMenu} />} />
          <Route
            path="/profile"
            element={
              <ProfilePage
                customerInfo={customerInfo}
                customerSession={customerSession}
                onUpdateCustomerInfo={setCustomerInfo}
                onBack={() => navigate('/')}
                onMenuClick={openMenu}
                onCartClick={() => navigate('/basket')}
                onLogout={logout}
                onShopClick={() => navigate('/')}
                onReorder={reorderFromOrder}
                cartCount={cartCount}
              />
            }
          />
          <Route
            path="/login"
            element={
              <LoginPage
                onBack={() => navigate('/')}
                onLogin={login}
                onNavigateToSignup={() => navigate('/signup')}
              />
            }
          />
          <Route
            path="/signup"
            element={
              <SignupPage
                onBack={() => navigate('/')}
                onSignup={(customer) => {
                  // The signup response already carries a session cookie, so the
                  // account is live — sending them to the login page next would
                  // ask for the password they just chose.
                  login(customer);
                  navigate('/');
                }}
                onNavigateToLogin={() => navigate('/login')}
              />
            }
          />
          <Route
            path="/map"
            element={
              <MapPage
                cartCount={cartCount}
                initialDistrict={customerInfo.district}
                onBack={() => navigate('/')}
                onMenuClick={openMenu}
                onCartClick={() => navigate('/basket')}
                onUseAsDeliveryPlace={(name) => {
                  setCustomerInfo({ ...customerInfo, district: name });
                  navigate('/checkout');
                }}
              />
            }
          />
          <Route
            path="/news"
            element={
              <NewsstandPage
                onBack={() => navigate('/')}
                onMenuClick={openMenu}
                onCartClick={() => navigate('/basket')}
                cartCount={cartCount}
              />
            }
          />
          <Route
            path="/about"
            element={
              <AboutPage
                onBack={() => navigate('/')}
                onMenuClick={openMenu}
                onCartClick={() => navigate('/basket')}
                cartCount={cartCount}
              />
            }
          />
          <Route path="/staff" element={<AdminPage onClose={() => navigate('/')} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>

        {/* Add to Cart Overlay */}
        <AddToCartOverlay isVisible={showOverlay} product={overlayProduct} quantity={overlayQuantity} />

        {/* Custom Menu */}
        <Menu
          isOpen={isNavOpen}
          onClose={() => setIsNavOpen(false)}
          onNavigate={handleMenuNavigation}
          isLoggedIn={!!customerSession}
        />
    </ShellFrame>
  );
}

/**
 * Two different frames for two different audiences.
 *
 * The shopper app is a phone: it keeps the Figma device bezel — a 430px column
 * centred on the page, rounded and shadowed on md+ — because that is the shape
 * the screens were drawn for. The staff console is a working tool with wide
 * tables, grids and analytics. Forcing it into the same 430px shell made it
 * unusable on a tablet or laptop, so it is rendered full-bleed and fills the
 * viewport instead, letting its own panels flow to the available width.
 */
function ShellFrame({ staff, children }: { staff: boolean; children: ReactNode }) {
  if (staff) {
    return <div className="h-dvh bg-[#f7f7f5]">{children}</div>;
  }
  return (
    <div className="min-h-dvh bg-[#f7f7f5] p-2 sm:p-4">
      <div className="max-w-[430px] mx-auto bg-white relative overflow-hidden rounded-[40px] shadow-2xl md:border-8 md:border-black md:rounded-[52px] h-[calc(100dvh-1rem)] sm:h-[calc(100dvh-2rem)] md:max-h-[900px]">
        {children}
      </div>
    </div>
  );
}
