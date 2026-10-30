import { useCallback, useEffect, useMemo, useState } from 'react';
import svgPaths from "../imports/svg-x4vilrsbuo";
import DeliveryLocationMap from './DeliveryLocationMap';
import { fetchOrder, type TrackedOrder } from '../lib/customerApi';
import { formatUgx } from '../lib/currency';
import { PageTitle } from './shared/PageTitle';

interface OrderConfirmationPageProps {
  cartCount: number;
  customerInfo: CustomerInfo;
  orderReference: string | null;
  onShop: () => void;
  onMenuClick: () => void;
  /** Present when the order is still waiting for payment. */
  onPay?: () => void;
}

interface CustomerInfo {
  fullName: string;
  phone: string;
  region: string;
  district: string;
  subCounty: string;
  parish: string;
  village: string;
  address: string;
}

const STEPS = [
  { key: 'pending', label: 'Order placed', description: 'We received your order and reserved your produce.' },
  { key: 'confirmed', label: 'Confirmed by the market', description: 'A person at the market has checked your order and is ready to pack it.' },
  { key: 'processing', label: 'Being prepared', description: 'Being packed by the farm team.' },
  { key: 'shipped', label: 'Out for delivery', description: 'A rider is on the way with your basket.' },
  { key: 'delivered', label: 'Delivered', description: 'Handed over at your delivery address.' },
] as const;

const STATUS_COPY: Record<string, { title: string; subtitle: string }> = {
  pending: { title: 'Waiting for payment', subtitle: 'Complete payment and we will start packing your basket.' },
  confirmed: { title: 'The market has confirmed your order', subtitle: 'Someone has checked it over and will start packing shortly.' },
  processing: { title: 'Your order is being prepared', subtitle: 'The farm team is packing your produce right now.' },
  shipped: { title: 'Your order is on the way', subtitle: 'A rider has picked up your basket.' },
  delivered: { title: 'Your order was delivered', subtitle: 'Thank you for shopping with Mu Katale.' },
  cancelled: { title: 'This order was cancelled', subtitle: 'No money was taken. Any reserved stock has been returned.' },
};

