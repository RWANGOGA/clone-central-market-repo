import React, { useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useParams } from 'react-router';
import { CartProvider, useCart } from './lib/cartProvider';
import { AuthProvider, useAuth, type CustomerInfo } from './lib/authProvider';
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

function ProductDetailRoute({ onMenuClick }: { onMenuClick: () => void }) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { products, cartCount, stockLevels, stockLive, addToCart } = useCart();

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
      onAddToCart={(quantity) => addToCart(product.id, quantity)}
      onMenuClick={onMenuClick}
      onCartClick={() => navigate('/basket')}
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

function PaymentRoute({ onMenuClick }: { onMenuClick: () => void }) {
  const { reference } = useParams<{ reference: string }>();
  const navigate = useNavigate();
  const { cartCount, cartId, finalizePurchase } = useCart();
  const { customerInfo } = useAuth();

  return (
    <PaymentPage
      cartCount={cartCount}
      cartId={cartId}
      // The order was created at checkout; the URL is its reference, and the
      // server reads the amount from it.
      orderReference={reference ?? null}
      customerName={customerInfo.fullName}
      onBack={() => navigate('/checkout')}
      onMenuClick={onMenuClick}
      onProceedToConfirmation={() => {
        finalizePurchase(cartId);
        navigate(`/order/${reference ?? ''}`);
      }}
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
      <CartProvider>
        <AuthProvider>
          <AppShell />
        </AuthProvider>
      </CartProvider>
    </BrowserRouter>
  );
}

function AppShell() {
  const navigate = useNavigate();
  const [isNavOpen, setIsNavOpen] = useState(false);
  const openMenu = () => setIsNavOpen(true);

  const {
    products,
    cartItems,
    cartId,
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
      }, promoCode);
      if (!order.reference) throw new Error('The server did not return an order reference.');
      setOrderReference(order.reference);
      navigate(`/pay/${order.reference}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'We could not place your order. Please try again.';
      setPurchaseError(message);
      if (message.toLowerCase().includes('sold out')) {
        navigate('/basket');
      }
    }
  };

  return (
    <div className="min-h-dvh bg-[#f7f7f5] p-2 sm:p-4">
      {/* Responsive shop shell: full width on small screens, bezel frame on md+. */}
      <div className="max-w-[430px] mx-auto bg-[#ffffff] relative overflow-hidden rounded-[40px] shadow-2xl md:border-8 md:border-black md:rounded-[52px] h-[calc(100dvh-1rem)] sm:h-[calc(100dvh-2rem)] md:max-h-[900px]">
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
                onAddToCart={(productId) => addToCart(productId, 1)}
                onProductClick={(product) => navigate(`/product/${product.id}`)}
                onMenuClick={openMenu}
                onCartClick={() => navigate('/basket')}
                stockLevels={stockLevels}
                stockLive={stockLive}
              />
            }
          />
          <Route path="/product/:id" element={<ProductDetailRoute onMenuClick={openMenu} />} />
          <Route
            path="/basket"
            element={
              <BasketPage
                cartItems={cartItems}
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
              />
            }
          />
          <Route path="/pay/:reference" element={<PaymentRoute onMenuClick={openMenu} />} />
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
      </div>
    </div>
  );
}
