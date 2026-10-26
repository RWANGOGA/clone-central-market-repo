import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ORDER_STATUSES,
  collectCash,
  getOrder,
  listOrders,
  recordRefund,
  setOrderStatus,
  subscribeToOrders,
  type MoneyState,
  type OrderDetail,
  type OrderListMeta,
  type OrderRow,
  type OrderStatus,
  type RefundDraft,
} from '../lib/orderApi';
import { formatUgx } from '../lib/currency';

const STATUS_TONE: Record<OrderStatus, string> = {
  pending: 'bg-[#b07d2b]/12 text-[#b07d2b] border-[#b07d2b]/25',
  processing: 'bg-brand/10 text-brand border-brand/20',
  shipped: 'bg-[#2b6cb0]/10 text-[#2b6cb0] border-[#2b6cb0]/20',
  delivered: 'bg-[#2f855a]/10 text-[#2f855a] border-[#2f855a]/20',
  cancelled: 'bg-neutral-100 text-muted-foreground border-neutral-200',
};

const MONEY_TONE: Record<MoneyState, string> = {
  unpaid: 'bg-neutral-100 text-muted-foreground border-neutral-200',
  cod_due: 'bg-[#b07d2b]/12 text-[#b07d2b] border-[#b07d2b]/25',
  paid: 'bg-[#2f855a]/10 text-[#2f855a] border-[#2f855a]/20',
  part_refunded: 'bg-[#2b6cb0]/10 text-[#2b6cb0] border-[#2b6cb0]/20',
  refunded: 'bg-neutral-100 text-muted-foreground border-neutral-200',
  refund_due: 'bg-red-50 text-red-700 border-red-200',
};

const MONEY_LABELS: Record<MoneyState, string> = {
  unpaid: 'Unpaid',
  cod_due: 'Cash to collect',
  paid: 'Paid',
  part_refunded: 'Partly refunded',
  refunded: 'Refunded',
  refund_due: 'Refund due',
};

const PAGE_SIZE = 25;

