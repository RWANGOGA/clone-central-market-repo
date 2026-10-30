import React, { useEffect, useMemo, useState } from 'react';
import svgPaths from '../imports/svg-toln6of0ig';
import { Input } from './ui/input';
import { formatUgx } from '../lib/currency';
import { isValidUgandanPhone, normalizeUgandanPhone } from '../lib/uganda';
import {
  createPaymentIntent,
  fetchPaymentMethods,
  settlePaymentIntent,
  type PaymentChannel,
  type PaymentIntent,
  type PaymentMethod,
  type PaymentMethods,
  type PaymentTotals,
} from '../lib/paymentApi';
import { PageTitle } from './shared/PageTitle';
import { fetchOrder, type TrackedOrder } from '../lib/customerApi';

interface PaymentPageProps {
  cartCount: number;
  /** Server cart id, required to price the intent. */
  cartId: number | null;
  /** The order created at checkout; the intent is created against it. */
  orderReference: string | null;
  customerName: string;
  onBack: () => void;
  onMenuClick: () => void;
  onProceedToConfirmation: () => void;
  /**
   * Back to the shop while this order is still open. Every tester wanted to add
   * one more thing before paying and had nowhere to go, because the basket had
   * already become an order.
   */
  onAddMore?: () => void;
}

const CHANNELS: { id: PaymentChannel; label: string; blurb: string }[] = [
  { id: 'mobile_money', label: 'Mobile Money', blurb: 'MTN, Airtel or UTel' },
  { id: 'wallet', label: 'Wallet', blurb: 'Bank or mobile wallet' },
  { id: 'cod', label: 'Cash on delivery', blurb: 'Pay the rider' },
];

const STAGES = ['details', 'approval', 'done'] as const;
type Stage = (typeof STAGES)[number];