function formatWhen(value: string): string {
  const parsed = new Date(value.replace(' ', 'T'));
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString('en-UG', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function OrderConfirmationPage({
  cartCount,
  customerInfo,
  orderReference,
  onShop,
  onMenuClick,
  onPay,
}: OrderConfirmationPageProps) {
  const [order, setOrder] = useState<TrackedOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!orderReference) {
      setLoading(false);
      setError('This link has no order reference, so the order cannot be tracked.');
      return;
    }
    if (!silent) setLoading(true);
    try {
      const data = await fetchOrder(orderReference);
      setOrder(data);
      setError(null);
    } catch (err) {
      if (!silent) setError(err instanceof Error ? err.message : 'Could not load this order.');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [orderReference]);

  useEffect(() => {
    void load();
  }, [load]);

  const status = order?.status ?? 'pending';
  const isActive = status === 'pending' || status === 'confirmed' || status === 'processing' || status === 'shipped';

  // Live updates while the order is moving. A delivered or cancelled order
  // cannot change again, so polling stops there.
  useEffect(() => {
    if (!isActive) return;
    const timer = window.setInterval(() => void load(true), 15000);
    const onFocus = () => void load(true);
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [isActive, load]);

  const payments = order?.payments ?? [];
  const settled = payments.some((payment) => payment.status === 'succeeded' || payment.status === 'cod');
  const awaitingApproval = payments.some(
    (payment) => payment.status === 'pending' || payment.status === 'awaiting_approval' || payment.status === 'processing',
  );
  const needsPayment = status === 'pending' && !settled;

  const reachedIndex = useMemo(() => {
    const index = STEPS.findIndex((step) => step.key === status);
    return index === -1 ? 0 : index;
  }, [status]);

  const whenFor = (key: string) => order?.timeline.find((event) => event.toStatus === key)?.at ?? null;

  const address = order?.shippingAddress;
  const addressLines = [
    address?.fullName || customerInfo.fullName,
    address?.address || customerInfo.address,
    [
      address?.village || customerInfo.village,
      address?.parish || customerInfo.parish,
      address?.subCounty || customerInfo.subCounty,
      address?.district || customerInfo.district,
    ]
      .filter(Boolean)
      .join(', '),
    address?.region || customerInfo.region,
    address?.phone || customerInfo.phone,
  ].filter((line) => typeof line === 'string' && line.trim() !== '');

  const deliveryDistrict = address?.district || order?.district || customerInfo.district;
  const deliveryRegion = address?.region || order?.region || customerInfo.region;
  // Only a real device fix has both coordinates; the map falls back to the
  // district centroid when this is null.
  const deliveryPin =
    typeof address?.lat === 'number' && typeof address?.lng === 'number'
      ? { lat: address.lat, lng: address.lng, accuracyM: address.accuracyM }
      : null;
  const copy = STATUS_COPY[status] ?? STATUS_COPY.pending;
  const itemCount = order?.items.reduce((sum, item) => (item.lineStatus === 'rejected' ? sum : sum + item.quantity), 0) ?? 0;

  return (
    <div className="bg-white relative size-full">
      <StatusBar />

      <Header
        cartCount={cartCount}
        onShop={onShop}
        onMenuClick={onMenuClick}
        title={status === 'delivered' ? 'Delivered' : status === 'cancelled' ? 'Cancelled' : 'Track order'}
      />

      <div className="absolute left-6 right-6 top-[149px] bottom-[124px] overflow-y-auto">
        <div className="py-6 space-y-6">
          {loading && (
            <div className="space-y-3">
              <div className="h-6 w-2/3 bg-neutral-100 rounded animate-pulse" />
              <div className="h-4 w-1/2 bg-neutral-100 rounded animate-pulse" />
              <div className="h-40 bg-neutral-100 rounded-xl animate-pulse" />
              <div className="h-28 bg-neutral-100 rounded-xl animate-pulse" />
            </div>
          )}

          {!loading && error && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-3">
              <p className="text-[13px] text-red-700">{error}</p>
              <button
                onClick={() => void load()}
                className="text-[13px] font-medium text-brand hover:underline"
              >
                Try again
              </button>
            </div>
          )}

          {!loading && !error && (
            <>
              {/* Status hero */}
              <div className="flex items-start gap-3">
                <div
                  className={`size-8 rounded-full flex items-center justify-center shrink-0 ${
                    status === 'cancelled' ? 'bg-red-600' : 'bg-brand'
                  }`}
                >
                  {status === 'cancelled' ? (
                    <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="white" strokeWidth="2.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  ) : (
                    <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="white" strokeWidth="2.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                  )}
                </div>
                <div className="min-w-0">
                  {/* The screen already carries an <h1>; this is the heading of
                      the status block within it, not a second page title. */}
                  <h2
                    className={`font-serif font-normal text-title leading-tight ${
                      status === 'cancelled' ? 'text-red-700' : 'text-brand'
                    }`}
                  >
                    {copy.title}
                  </h2>
                  <p className="mt-1 text-[13px] text-neutral-600 leading-[18px]">{copy.subtitle}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-neutral-500">
                    {orderReference && <span>Order {orderReference}</span>}
                    {isActive && (
                      <span className="inline-flex items-center gap-1 text-brand">
                        <span className="size-1.5 rounded-full bg-brand animate-pulse" />
                        Updates automatically
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Payment call to action */}
              {needsPayment && onPay && (
                <div className="bg-brand/5 border border-brand/20 rounded-xl p-4 space-y-2">
                  <h3 className="font-medium text-[14px] text-black">
                    {awaitingApproval ? 'Payment is waiting for approval' : 'Payment is still due'}
                  </h3>
                  <p className="font-normal text-[12px] text-muted-foreground leading-[18px]">
                    {awaitingApproval
                      ? 'Approve the prompt on your phone, or start a fresh attempt if it expired.'
                      : 'Your produce is reserved until the order is paid for. Unpaid orders are released after 15 minutes.'}
                  </p>
                  <button
                    onClick={onPay}
                    className="w-full bg-brand text-white rounded-lg py-2.5 text-[14px] font-medium hover:bg-[#355a19] transition-colors"
                  >
                    {awaitingApproval ? 'Review payment' : `Pay ${order ? formatUgx(order.total) : 'now'}`}
                  </button>
                </div>
              )}

              {/* Progress stepper */}
              {status === 'cancelled' ? (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                  <h3 className="font-medium text-[14px] text-red-800 mb-1">Order cancelled</h3>
                  <p className="font-normal text-[12px] text-red-700 leading-[18px]">
                    {order?.timeline.find((event) => event.toStatus === 'cancelled')?.note ??
                      'This order will not be delivered.'}
                  </p>
                </div>
              ) : (
                <div className="bg-[#f8f9fa] rounded-xl p-4 border border-neutral-200">
                  <h3 className="font-medium text-[15px] text-black mb-4">
                    Delivery progress
                  </h3>
                  <ol className="space-y-0">
                    {STEPS.map((step, index) => {
                      const done = index < reachedIndex;
                      const current = index === reachedIndex;
                      const when = whenFor(step.key);
                      const last = index === STEPS.length - 1;
                      return (
                        <li key={step.key} className="flex gap-3">
                          <div className="flex flex-col items-center">
                            <div
                              className={`size-6 rounded-full flex items-center justify-center shrink-0 border-2 ${
                                done
                                  ? 'bg-brand border-brand'
                                  : current
                                    ? 'bg-white border-brand'
                                    : 'bg-white border-neutral-300'
                              }`}
                            >
                              {done ? (
                                <svg className="size-3" fill="none" viewBox="0 0 24 24" stroke="white" strokeWidth="3">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                                </svg>
                              ) : (
                                <span className={`size-2 rounded-full ${current ? 'bg-brand' : 'bg-neutral-300'}`} />
                              )}
                            </div>
                            {!last && (
                              <div className={`w-0.5 flex-1 min-h-[26px] ${done ? 'bg-brand' : 'bg-neutral-200'}`} />
                            )}
                          </div>
                          <div className={`pb-4 ${last ? 'pb-0' : ''}`}>
                            <p
                              className={`font-medium text-[13px] leading-[18px] ${
                                done || current ? 'text-black' : 'text-caption'
                              }`}
                            >
                              {step.label}
                            </p>
                            <p className="font-normal text-[12px] leading-[17px] text-muted-foreground">
                              {step.description}
                            </p>
                            {when && (
                              <p className="font-normal text-[11px] text-caption mt-0.5">
                                {formatWhen(when)}
                              </p>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                </div>
              )}

              {/* Basket summary */}
              {order && (
                <div className="border border-neutral-200 rounded-xl p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="font-medium text-[14px] text-black">Your basket</h3>
                    <span className="font-normal text-[12px] text-muted-foreground">
                      {itemCount} item{itemCount === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div className="space-y-1">
                    {order.items.map((item) => {
                      const refused = item.lineStatus === 'rejected';
                      return (
                        <div key={item.id} className="font-normal text-[13px]">
                          <div className="flex justify-between gap-2">
                            <span className={refused ? 'text-neutral-400 line-through truncate' : 'text-black truncate'}>
                              {item.quantity} × {item.name}
                            </span>
                            <span className={refused ? 'text-neutral-400 line-through whitespace-nowrap' : 'text-muted-foreground whitespace-nowrap'}>
                              {formatUgx(item.lineTotal)}
                            </span>
                          </div>
                          {refused && (
                            <p className="text-[11px] text-red-600 mt-0.5 leading-[15px]">
                              Not supplied{item.rejectionNote ? ` — ${item.rejectionNote}` : ''}. You were not charged for this.
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div className="pt-2 border-t border-neutral-100 space-y-1 font-normal text-[12px]">
                    <div className="flex justify-between text-muted-foreground">
                      <span>Subtotal</span>
                      <span>{formatUgx(order.subtotal)}</span>
                    </div>
                    {order.discount > 0 && (
                      <div className="flex justify-between text-brand">
                        <span>{order.promoCode ? `Discount · ${order.promoCode}` : 'Discount'}</span>
                        <span>− {formatUgx(order.discount)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-muted-foreground">
                      <span>Delivery</span>
                      <span>{formatUgx(order.shipping)}</span>
                    </div>
                    <div className="flex justify-between text-black font-medium text-[14px] pt-1">
                      <span>Total</span>
                      <span>{formatUgx(order.total)}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Delivery location */}
              <DeliveryLocationMap district={deliveryDistrict} region={deliveryRegion} address={address?.address || customerInfo.address} pin={deliveryPin} />

              <div className="grid grid-cols-2 gap-4 pt-1 border-t border-neutral-100">
                <div>
                  <h3 className="font-normal text-[14px] text-muted-foreground tracking-[-0.14px] leading-[24px] mb-1">
                    Delivery to
                  </h3>
                  <div className="space-y-0.5">
                    {addressLines.map((line, index) => (
                      <p
                        key={index}
                        className="font-normal text-[14px] text-black tracking-[-0.14px] leading-[22px]"
                      >
                        {line}
                      </p>
                    ))}
                  </div>
                </div>
                <div>
                  <h3 className="font-normal text-[14px] text-muted-foreground tracking-[-0.14px] leading-[24px] mb-1">
                    Placed
                  </h3>
                  <p className="font-normal text-[14px] text-black tracking-[-0.14px] leading-[22px]">
                    {order ? formatWhen(order.createdAt) : '—'}
                  </p>
                  {/* A line here used to read "Standard Eco Courier • Tracking
                      enabled". There is no courier partner and nothing to track
                      against one; the order is brought by the market's own
                      delivery person, and the updates below are the truth of
                      where it is. */}
                </div>
              </div>

              {/* Status history */}
              {order && order.timeline.length > 0 && (
                <div className="space-y-2">
                  <h3 className="font-medium text-[14px] text-black">Order updates</h3>
                  <div className="divide-y divide-neutral-100 border border-neutral-200 rounded-xl overflow-hidden">
                    {order.timeline
                      .slice()
                      .reverse()
                      .map((event) => (
                        <div key={event.id} className="p-3 bg-white">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium text-[12px] text-black capitalize">
                              {event.toStatus}
                            </span>
                            <span className="font-normal text-[11px] text-caption">
                              {formatWhen(event.at)}
                            </span>
                          </div>
                          {event.note && (
                            <p className="font-normal text-[12px] text-muted-foreground mt-0.5 leading-[17px]">
                              {event.note}
                            </p>
                          )}
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <Footer onShop={onShop} />
    </div>
  );
}

function StatusBar() {
  return (
    <div className="absolute h-[47px] left-0 overflow-clip right-0 top-0">
      <Notch />
      <LeftSide />
      <RightSide />
    </div>
  );
}

function Notch() {
  return (
    <div
      className="absolute h-[33px] top-[-2px] translate-x-[-50%] w-[156px]"
      style={{ left: "calc(50% + 0.499992px)" }}
    >
      <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 156 33">
        <g>
          <path d={svgPaths.p28770100} fill="black" />
          <path d={svgPaths.p28f48b80} fill="var(--fill-0, black)" />
          <path d={svgPaths.p14d82600} fill="var(--fill-0, black)" />
        </g>
      </svg>
    </div>
  );
}

function LeftSide() {
  return (
    <div className="absolute contents left-[25px] top-3.5">
      <div
        className="absolute h-[21px] rounded-3xl top-3.5 translate-x-[-50%] w-[54px]"
        style={{ left: "calc(50% - 135.5px)" }}
      >
        <div className="absolute font-bold h-5 leading-[0] left-[27px] not-italic text-black text-[17px] text-center top-px tracking-[-0.408px] translate-x-[-50%] w-[54px]">
          <p className="block leading-[22px]">9:41</p>
        </div>
      </div>
    </div>
  );
}

function RightSide() {
  return (
    <div className="absolute contents left-[274px] top-[19px]">
      <div
        className="absolute h-[13px] top-[19px] translate-x-[-50%] w-[27.401px]"
        style={{ left: "calc(50% + 150.201px)" }}
      >
        <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 28 13">
          <g>
            <path d={svgPaths.p3f827980} opacity="0.35" stroke="var(--stroke-0, black)" />
            <path d={svgPaths.p5fdc300} fill="var(--fill-0, black)" opacity="0.4" />
            <path d={svgPaths.pbee4a00} fill="var(--fill-0, black)" />
          </g>
        </svg>
      </div>
      <div className="absolute bottom-[32.269%] left-[80%] right-[15.467%] top-[42.553%]">
        <div className="absolute bottom-[-0.002%] left-0 right-0 top-[0.002%]">
          <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 17 12">
            <path d={svgPaths.p17a4bf30} fill="var(--fill-0, black)" />
          </svg>
        </div>
      </div>
      <div
        className="absolute h-3 top-5 translate-x-[-50%] w-[18px]"
        style={{ left: "calc(50% + 95.5px)" }}
      >
        <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 18 12">
          <g>
            <path d={svgPaths.p1ec31400} fill="var(--fill-0, black)" />
            <path d={svgPaths.p19f8d480} fill="var(--fill-0, black)" />
            <path d={svgPaths.p13f4aa00} fill="var(--fill-0, black)" />
            <path d={svgPaths.p1bfb7500} fill="var(--fill-0, black)" />
          </g>
        </svg>
      </div>
    </div>
  );
}

interface HeaderProps {
  cartCount: number;
  onShop: () => void;
  onMenuClick: () => void;
  title: string;
}

function Header({ cartCount, onShop, onMenuClick, title }: HeaderProps) {
  return (
    <div className="absolute bg-white h-[149px] left-0 right-0 top-0">
      <div className="absolute border-[0px_0px_1px] border-neutral-200 border-solid inset-0 pointer-events-none shadow-[0px_0px_20px_0px_rgba(0,0,0,0.1)]" />

      {/* Mobile Nav */}
      <div className="absolute bg-white h-16 left-0 overflow-clip right-0 top-[31px]">
        <div className="absolute bg-white h-[66px] left-0 top-0 w-[393px]" />
        <div
          className="absolute flex flex-col font-serif font-medium justify-center leading-[0] text-brand text-[24px] text-center text-nowrap top-9 tracking-[-0.24px] translate-x-[-50%] translate-y-[-50%]"
          style={{ left: "calc(50% - 0.5px)" }}
        >
          <p className="block leading-none whitespace-pre text-[24px]">Mu Katale</p>
        </div>

        {/* Cart Icon */}
        <div className="absolute right-5 rounded-2xl size-8 top-[18px]">
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
                  <div className="flex flex-col font-medium justify-center leading-[0] not-italic relative shrink-0 text-white text-[12px] text-center text-nowrap tracking-[-0.12px]">
                    <p className="block leading-none whitespace-pre">{cartCount}</p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Menu Icon */}
        <button
          onClick={onMenuClick}
          className="absolute left-5 rounded-2xl size-8 top-[18px] flex items-center justify-center"
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
              <PageTitle>{title}</PageTitle>
              <button
                onClick={onShop}
                className="cursor-pointer flex items-center font-normal not-italic relative shrink-0 text-brand text-[14px] text-nowrap tracking-[-0.14px] hover:opacity-80 transition-opacity"
              >
                <div className="flex flex-row items-center gap-1">
                  <div className="w-3 h-3">
                    <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 12 12">
                      <path d="M7.5 9L4.5 6L7.5 3" className="stroke-brand" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                  <p className="block leading-[24px] whitespace-pre">Shop</p>
                </div>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

interface FooterProps {
  onShop: () => void;
}

function Footer({ onShop }: FooterProps) {
  return (
    <div className="absolute bg-white bottom-0 h-[124px] left-0 overflow-clip right-0 shadow-[0px_0px_20px_0px_rgba(0,0,0,0.1)]">
      {/* Continue Shopping Button */}
      <button
        onClick={onShop}
        className="absolute left-6 right-6 rounded-lg top-6 bg-brand cursor-pointer"
      >
        <div className="flex flex-row items-center relative size-full">
          <div className="box-border content-stretch flex flex-row gap-2 items-center justify-center pl-6 pr-6 py-2 relative w-full">
            <div className="flex flex-col font-normal justify-center leading-[0] not-italic relative text-white text-[16px] text-center tracking-[-0.16px]">
              <p className="block leading-[24px]">Continue shopping</p>
            </div>
          </div>
        </div>
      </button>
    </div>
  );
}