export default function OrderQueue({
  onBack,
  canRefund = false,
  embedded = false,
}: {
  onBack?: () => void;
  /** Refunds are money out, so only roles with refunds.write see the form. */
  canRefund?: boolean;
  /** Rendered inside the staff console, which already provides the page chrome. */
  embedded?: boolean;
}) {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [meta, setMeta] = useState<OrderListMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<string>('');
  const [region, setRegion] = useState<string>('');
  const [offset, setOffset] = useState(0);

  const [live, setLive] = useState(false);
  const [flash, setFlash] = useState<string[]>([]);
  const [selected, setSelected] = useState<OrderDetail | null>(null);

  const load = useCallback(async () => {
    const result = await listOrders({
      q: query || undefined,
      status: status || undefined,
      region: region || undefined,
      limit: PAGE_SIZE,
      offset,
    });

    if (!result) {
      setError('Could not reach the service.');
      setLoading(false);
      return;
    }
    if (!result.ok) {
      setError(result.error);
      setLoading(false);
      return;
    }

    setOrders(result.data.data);
    setMeta(result.data.meta);
    setError(null);
    setLoading(false);
  }, [query, status, region, offset]);

  useEffect(() => {
    load();
  }, [load]);

  // Live feed, with polling underneath as a safety net. The stream is
  // process-local, so on a multi-instance deployment it adds latency rather
  // than failing loudly, and the interval keeps the queue honest either way.
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    const unsubscribe = subscribeToOrders(
      (event) => {
        setFlash((current) => [event.reference, ...current].slice(0, 5));
        window.setTimeout(() => {
          setFlash((current) => current.filter((ref) => ref !== event.reference));
        }, 6000);
        loadRef.current();
      },
      setLive,
    );

    const poll = window.setInterval(() => loadRef.current(), 30_000);
    return () => {
      unsubscribe();
      window.clearInterval(poll);
    };
  }, []);

  const openOrder = async (row: OrderRow) => {
    const result = await getOrder(row.reference);
    if (!result) {
      setError('Could not reach the service.');
      return;
    }
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSelected(result.data.data);
  };

  const move = async (order: OrderDetail, next: string) => {
    const result = await setOrderStatus(order.reference, next);
    if (!result) {
      setError('Could not reach the service.');
      return;
    }
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSelected(result.data.data);
    setError(null);
    load();
  };

  const settle = async (order: OrderDetail) => {
    const result = await collectCash(order.reference);
    if (!result) {
      setError('Could not reach the service.');
      return;
    }
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSelected(result.data.data);
    setError(null);
    load();
  };

  const refund = async (order: OrderDetail, draft: RefundDraft) => {
    const result = await recordRefund(order.reference, draft);
    if (!result) {
      setError('Could not reach the service.');
      return;
    }
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSelected(result.data.data);
    setError(null);
    load();
  };

  if (selected) {
    return (
      <OrderDetailPanel
        order={selected}
        canRefund={canRefund}
        onBack={() => setSelected(null)}
        onMove={(next) => move(selected, next)}
        onCollect={() => settle(selected)}
        onRefund={(draft) => refund(selected, draft)}
        onError={setError}
      />
    );
  }

  return (
    <div className={`bg-[#f7f7f5] pb-6 ${embedded ? '' : 'h-full overflow-y-auto'}`}>
      <div
        className={`${embedded ? '' : 'sticky top-0'} z-10 bg-white border-b border-neutral-200 px-4 py-3`}
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[16px] font-serif font-medium text-brand leading-[22px]">
              Orders
            </p>
            <p className="text-[11px] font-normal text-muted-foreground">
              {meta ? `${meta.total} total` : 'Loading'}
              {live ? ' · live' : ' · refreshing every 30s'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`size-2 rounded-full ${live ? 'bg-[#2f855a]' : 'bg-neutral-300'}`}
              aria-label={live ? 'Live updates connected' : 'Not connected to live updates'}
            />
            {onBack && (
              <button
                onClick={onBack}
                className="text-[12px] font-medium text-brand"
              >
                Back
              </button>
            )}
          </div>
        </div>

        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOffset(0);
          }}
          placeholder="Search reference, name or phone"
          className="mt-2 w-full border border-neutral-200 rounded-lg px-3 py-2 text-[13px] font-normal"
        />

        <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1">
          <FilterChip active={status === ''} onClick={() => { setStatus(''); setOffset(0); }}>
            All
          </FilterChip>
          {ORDER_STATUSES.map((value) => (
            <FilterChip
              key={value}
              active={status === value}
              onClick={() => { setStatus(status === value ? '' : value); setOffset(0); }}
            >
              {value}
            </FilterChip>
          ))}
        </div>

        {meta && meta.regions.length > 1 && (
          <div className="mt-1.5 flex gap-1.5 overflow-x-auto pb-1">
            <FilterChip active={region === ''} onClick={() => { setRegion(''); setOffset(0); }}>
              All regions
            </FilterChip>
            {meta.regions.map((value) => (
              <FilterChip
                key={value}
                active={region === value}
                onClick={() => { setRegion(region === value ? '' : value); setOffset(0); }}
              >
                {value.replace(' Region', '')}
              </FilterChip>
            ))}
          </div>
        )}
      </div>

      <div className="p-4 space-y-2">
        {error && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700 font-normal">
            {error}
          </p>
        )}

        {loading && (
          <p className="py-6 text-center text-[13px] font-normal text-muted-foreground">
            Loading orders…
          </p>
        )}

        {!loading && orders.length === 0 && (
          <p className="py-6 text-center text-[13px] font-normal text-muted-foreground">
            No orders match these filters.
          </p>
        )}

        {orders.map((order) => (
          <button
            key={order.id}
            onClick={() => openOrder(order)}
            className={`w-full text-left rounded-xl border bg-white p-3 ${
              flash.includes(order.reference)
                ? 'border-brand ring-1 ring-brand/30'
                : 'border-neutral-200'
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[14px] font-medium text-[#000000]">
                  {order.customerName ?? 'Unknown customer'}
                  {flash.includes(order.reference) && (
                    <span className="ml-2 text-[10px] font-normal text-brand">
                      new
                    </span>
                  )}
                </p>
                <p className="text-[12px] font-normal text-muted-foreground">
                  {order.reference} · {order.phone ?? 'no phone'}
                </p>
                <p className="text-[11px] font-normal text-[#9a9a9a]">
                  {[order.district, order.region].filter(Boolean).join(', ')} ·{' '}
                  {order.itemCount} line{order.itemCount === 1 ? '' : 's'}, {order.unitCount} unit
                  {order.unitCount === 1 ? '' : 's'}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-[14px] font-medium text-brand">
                  {formatUgx(order.total)}
                </p>
                <span
                  className={`inline-block mt-1 text-[10px] px-2 py-0.5 rounded-full border font-medium ${STATUS_TONE[order.status]}`}
                >
                  {order.status}
                </span>
                <span
                  className={`inline-block mt-1 ml-1 text-[10px] px-2 py-0.5 rounded-full border font-medium ${MONEY_TONE[order.money.state]}`}
                >
                  {MONEY_LABELS[order.money.state]}
                </span>
              </div>
            </div>
          </button>
        ))}

        {meta && meta.total > PAGE_SIZE && (
          <div className="flex items-center justify-between pt-2">
            <button
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              disabled={offset === 0}
              className="px-3 py-2 rounded-lg border border-neutral-300 text-[12px] font-medium disabled:opacity-40"
            >
              Previous
            </button>
            <span className="text-[11px] font-normal text-muted-foreground">
              {offset + 1}–{Math.min(offset + PAGE_SIZE, meta.total)} of {meta.total}
            </span>
            <button
              onClick={() => setOffset(offset + PAGE_SIZE)}
              disabled={offset + PAGE_SIZE >= meta.total}
              className="px-3 py-2 rounded-lg border border-neutral-300 text-[12px] font-medium disabled:opacity-40"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 text-[11px] px-2.5 py-1 rounded-full border font-normal transition-colors ${
        active
          ? 'bg-brand text-white border-brand'
          : 'bg-white text-[#000000] border-neutral-300'
      }`}
    >
      {children}
    </button>
  );
}

function OrderDetailPanel({
  order,
  canRefund,
  onBack,
  onMove,
  onCollect,
  onRefund,
  onError,
}: {
  order: OrderDetail;
  canRefund: boolean;
  onBack: () => void;
  onMove: (next: string) => void;
  onCollect: () => Promise<void>;
  onRefund: (draft: RefundDraft) => Promise<void>;
  onError: (message: string | null) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [collecting, setCollecting] = useState(false);
  const [refunding, setRefunding] = useState(false);

  const act = async (next: string) => {
    setBusy(next);
    onError(null);
    onMove(next);
    setBusy(null);
    setNote('');
  };

  const collect = async () => {
    setCollecting(true);
    onError(null);
    await onCollect();
    setCollecting(false);
  };

  const refund = async (draft: RefundDraft) => {
    setRefunding(true);
    onError(null);
    await onRefund(draft);
    setRefunding(false);
  };

  const address = order.shippingAddress;

  return (
    <div className="h-full overflow-y-auto bg-[#f7f7f5] pb-8">
      <div className="sticky top-0 z-10 bg-white border-b border-neutral-200 px-4 py-3 flex items-center justify-between gap-3">
        <button
          onClick={onBack}
          className="text-[12px] font-medium text-brand"
        >
          &larr; All orders
        </button>
        <span
          className={`text-[11px] px-2 py-0.5 rounded-full border font-medium ${STATUS_TONE[order.status]}`}
        >
          {order.status}
        </span>
      </div>

      <div className="p-4 space-y-3">
        <div className="rounded-xl border border-neutral-200 bg-white p-3">
          <p className="text-[15px] font-medium text-[#000000]">
            {order.customerName ?? 'Unknown customer'}
          </p>
          <p className="text-[12px] font-normal text-muted-foreground">
            {order.reference} · {order.phone ?? 'no phone'}
          </p>
          {address && (
            <p className="mt-1 text-[12px] font-normal text-muted-foreground">
              {[address.address, address.district, address.region].filter(Boolean).join(', ')}
            </p>
          )}
          <p className="mt-2 text-[16px] font-medium text-brand">
            {formatUgx(order.total)}
          </p>
        </div>

        <div className="rounded-xl border border-neutral-200 bg-white p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[13px] font-medium text-[#000000]">Money</p>
            <span
              className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${MONEY_TONE[order.money.state]}`}
            >
              {MONEY_LABELS[order.money.state]}
            </span>
          </div>

          <div className="mt-2 space-y-1">
            <MoneyRow label="Paid" value={order.money.paid} zeroLabel="—" />
            {order.money.codDue > 0 && (
              <MoneyRow label="Cash to collect" value={order.money.codDue} />
            )}
            {order.money.refunded > 0 && (
              <MoneyRow label="Refunded" value={order.money.refunded} zeroLabel="—" />
            )}
          </div>

          {order.money.refundDue && (
            <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] text-red-700 font-normal">
              This order was cancelled, but {formatUgx(order.money.refundable)} has not been paid
              back yet.
            </p>
          )}

          {order.money.codDue > 0 && (
            <button
              onClick={collect}
              disabled={collecting}
              className="mt-2 w-full rounded-lg bg-brand text-white py-2 text-[12px] font-medium disabled:opacity-50"
            >
              {collecting ? 'Recording…' : `Collect ${formatUgx(order.money.codDue)} in cash`}
            </button>
          )}
        </div>

        {order.nextStatuses.length > 0 ? (
          <div className="rounded-xl border border-neutral-200 bg-white p-3 space-y-2">
            <p className="text-[13px] font-medium text-[#000000]">
              Move this order on
            </p>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Note for the timeline (optional)"
              className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-[13px] font-normal"
            />
            <div className="flex flex-wrap gap-1.5">
              {order.nextStatuses.map((next) => {
                // Delivering a cash order before the cash is in hand would
                // close it with money missing; the server refuses too.
                const blocked = next === 'delivered' && order.money.codDue > 0;
                return (
                  <button
                    key={next}
                    onClick={() => act(next)}
                    disabled={busy !== null || blocked}
                    title={blocked ? 'Collect the cash first' : undefined}
                    className="px-3 py-2 rounded-lg border border-neutral-300 text-[12px] font-medium disabled:opacity-40"
                  >
                    {busy === next ? 'Moving…' : `Mark ${next}`}
                  </button>
                );
              })}
            </div>
            {order.money.codDue > 0 && (
              <p className="text-[11px] text-muted-foreground font-normal">
                Collect the cash before marking this order delivered.
              </p>
            )}
          </div>
        ) : (
          <p className="rounded-xl border border-neutral-200 bg-white p-3 text-[12px] font-normal text-muted-foreground">
            This order has reached {order.status} and cannot change.
          </p>
        )}

        <div className="rounded-xl border border-neutral-200 bg-white p-3">
          <p className="text-[13px] font-medium text-[#000000] mb-2">
            Items
          </p>
          <div className="space-y-1.5">
            {order.items.map((item) => (
              <div key={item.id} className="flex items-baseline justify-between gap-2">
                <span className="text-[12px] font-normal text-[#000000]">
                  {item.quantity} × {item.name}
                </span>
                <span className="text-[12px] font-normal text-muted-foreground">
                  {formatUgx(item.lineTotal)}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-2 pt-2 border-t border-neutral-100 space-y-1">
            <MoneyRow label="Subtotal" value={order.subtotal} />
            <MoneyRow label="Delivery" value={order.shipping} />
            <MoneyRow label="Tax" value={order.tax} />
            <MoneyRow label="Total" value={order.total} strong />
          </div>
        </div>

        {order.payments.length > 0 && (
          <div className="rounded-xl border border-neutral-200 bg-white p-3">
            <p className="text-[13px] font-medium text-[#000000] mb-2">
              Payment
            </p>
            <div className="space-y-1.5">
              {order.payments.map((payment) => (
                <div key={payment.id}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[12px] font-normal text-[#000000]">
                      {payment.provider}
                      {payment.maskedCard ? ` ${payment.maskedCard}` : ''}
                    </span>
                    <span className="text-[12px] font-normal text-muted-foreground">
                      {payment.status} · {formatUgx(payment.amount)}
                    </span>
                  </div>
                  {payment.settledByEmail && (
                    <p className="text-[10px] font-normal text-[#9a9a9a]">
                      Cash taken by {payment.settledByEmail} · {payment.settledAt}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {canRefund && order.money.refundable > 0 && (
          <div className="rounded-xl border border-neutral-200 bg-white p-3 space-y-2">
            <p className="text-[13px] font-medium text-[#000000]">
              Record a refund
            </p>
            <p className="text-[11px] font-normal text-muted-foreground">
              Pay the customer back first, then log it here. At most{' '}
              {formatUgx(order.money.refundable)} on this order.
            </p>
            <RefundForm max={order.money.refundable} busy={refunding} onSubmit={refund} />
          </div>
        )}

        {order.refunds.length > 0 && (
          <div className="rounded-xl border border-neutral-200 bg-white p-3">
            <p className="text-[13px] font-medium text-[#000000] mb-2">
              Refunds
            </p>
            <div className="space-y-2">
              {order.refunds.map((refund) => (
                <div key={refund.id}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[12px] font-medium text-[#000000]">
                      {refund.reference}
                    </span>
                    <span className="text-[12px] font-normal text-muted-foreground">
                      {formatUgx(refund.amount)}
                    </span>
                  </div>
                  <p className="text-[10px] font-normal text-[#9a9a9a]">
                    {refund.method.replace('_', ' ')} · {refund.createdByEmail ?? 'system'} ·{' '}
                    {refund.createdAt}
                  </p>
                  <p className="text-[11px] font-normal text-muted-foreground">
                    {refund.reason}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="rounded-xl border border-neutral-200 bg-white p-3">
          <p className="text-[13px] font-medium text-[#000000] mb-2">
            Timeline
          </p>
          <ol className="space-y-2">
            {order.timeline.map((entry) => (
              <li key={entry.id} className="flex gap-2">
                <span className="mt-1 size-2 shrink-0 rounded-full bg-brand" />
                <div className="min-w-0">
                  <p className="text-[12px] font-normal text-[#000000]">
                    {entry.fromStatus ? `${entry.fromStatus} → ` : ''}
                    {entry.toStatus}
                  </p>
                  <p className="text-[11px] font-normal text-[#9a9a9a]">
                    {entry.changedByEmail ?? 'system'} · {entry.createdAt}
                  </p>
                  {entry.note && (
                    <p className="text-[11px] font-normal text-muted-foreground">
                      {entry.note}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}

function RefundForm({
  max,
  busy,
  onSubmit,
}: {
  max: number;
  busy: boolean;
  onSubmit: (draft: RefundDraft) => Promise<void>;
}) {
  const [amount, setAmount] = useState(String(max));
  const [method, setMethod] = useState<RefundDraft['method']>('cash');
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;

    const value = Number.parseInt(amount, 10);
    if (!Number.isFinite(value) || value <= 0) {
      setProblem('Enter an amount greater than zero.');
      return;
    }
    if (value > max) {
      setProblem(`At most ${formatUgx(max)} can be refunded.`);
      return;
    }
    if (reason.trim().length < 3) {
      setProblem('Say why the money is going back.');
      return;
    }

    setProblem(null);
    await onSubmit({ amount: value, method, reason: reason.trim() });
    setReason('');
  };

  return (
    <form onSubmit={submit} className="space-y-2">
      <label className="block text-[11px] font-normal text-muted-foreground">
        Amount
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ''))}
          inputMode="numeric"
          className="mt-1 w-full border border-neutral-200 rounded-lg px-3 py-2 text-[13px] font-normal"
        />
      </label>

      <label className="block text-[11px] font-normal text-muted-foreground">
        Paid back by
        <select
          value={method}
          onChange={(e) => setMethod(e.target.value as RefundDraft['method'])}
          className="mt-1 w-full border border-neutral-200 rounded-lg px-3 py-2 text-[13px] font-normal bg-white"
        >
          <option value="cash">Cash</option>
          <option value="mobile_money">Mobile money</option>
          <option value="wallet">Bank or wallet</option>
        </select>
      </label>

      <label className="block text-[11px] font-normal text-muted-foreground">
        Reason
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. damaged tomatoes, customer cancelled"
          className="mt-1 w-full border border-neutral-200 rounded-lg px-3 py-2 text-[13px] font-normal"
        />
      </label>

      {problem && (
        <p className="text-[11px] text-red-700 font-normal">{problem}</p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-lg border border-brand text-brand py-2 text-[12px] font-medium disabled:opacity-50"
      >
        {busy ? 'Recording…' : 'Record this refund'}
      </button>
    </form>
  );
}

function MoneyRow({
  label,
  value,
  strong,
  zeroLabel = 'Free',
}: {
  label: string;
  value: number;
  strong?: boolean;
  zeroLabel?: string;
}) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-[12px] font-normal text-muted-foreground">{label}</span>
      <span
        className={`text-[12px] font-normal ${
          strong ? 'text-brand font-semibold' : 'text-[#000000]'
        }`}
      >
        {value === 0 ? zeroLabel : formatUgx(value)}
      </span>
    </div>
  );
}