export default function PaymentPage({
  cartCount,
  cartId,
  orderReference,
  customerName,
  onBack,
  onMenuClick,
  onProceedToConfirmation,
  onAddMore,
}: PaymentPageProps) {
  const [methods, setMethods] = useState<PaymentMethods | null>(null);
  const [methodsError, setMethodsError] = useState<string | null>(null);
  const [order, setOrder] = useState<TrackedOrder | null>(null);

  const [channel, setChannel] = useState<PaymentChannel>('mobile_money');
  const [provider, setProvider] = useState<string>('');
  const [phone, setPhone] = useState('');
  const [walletId, setWalletId] = useState('');

  const [stage, setStage] = useState<Stage>('details');
  const [intent, setIntent] = useState<PaymentIntent | null>(null);
  const [settlementToken, setSettlementToken] = useState<string>('');
  const [totals, setTotals] = useState<PaymentTotals | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /**
   * Read the order before asking for money. The page used to show no total until
   * an intent existed, and after a top-up the customer must be able to see the
   * new figure here — the server recomputes the intent amount from the order, so
   * what this says is what will be charged.
   */
  useEffect(() => {
    if (!orderReference) return;
    let cancelled = false;
    fetchOrder(orderReference)
      .then((data) => {
        if (!cancelled) setOrder(data);
      })
      .catch(() => {
        // Offline or not ours to read: the intent still prices itself server-side.
      });
    return () => {
      cancelled = true;
    };
  }, [orderReference]);

  useEffect(() => {
    fetchPaymentMethods().then((result) => {
      if (!result) {
        setMethodsError('Payment service unavailable. Start the API with npm run dev --prefix api.');
        return;
      }
      setMethods(result);
      const first = result.groups[0]?.methods[0];
      if (first) setProvider(first.id);
    });
  }, []);

  const activeMethods = useMemo<PaymentMethod[]>(
    () => methods?.groups.find((g) => g.channel === channel)?.methods ?? [],
    [methods, channel],
  );

  // Keep the provider valid whenever the channel changes.
  useEffect(() => {
    if (activeMethods.length === 0) return;
    if (!activeMethods.some((m) => m.id === provider)) {
      setProvider(activeMethods[0].id);
    }
  }, [activeMethods, provider]);

  const selectedMethod = activeMethods.find((m) => m.id === provider) ?? null;
  const phoneValid = isValidUgandanPhone(phone);

  /**
   * The basket is open until payment is confirmed — which is about the money, not
   * about a stamp on the order: once anything has settled or cash on delivery has
   * been taken, the goods are sold at the figures already agreed.
   */
  const orderOpen =
    !!order &&
    order.status === 'pending' &&
    !order.payments.some((p) => p.status === 'succeeded' || p.status === 'cod');

  const isFormValid = useMemo(() => {
    // Cash on delivery has no instrument to validate.
    if (channel === 'cod') return true;
    if (!provider) return false;
    if (channel === 'mobile_money') return phoneValid;
    return walletId.trim().length >= 3;
  }, [provider, channel, phoneValid, walletId]);

  const handlePay = async () => {
    if (!isFormValid || busy) return;

    if (cartId === null || !orderReference) {
      setError(
        'No order was found for this basket, so the amount cannot be verified. Return to checkout and try again.',
      );
      return;
    }

    setBusy(true);
    setError(null);

    const result = await createPaymentIntent({
      cartId,
      orderReference,
      channel,
      // Cash on delivery has no external provider.
      provider: channel === 'cod' ? 'cash' : provider,
      payerName: customerName || undefined,
      payerPhone: channel === 'mobile_money' ? (normalizeUgandanPhone(phone) ?? phone) : undefined,
      walletId: channel === 'wallet' ? walletId.trim() : undefined,
    });

    setBusy(false);

    if (!result) {
      setError('Could not reach the payment service. Check that the API is running.');
      return;
    }
    if (!result.ok) {
      setError(result.error);
      return;
    }

    const created = result.data.data;
    setIntent(created);
    // Kept for the approval step; the server issues it once and never returns
    // it again. Absent in production, where only the gateway may settle.
    setSettlementToken(created.settlementToken ?? '');
    setTotals(result.data.totals ?? null);
    // Cash on delivery is confirmed at checkout: the order is already
    // processing and there is no approval prompt to show.
    setStage(channel === 'cod' ? 'done' : 'approval');
  };

  const confirmPayment = async () => {
    if (!intent || busy) return;
    if (!settlementToken) {
      setError('This payment is settled by the provider. Refresh in a moment to see the result.');
      return;
    }
    setBusy(true);

    const result = await settlePaymentIntent(intent.reference, settlementToken, 'succeeded');

    setBusy(false);

    if (!result) {
      setError('Could not reach the payment service to confirm the payment.');
      return;
    }
    if (!result.ok) {
      setError(result.error);
      return;
    }

    setIntent(result.data.data);
    setStage('done');
  };

  const cancelPayment = async () => {
    if (!intent || busy) return;
    if (!settlementToken) {
      setStage('details');
      return;
    }
    setBusy(true);
    await settlePaymentIntent(intent.reference, settlementToken, 'cancelled', 'Cancelled by the customer');
    setBusy(false);
    setStage('details');
  };

  return (
    <div className="bg-white relative size-full">
      <StatusBar />
      <Header cartCount={cartCount} onBack={onBack} onMenuClick={onMenuClick} />
      <ProgressIndicators />

      <div className="absolute h-0 left-6 right-6 top-[222px]">
        <div className="absolute bottom-0 left-0 right-0 top-[-1px]">
          <svg className="block size-full" fill="none" viewBox="0 0 327 1">
            <line stroke="var(--stroke-0, #E5E5E5)" x2="327" y1="0.5" y2="0.5" />
          </svg>
        </div>
      </div>

      {/* Clears the "1" badge the same way the checkout screen does; at left-6
          the heading sat on top of it. */}
      <div className="absolute left-[72px] top-[190px] text-[24px] text-brand font-serif font-normal translate-y-[-50%]">
        <p className="leading-[32px]">Payment</p>
      </div>

      <div className="absolute left-6 top-[258px] text-[16px] text-black font-normal translate-y-[-50%]">
        <p className="leading-[1.5] whitespace-pre">
          {stage === 'details' ? 'Choose how you want to pay' : stage === 'approval' ? 'Approve the payment' : 'Payment received'}
        </p>
      </div>

      {/* Scrollable body so the channel cards and fields never sit under the footer. */}
      <div className="absolute left-0 right-0 top-[286px] bottom-[124px] overflow-y-auto">
        <div className="px-6 pb-6 pt-1 space-y-4">
          {stage === 'details' && (
            <>
              {methodsError && <Notice tone="error">{methodsError}</Notice>}

              {order && (
                <div className="rounded-xl border border-neutral-200 p-4 space-y-1.5">
                  <Row label="Order" value={order.reference} />
                  <Row
                    label={`Items · ${order.items.reduce((n, line) => n + line.quantity, 0)}`}
                    value={formatUgx(order.subtotal)}
                  />
                  {order.discount > 0 && (
                    <Row
                      label={order.promoCode ? `Discount · ${order.promoCode}` : 'Discount'}
                      value={`− ${formatUgx(order.discount)}`}
                    />
                  )}
                  <Row label="Delivery" value={order.shipping === 0 ? 'Free' : formatUgx(order.shipping)} />
                  <div className="border-t border-neutral-100 pt-1.5">
                    <Row label="Total to pay" value={formatUgx(order.total)} strong />
                  </div>
                  {onAddMore && orderOpen && (
                    <button
                      type="button"
                      onClick={onAddMore}
                      className="mt-2 w-full cursor-pointer rounded-lg border border-brand px-3 py-2.5 text-[13px] font-medium text-brand"
                    >
                      Add more items
                    </button>
                  )}
                </div>
              )}

              <div className="grid grid-cols-3 gap-2">
                {CHANNELS.map((option) => {
                  const active = channel === option.id;
                  return (
                    <button
                      key={option.id}
                      onClick={() => setChannel(option.id)}
                      className={`rounded-xl border px-2 py-3 text-left transition-colors ${
                        active
                          ? 'border-brand bg-brand/8'
                          : 'border-neutral-200 bg-white hover:border-neutral-300'
                      }`}
                    >
                      <span
                        className={`block text-[13px] font-medium ${
                          active ? 'text-brand' : 'text-black'
                        }`}
                      >
                        {option.label}
                      </span>
                      <span className="mt-0.5 block text-[10px] leading-[14px] font-normal text-muted-foreground">
                        {option.blurb}
                      </span>
                    </button>
                  );
                })}
              </div>

              {activeMethods.length > 1 && (
                <div className="space-y-2">
                  <p className="text-[14px] text-muted-foreground font-normal">
                    {channel === 'mobile_money' ? 'Network' : 'Provider'}
                  </p>
                  <div className="space-y-1.5">
                    {activeMethods.map((method) => {
                      const active = method.id === provider;
                      return (
                        <button
                          key={method.id}
                          onClick={() => setProvider(method.id)}
                          className={`w-full flex items-center justify-between rounded-lg border px-3 py-2.5 ${
                            active ? 'border-brand bg-brand/5' : 'border-neutral-200'
                          }`}
                        >
                          <span className="text-left">
                            <span className="block text-[14px] font-medium text-black">
                              {method.label}
                            </span>
                            {method.ussd && (
                              <span className="block text-[11px] font-normal text-muted-foreground">
                                {method.ussd}
                              </span>
                            )}
                          </span>
                          <span
                            className={`size-4 rounded-full border-2 flex items-center justify-center ${
                              active ? 'border-brand' : 'border-neutral-300'
                            }`}
                          >
                            {active && <span className="size-2 rounded-full bg-brand" />}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {channel === 'mobile_money' && (
                <Field id="pay-phone" label="Mobile money number">
                  <Input
                    id="pay-phone"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    inputMode="tel"
                    placeholder="07XX XXX XXX"
                    className={`bg-white border rounded-lg px-4 py-2 w-full font-normal text-[16px] ${
                      phone.length > 0 && !phoneValid ? 'border-red-500' : 'border-neutral-200'
                    }`}
                  />
                  {selectedMethod && (
                    <p className="mt-1 text-[11px] leading-[16px] font-normal text-muted-foreground">
                      {phoneValid
                        ? selectedMethod.instructions
                        : `Starts with ${selectedMethod.prefixes?.join(', ')} for ${selectedMethod.label}`}
                    </p>
                  )}
                </Field>
              )}

              {channel === 'cod' && (
                <div className="rounded-xl border border-neutral-200 p-4 space-y-1">
                  <p className="text-[14px] font-medium text-black">
                    Pay when your order arrives
                  </p>
                  <p className="text-[12px] leading-[18px] font-normal text-muted-foreground">
                    The rider collects the total in cash. Your items are reserved now, and the
                    market will confirm the order before it is packed.
                  </p>
                </div>
              )}

              {channel === 'wallet' && (
                <Field id="pay-wallet" label="Wallet number or address">
                  <Input
                    id="pay-wallet"
                    value={walletId}
                    onChange={(e) => setWalletId(e.target.value)}
                    placeholder="allen@stanbic"
                    className="bg-white border border-neutral-200 rounded-lg px-4 py-2 w-full font-normal text-[16px]"
                  />
                  <p className="mt-1 text-[11px] leading-[16px] font-normal text-muted-foreground">
                    Works with any wallet on the Uganda interbank and mobile money switch.
                  </p>
                </Field>
              )}

              {error && <Notice tone="error">{error}</Notice>}
            </>
          )}

          {stage === 'approval' && intent && (
            <>
              <div className="rounded-xl border border-brand/25 bg-brand/5 p-4 space-y-2">
                <p className="text-[11px] uppercase tracking-wider font-semibold text-brand">
                  {intent.nextAction?.ussd ? `Dial ${intent.nextAction.ussd}` : 'Awaiting approval'}
                </p>
                <p className="text-[14px] leading-[20px] font-normal text-black">
                  {intent.nextAction?.instructions ??
                    'Approve the request on your phone. The order moves on once the provider confirms.'}
                </p>
                {intent.channel === 'mobile_money' && phone && (
                  <p className="text-[12px] font-normal text-muted-foreground">
                    Requested from {normalizeUgandanPhone(phone) ?? phone}
                  </p>
                )}
                {intent.maskedCard && (
                  <p className="text-[12px] font-normal text-muted-foreground">
                    Card {intent.maskedCard}
                  </p>
                )}
                <p className="text-[11px] font-normal text-muted-foreground">
                  Reference {intent.reference}
                </p>
              </div>

              {totals && (
                <dl className="rounded-xl border border-neutral-200 p-4 space-y-1.5">
                  <Row label="Subtotal" value={formatUgx(totals.subtotal)} />
                  {totals.discount > 0 && (
                    <Row
                      label={totals.promoCode ? `Discount · ${totals.promoCode}` : 'Discount'}
                      value={`− ${formatUgx(totals.discount)}`}
                    />
                  )}
                  <Row
                    label="Delivery"
                    value={totals.shipping === 0 ? 'Free' : formatUgx(totals.shipping)}
                  />
                  {totals.tax > 0 && <Row label="Tax" value={formatUgx(totals.tax)} />}
                  <div className="border-t border-neutral-100 pt-1.5 mt-1.5">
                    <Row label="Total" value={formatUgx(totals.total)} strong />
                  </div>
                </dl>
              )}

              {error && <Notice tone="error">{error}</Notice>}

              <div className="space-y-2">
                {settlementToken ? (
                  <button
                    onClick={confirmPayment}
                    disabled={busy}
                    className="w-full bg-brand text-white rounded-lg py-3 text-[14px] font-medium disabled:opacity-60"
                  >
                    {busy ? 'Confirming…' : 'I have approved the payment'}
                  </button>
                ) : (
                  <Notice tone="success">
                    Waiting for {intent.provider} to confirm. This payment is settled by the
                    provider, so the order moves on as soon as the confirmation arrives.
                  </Notice>
                )}
                <button
                  onClick={cancelPayment}
                  disabled={busy}
                  className="w-full border border-neutral-300 rounded-lg py-2.5 text-[13px] font-normal text-black disabled:opacity-60"
                >
                  Cancel payment
                </button>
              </div>
            </>
          )}

          {stage === 'done' && intent && (
            <div className="space-y-3">
              <Notice tone="success">
                {intent.channel === 'cod'
                  ? `${formatUgx(intent.amount)} is due on delivery. The market will confirm your order before packing.`
                  : `${formatUgx(intent.amount)} received by ${intent.provider}.`}
              </Notice>
              <dl className="rounded-xl border border-neutral-200 p-4 space-y-1.5">
                <Row label="Channel" value={intent.provider} />
                {orderReference && <Row label="Order" value={orderReference} />}
                <Row label="Reference" value={intent.reference} />
                {intent.channel === 'mobile_money' && phone && (
                  <Row label="Number" value={normalizeUgandanPhone(phone) ?? phone} />
                )}
                {intent.maskedCard && <Row label="Card" value={intent.maskedCard} />}
              </dl>
              <button
                onClick={onProceedToConfirmation}
                className="w-full bg-brand text-white rounded-lg py-3 text-[14px] font-medium"
              >
                Continue to confirmation
              </button>
            </div>
          )}
        </div>
      </div>

      {stage === 'details' && (
        <Footer
          isFormValid={isFormValid && !methodsError}
          busy={busy}
          label={
            cartId === null || !orderReference
              ? 'Order unavailable'
              : channel === 'cod'
                ? 'Place order'
                : 'Pay now'
          }
          onPay={handlePay}
        />
      )}
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-[13px] font-normal text-muted-foreground">{label}</dt>
      <dd
        className={`text-[13px] font-normal ${
          strong ? 'text-brand font-semibold' : 'text-black'
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-[14px] font-normal text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

function Notice({ tone, children }: { tone: 'error' | 'success'; children: React.ReactNode }) {
  const styles =
    tone === 'error'
      ? 'border-red-200 bg-red-50 text-red-700'
      : 'border-brand/25 bg-brand/8 text-brand';
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`rounded-lg border px-3 py-2 text-[13px] leading-[19px] font-normal ${styles}`}
    >
      {children}
    </div>
  );
}

function Footer({
  isFormValid,
  busy,
  label,
  onPay,
}: {
  isFormValid: boolean;
  busy: boolean;
  label: string;
  onPay: () => void;
}) {
  return (
    <div className="absolute bg-white bottom-0 h-[124px] left-0 overflow-clip right-0 shadow-[0px_0px_20px_0px_rgba(0,0,0,0.1)]">
      <button
        onClick={isFormValid && !busy ? onPay : undefined}
        disabled={!isFormValid || busy}
        className={`absolute left-6 right-6 rounded-lg top-6 ${
          isFormValid ? 'bg-brand cursor-pointer' : 'bg-neutral-200 cursor-not-allowed'
        }`}
      >
        <div className="flex flex-row items-center relative size-full">
          <div className="flex flex-row items-center justify-start pl-6 pr-4 py-2 relative w-full">
            <p className="text-[14px] font-normal text-white grow">
              {busy ? 'Working…' : label}
            </p>
            <div className="size-8 shrink-0">
              <svg className="block size-full" fill="none" viewBox="0 0 32 32">
                <path d={svgPaths.p3d7c1f80} fill="var(--fill-0, white)" />
              </svg>
            </div>
          </div>
        </div>
      </button>
    </div>
  );
}

function StatusBar() {
  return (
    <div className="absolute h-[47px] left-0 overflow-clip right-0 top-0">
      <div className="absolute h-[33px] top-[-2px] translate-x-[-50%] w-[156px]" style={{ left: 'calc(50% + 0.499992px)' }}>
        <svg className="block size-full" fill="none" viewBox="0 0 156 33">
          <g>
            <path d={svgPaths.p28770100} fill="black" />
            <path d={svgPaths.p28f48b80} fill="var(--fill-0, black)" />
            <path d={svgPaths.p14d82600} fill="var(--fill-0, black)" />
          </g>
        </svg>
      </div>
      <div className="absolute h-[21px] rounded-3xl top-3.5 translate-x-[-50%] w-[54px]" style={{ left: 'calc(50% - 135.5px)' }}>
        <p className="font-bold h-5 leading-[0] not-italic text-black text-[17px] text-center tracking-[-0.408px] translate-x-[-50%] w-[54px]">
          <span className="block leading-[22px]">9:41</span>
        </p>
      </div>
      <div className="absolute h-[13px] top-[19px] translate-x-[-50%] w-[27.401px]" style={{ left: 'calc(50% + 150.201px)' }}>
        <svg className="block size-full" fill="none" viewBox="0 0 28 13">
          <g>
            <path d={svgPaths.p3f827980} opacity="0.35" stroke="var(--stroke-0, black)" />
            <path d={svgPaths.p5fdc300} fill="var(--fill-0, black)" opacity="0.4" />
            <path d={svgPaths.pbee4a00} fill="var(--fill-0, black)" />
          </g>
        </svg>
      </div>
    </div>
  );
}

function Header({
  cartCount,
  onBack,
  onMenuClick,
}: {
  cartCount: number;
  onBack: () => void;
  onMenuClick: () => void;
}) {
  return (
    <div className="absolute bg-white h-[149px] left-0 right-0 top-0">
      <div className="absolute border-[0px_0px_1px] border-neutral-200 border-solid inset-0 pointer-events-none shadow-[0px_0px_20px_0px_rgba(0,0,0,0.1)]" />

      <div
        className="absolute left-0 right-0 top-[31px] text-[24px] text-center font-serif font-medium text-brand translate-y-[-50%]"
        style={{ top: 'calc(31px + 36px)' }}
      >
        <p className="leading-none whitespace-pre">Mu Katale</p>
      </div>

      <div className="absolute right-5 rounded-2xl size-8 top-[18px]">
        <svg className="block size-full" fill="none" viewBox="0 0 32 32">
          <path d={svgPaths.p2003cd00} fill="var(--fill-0, black)" />
        </svg>
        {cartCount > 0 && (
          <div className="absolute bg-brand left-[17px] rounded-lg size-4 top-[-1px] flex items-center justify-center">
            <p className="text-white text-[9px] leading-none">{cartCount}</p>
          </div>
        )}
      </div>

      <button
        onClick={onMenuClick}
        aria-label="Open navigation menu"
        className="absolute left-5 rounded-2xl size-8 top-[18px] flex items-center justify-center cursor-pointer"
      >
        <div className="h-1.5 w-[18px]">
          <svg className="block size-full" fill="none" viewBox="0 0 18 8">
            <line stroke="var(--stroke-0, black)" strokeWidth="1.5" x2="18" y1="1.25" y2="1.25" />
            <line stroke="var(--stroke-0, black)" strokeWidth="1.5" x2="18" y1="7.25" y2="7.25" />
          </svg>
        </div>
      </button>

      <div className="absolute left-6 right-6 top-[103px]">
        <div className="flex flex-row font-normal items-center justify-start w-full">
          <PageTitle>Payment</PageTitle>
          <button
            onClick={onBack}
            className="cursor-pointer flex items-center font-normal not-italic shrink-0 text-brand text-[14px] tracking-[-0.14px]"
          >
            <div className="flex flex-row items-center gap-2">
              <div className="w-3 h-3">
                <svg className="block size-full" fill="none" viewBox="0 0 12 12">
                  <path d="M7.5 9L4.5 6L7.5 3" className="stroke-brand" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <p className="block leading-[24px] whitespace-pre">Back</p>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}

function ProgressIndicators() {
  return (
    <>
      <div className="absolute left-6 top-[174px] size-8">
        <svg className="block size-full" fill="none" viewBox="0 0 32 32">
          <circle cx="16" cy="16" fill="var(--fill-0, var(--brand))" r="16" />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="font-normal text-white text-[16px] leading-none">1</span>
        </div>
      </div>
      <div className="absolute size-8 top-[174px]" style={{ left: 'calc(50% + 93.5px)' }}>
        <svg fill="none" viewBox="0 0 32 32" className="block size-full">
          <circle cx="16" cy="16" fill="var(--fill-0, var(--brand))" r="16" />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="font-normal text-white text-[16px] leading-none">2</span>
        </div>
      </div>
      <div className="absolute size-8 top-[174px]" style={{ left: 'calc(50% + 131.5px)' }}>
        <svg fill="none" viewBox="0 0 32 32" className="block size-full">
          <circle cx="16" cy="16" fill="var(--fill-0, #757575)" r="16" />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="font-normal text-white text-[16px] leading-none">3</span>
        </div>
      </div>
    </>
  );
}