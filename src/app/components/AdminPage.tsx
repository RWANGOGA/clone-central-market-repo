import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  adjustInventory,
  analyticsExportUrl,
  cancelPurchaseOrder,
  changePassword,
  createAdmin,
  createProduct,
  createPromo,
  createMarket,
  createPurchaseOrder,
  createSupplier,
  createWorker,
  currentAdmin,
  deactivateCustomer,
  fileToDataUrl,
  getForecast,
  getAnalyticsOverview,
  listActivityLog,
  listAdminProducts,
  listAdmins,
  listCustomers,
  listInventoryMovements,
  listMarkets,
  listWorkers,
  listProductPerformance,
  listPromos,
  listPurchaseOrders,
  listRegionalDemand,
  listSalesTrend,
  listSuppliers,
  receivePurchaseOrder,
  setPromoActive,
  signOut,
  updateProduct,
  updateAdmin,
  updateWorker,
  type ActivityLogRow,
  type AdminAccount,
  type AdminIdentity,
  type AdminProduct,
  type AdminPromo,
  type AdminRole,
  type AnalyticsOverview,
  type CustomerRow,
  type ForecastResult,
  type MarketRow,
  type WorkerKind,
  type WorkerRow,
  type ProductDraft,
  type ProductPerformanceRow,
  type PromoDraft,
  type PurchaseOrderRow,
  type RegionalDemandRow,
  type SalesTrendPoint,
  type StockMovementRow,
  type SupplierRow,
  WORKER_KINDS,
} from '../lib/adminApi';
import { getActiveMarket, setActiveMarket } from '../lib/activeMarket';
import AdminGate from './AdminGate';
import OrderQueue from './OrderQueue';
import StockBadge from './StockBadge';
import { describeStockOf } from '../lib/stockApi';
import { formatUgx } from '../lib/currency';
import { SectionTitle } from './shared/PageTitle';

const UNITS = ['kg', 'each', 'pint', 'bunch', 'crate'] as const;

type Tab =
  | 'orders'
  | 'catalogue'
  | 'inventory'
  | 'purchase-orders'
  | 'suppliers'
  | 'promotions'
  | 'analytics'
  | 'activity'
  | 'admins'
  | 'customers'
  | 'markets'
  | 'people';

const EMPTY_DRAFT: ProductDraft = {
  name: '',
  description: '',
  farm: '',
  location: '',
  priceValue: 0,
  unit: 'kg',
  stock: 0,
  dietary: [],
};

export default function AdminPage({ onClose }: { onClose?: () => void }) {
  const [admin, setAdmin] = useState<AdminIdentity | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let cancelled = false;
    currentAdmin().then((result) => {
      if (cancelled) return;
      if (result) setAdmin(result);
      setChecking(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (checking) {
    return (
      <div className="h-full flex items-center justify-center text-[14px] font-normal text-muted-foreground">
        Checking your session…
      </div>
    );
  }

  if (!admin) return <AdminGate onSignedIn={setAdmin} />;

  // Mirrors `admins.write` in api/src/lib/adminPermissions.ts: a market owner
  // staffs its own market, and a super admin staffs the platform.
  const canManageAdmins = admin.role === 'super' || admin.role === 'owner';

  return (
    <StaffShell
      admin={admin}
      canManageAdmins={canManageAdmins}
      onSignOut={async () => {
        await signOut();
        setAdmin(null);
      }}
      onClose={onClose}
    />
  );
}

function StaffShell({
  admin,
  canManageAdmins,
  onSignOut,
  onClose,
}: {
  admin: AdminIdentity;
  canManageAdmins: boolean;
  onSignOut: () => Promise<void>;
  onClose?: () => void;
}) {
  const [tab, setTab] = useState<Tab>(admin.role === 'staff' ? 'orders' : 'catalogue');
  const [markets, setMarkets] = useState<MarketRow[]>([]);
  // Which market the console is reading. Null is the platform view of all of
  // them, and only a platform account can ever change it.
  const [market, setMarket] = useState<number | null>(getActiveMarket());
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshMarkets = useCallback(() => {
    listMarkets().then((result) => {
      if (result) setMarkets(result.rows);
    });
  }, []);

  const chooseMarket = useCallback((value: number | null) => {
    setMarket(value);
    // The staff and order clients read this on every request, so a panel that
    // fetches later cannot slip back to another market.
    setActiveMarket(value);
  }, []);

  const flash = useCallback((message: string) => {
    setNotice(message);
    setError(null);
    window.setTimeout(() => setNotice(null), 4000);
  }, []);

  const fail = useCallback((message: string) => {
    setError(message);
    setNotice(null);
    window.setTimeout(() => setError(null), 5000);
  }, []);

  // Shop assistants only fulfil orders, so the write-heavy tabs are not shown
  // to them at all. The server enforces the same matrix regardless.
  const isStaff = admin.role === 'staff';
  const isPlatform = admin.marketId == null;
  // Opening a market is the platform's act, not merely an act of an account that
  // happens to carry no market id. The API refuses the difference, so the console
  // does not offer a button that would only come back with a 403.
  const isSuper = isPlatform && admin.role === 'super';
  const marketName = isPlatform
    ? null
    : (markets.find((item) => item.id === admin.marketId)?.name ?? 'My market');

  useEffect(() => {
    // Small, and needed in three places — the switcher, the badge under the
    // name, and the Markets tab — so it is fetched once here rather than by
    // each panel that shows a market name.
    let cancelled = false;
    listMarkets().then((result) => {
      if (!cancelled && result) setMarkets(result.rows);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const tabs: { value: Tab; label: string; disabled?: boolean }[] = [
    { value: 'orders', label: 'Orders' },
    ...(isStaff
      ? []
      : [
          { value: 'catalogue' as const, label: 'Catalogue' },
          { value: 'inventory' as const, label: 'Inventory' },
          { value: 'purchase-orders' as const, label: 'Purchase orders' },
          { value: 'suppliers' as const, label: 'Suppliers' },
          { value: 'promotions' as const, label: 'Promotions' },
          { value: 'analytics' as const, label: 'Analytics' },
          { value: 'people' as const, label: 'People' },
        ]),
    ...(isSuper ? [{ value: 'markets' as const, label: 'Markets' }] : []),
    { value: 'activity', label: 'Activity log' },
    { value: 'customers', label: 'Customers' },
    ...(canManageAdmins ? [{ value: 'admins' as const, label: 'Admins' }] : []),
  ];

  return (
    <div className="h-full overflow-y-auto bg-[#f7f7f5]">
      <div className="sticky top-0 bg-white border-b border-neutral-200 px-4 py-3 z-10">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-[16px] font-serif font-medium text-brand leading-[22px]">
              Staff
            </h1>
            <p className="text-[11px] font-normal text-muted-foreground">
              {admin.name} · {ADMIN_ROLE_LABELS[admin.role] ?? admin.role}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isPlatform && markets.length > 1 && (
              <label className="flex items-center gap-1.5">
                <span className="text-[11px] text-muted-foreground">Market</span>
                <select
                  value={market === null ? '' : String(market)}
                  onChange={(event) =>
                    chooseMarket(event.target.value === '' ? null : Number(event.target.value))
                  }
                  className="rounded-lg border border-neutral-200 bg-white px-2 py-1 text-[12px]"
                >
                  <option value="">All markets</option>
                  {markets.map((item) => (
                    <option key={item.id} value={String(item.id)}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {!isPlatform && (
              <span className="rounded-full bg-brand/10 px-2.5 py-1 text-[11px] font-medium text-brand">
                {marketName}
              </span>
            )}
            {onClose && (
              <button
                onClick={onClose}
                className="text-[12px] font-medium text-brand"
              >
                Back to shop
              </button>
            )}
            <button
              onClick={onSignOut}
              className="text-[12px] font-normal text-muted-foreground"
            >
              Sign out
            </button>
          </div>
        </div>

        <div className="mt-2 flex gap-1 overflow-x-auto pb-1">
          {tabs.map((item) => (
            <button
              key={item.value}
              disabled={item.disabled}
              onClick={(event) => {
                setTab(item.value);
                // The strip is wider than the phone: keep the chosen pill visible.
                event.currentTarget.scrollIntoView({ inline: 'center', block: 'nearest' });
              }}
              className={`whitespace-nowrap px-3 py-1.5 rounded-full text-[12px] font-medium ${
                tab === item.value
                  ? 'bg-brand text-white'
                  : item.disabled
                    ? 'bg-neutral-200 text-neutral-400 cursor-not-allowed'
                    : 'bg-neutral-100 text-black'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {notice && (
          <p className="mt-2 rounded-lg border border-brand/25 bg-brand/8 px-3 py-2 text-[13px] text-brand font-normal">
            {notice}
          </p>
        )}
        {error && (
          <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700 font-normal">
            {error}
          </p>
        )}
      </div>

      {/* Changing market remounts the panel, so nothing cached from the
          previous market is left on screen while the new one loads. */}
      <div key={market ?? 'all'} className={tab === 'orders' ? '' : 'p-4'}>
        {tab === 'orders' && <OrderQueue canRefund={!isStaff} embedded />}
        {tab === 'catalogue' && <CataloguePanel admin={admin} flash={flash} fail={fail} />}
        {tab === 'inventory' && <InventoryPanel flash={flash} fail={fail} />}
        {tab === 'purchase-orders' && <PurchaseOrdersPanel flash={flash} fail={fail} />}
        {tab === 'suppliers' && <SuppliersPanel flash={flash} fail={fail} />}
        {tab === 'promotions' && <PromotionsPanel flash={flash} fail={fail} />}
        {tab === 'analytics' && <AnalyticsPanel flash={flash} fail={fail} />}
        {tab === 'activity' && <ActivityPanel fail={fail} />}
        {tab === 'customers' && <CustomersPanel flash={flash} fail={fail} />}
        {tab === 'admins' && canManageAdmins && (
          <AdminsPanel admin={admin} markets={markets} flash={flash} fail={fail} />
        )}
        {tab === 'people' && <PeoplePanel marketId={market} flash={flash} fail={fail} />}
        {tab === 'markets' && isSuper && (
          <MarketsPanel markets={markets} reload={refreshMarkets} flash={flash} fail={fail} />
        )}
      </div>
    </div>
  );
}

function CataloguePanel({
  flash,
  fail,
}: {
  admin: AdminIdentity;
  flash: (message: string) => void;
  fail: (message: string) => void;
}) {
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    const result = await listAdminProducts();
    setLoading(false);
    if (!result) return fail('Could not reach the service.');
    if (!result.ok) return fail(result.error);
    setProducts(result.data);
  }, [fail]);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreated = async (draft: ProductDraft, imageDataUrl?: string) => {
    const result = await createProduct(imageDataUrl ? { ...draft, imageDataUrl } : draft);
    if (!result) {
      fail('Could not reach the service.');
      return false;
    }
    if (!result.ok) {
      fail(result.error);
      return false;
    }
    setAdding(false);
    flash(`Added ${result.data.name}.`);
    await load();
    return true;
  };

  const handleStock = async (product: AdminProduct, delta: number) => {
    const result = await updateProduct(product.id, { stock: product.stock + delta });
    if (!result) return fail('Could not reach the service.');
    if (!result.ok) return fail(result.error);
    setProducts((current) =>
      current.map((p) => (p.id === product.id ? result.data : p)),
    );
  };

  const handleToggle = async (product: AdminProduct) => {
    const result = await updateProduct(product.id, { active: !product.active });
    if (!result) return fail('Could not reach the service.');
    if (!result.ok) return fail(result.error);
    setProducts((current) =>
      current.map((p) => (p.id === product.id ? result.data : p)),
    );
    flash(product.active ? 'Withdrawn.' : 'Restored.');
  };

  return (
    <div className="p-4 space-y-3">
      {!adding && (
        <button
          onClick={() => setAdding(true)}
          className="w-full rounded-xl bg-brand text-white py-3 text-[14px] font-medium"
        >
          Add a product
        </button>
      )}

      {adding && <ProductForm onCancel={() => setAdding(false)} onSubmit={handleCreated} />}

      {loading ? (
        <p className="text-[13px] text-muted-foreground py-4 text-center">Loading the catalogue…</p>
      ) : (
        products.map((product) => (
          <div
            key={product.id}
            className={`rounded-xl border bg-white p-3 ${
              product.active ? 'border-neutral-200' : 'border-neutral-200 opacity-70'
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                {/* A row label, not a section heading: it names one product in
                    a list and must stay with the left edge of the row. */}
                <h3 className="text-sm font-medium text-foreground">
                  {product.name}
                  {!product.active && (
                    <span className="ml-2 text-[11px] font-normal text-muted-foreground">withdrawn</span>
                  )}
                </h3>
                <p className="text-[12px] text-muted-foreground">
                  {product.price} · {product.farm}
                </p>
                <StockBadge
                  level={{
                    productId: product.id,
                    stock: product.stock,
                    unit: product.unit,
                    state: product.stockState as 'in_stock' | 'low' | 'out',
                    remaining: product.remaining,
                  }}
                />
              </div>
              <div className="mt-2.5 flex items-center gap-1.5">
                <button
                  onClick={() => handleStock(product, -1)}
                  disabled={product.stock < 1}
                  className="px-2.5 py-1.5 rounded-lg border border-neutral-300 text-[12px] disabled:opacity-40"
                >
                  −1
                </button>
                <span className="px-2 text-[12px] min-w-[64px] text-center">
                  {product.stock} {product.unit}
                </span>
                <button
                  onClick={() => handleStock(product, 1)}
                  className="px-2.5 py-1.5 rounded-lg border border-neutral-300 text-[12px]"
                >
                  +1
                </button>
                <button
                  onClick={() => handleToggle(product)}
                  className="ml-auto px-2.5 py-1.5 rounded-lg border border-neutral-300 text-[12px] text-brand"
                >
                  {product.active ? 'Withdraw' : 'Restore'}
                </button>
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function ProductForm({
  onCancel,
  onSubmit,
}: {
  onCancel: () => void;
  onSubmit: (draft: ProductDraft, imageDataUrl?: string) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<ProductDraft>(EMPTY_DRAFT);
  const [image, setImage] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const set = <K extends keyof ProductDraft>(key: K, value: ProductDraft[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  const valid =
    draft.name.trim().length >= 2 &&
    draft.description.trim().length >= 10 &&
    draft.farm.trim().length >= 2 &&
    draft.location.trim().length >= 2 &&
    draft.priceValue >= 1 &&
    Number.isInteger(draft.priceValue) &&
    draft.stock >= 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setLocalError(null);
    const ok = await onSubmit(
      { ...draft, name: draft.name.trim(), farm: draft.farm.trim() },
      image,
    );
    setBusy(false);
    if (!ok) setLocalError('The product was not added. Check the fields above.');
    else setDraft(EMPTY_DRAFT);
  };

  const inputClass =
    'w-full border border-neutral-200 rounded-lg px-3 py-2 text-[14px] font-normal';

  return (
    <form onSubmit={submit} className="rounded-xl border border-neutral-200 bg-white p-3 space-y-2.5">
      <SectionTitle size="small" family="label">New product</SectionTitle>

      <Field label="Name">
        <input
          value={draft.name}
          onChange={(e) => set('name', e.target.value)}
          placeholder="Green Pepper"
          className={inputClass}
        />
      </Field>
      <Field label="Description">
        <textarea
          value={draft.description}
          onChange={(e) => set('description', e.target.value)}
          rows={3}
          placeholder="Firm, glossy green peppers."
          className={`${inputClass} resize-none`}
        />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Farm">
          <input
            value={draft.farm}
            onChange={(e) => set('farm', e.target.value)}
            placeholder="Nabugabo Farm"
            className={inputClass}
          />
        </Field>
        <Field label="Location">
          <input
            value={draft.location}
            onChange={(e) => set('location', e.target.value)}
            placeholder="Wakiso District"
            className={inputClass}
          />
        </Field>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Field label="Price (USh)">
          <input
            type="number"
            inputMode="numeric"
            value={draft.priceValue || ''}
            onChange={(e) => set('priceValue', Number(e.target.value))}
            placeholder="8500"
            className={inputClass}
          />
        </Field>
        <Field label="Unit">
          <select value={draft.unit} onChange={(e) => set('unit', e.target.value)} className={inputClass}>
            {UNITS.map((unit) => (
              <option key={unit} value={unit}>{unit}</option>
            ))}
          </select>
        </Field>
        <Field label="Stock">
          <input
            type="number"
            inputMode="numeric"
            value={draft.stock}
            onChange={(e) => set('stock', Number(e.target.value))}
            className={inputClass}
          />
        </Field>
      </div>
      <p className="text-[11px] text-muted-foreground">
        {draft.priceValue > 0 ? formatUgx(draft.priceValue) : 'the price'} per {draft.unit}
        {draft.stock > 0 ? `, ${describeStockOf(draft.stock, draft.unit)}.` : '.'}
      </p>
      <Field label="Photo (optional)">
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp,image/avif"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) { setImage(undefined); return; }
            try { setImage(await fileToDataUrl(file)); }
            catch { setLocalError('That file could not be read.'); }
          }}
          className="text-[12px]"
        />
      </Field>
      {localError && <p className="text-[12px] text-red-600">{localError}</p>}
      <div className="flex gap-2 pt-1">
        <button type="button" onClick={onCancel} className="flex-1 rounded-lg border border-neutral-300 py-2.5 text-[13px]">
          Cancel
        </button>
        <button
          type="submit"
          disabled={!valid || busy}
          className={`flex-1 rounded-lg py-2.5 text-[13px] text-white ${!valid || busy ? 'bg-neutral-300 cursor-not-allowed' : 'bg-brand'}`}
        >
          {busy ? 'Adding…' : 'Add product'}
        </button>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-[12px] text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

/* ---------------- Inventory ---------------- */

function InventoryPanel({ flash, fail }: { flash: (m: string) => void; fail: (m: string) => void }) {
  const [movements, setMovements] = useState<StockMovementRow[]>([]);
  const [totals, setTotals] = useState<{ total: number; net: number } | null>(null);
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [productId, setProductId] = useState<number | null>(null);
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState<'adjustment' | 'waste' | 'return' | 'correction'>('adjustment');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [m, p] = await Promise.all([
      listInventoryMovements({ limit: 50 }),
      listAdminProducts(),
    ]);
    setLoading(false);
    if (!m) return fail('Could not reach the service.');
    if (!m.ok) return fail(m.error);
    setMovements(m.data.data);
    setTotals({ total: m.data.meta.total, net: m.data.meta.net });
    if (p && p.ok) setProducts(p.data);
  }, [fail]);

  useEffect(() => { load(); }, [load]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const pid = Number(productId);
    const d = Number(delta);
    if (!Number.isInteger(pid) || pid <= 0 || !Number.isInteger(d) || d === 0) {
      return fail('Pick a product and a whole-number change.');
    }
    setBusy(true);
    const result = await adjustInventory(pid, { delta: d, reason, note: note || undefined });
    setBusy(false);
    if (!result) return fail('Could not reach the service.');
    if (!result.ok) return fail(result.error);
    setProductId(null); setDelta(''); setNote('');
    flash(`${result.data.name} is now ${result.data.stock} ${result.data.unit}.`);
    await load();
  };

  return (
    <div className="space-y-3">
      <SectionTitle size="small" family="label">Stock movements</SectionTitle>
      {/* The table is the latest window while the ledger holds more, and the net
          is counted over all of it — so both numbers are named for what they are. */}
      {!loading && movements.length > 0 && totals && (
        <p className="text-[12px] text-muted-foreground">
          Latest {movements.length} of {totals.total} movements · the ledger nets{' '}
          <span className="tabular-nums">{totals.net > 0 ? '+' : ''}{totals.net}</span> units
        </p>
      )}
      {loading ? (
        <p className="text-[13px] text-muted-foreground py-4 text-center">Loading…</p>
      ) : movements.length === 0 ? (
        <p className="text-[13px] text-muted-foreground py-4 text-center">No movements yet.</p>
      ) : (
        <table className="w-full text-left border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-neutral-200">
              <th className="pb-2 text-muted-foreground font-normal">Product</th>
              <th className="pb-2 text-muted-foreground font-normal">Reason</th>
              <th className="pb-2 text-muted-foreground font-normal text-right">Delta</th>
              <th className="pb-2 text-muted-foreground font-normal text-right">When</th>
            </tr>
          </thead>
          <tbody>
            {movements.map((m) => (
              <tr key={m.id} className="border-b border-neutral-100 align-top">
                {/* The order reference sits under the product name instead of in
                    a column of its own. At phone width a fifth column pushed the
                    delta and the date apart until the rows collided. */}
                <td className="py-2 pr-2">
                  <span className="block">{m.productName ?? m.productId}</span>
                  {m.reference && (
                    <span className="block text-[11px] text-muted-foreground break-all">{m.reference}</span>
                  )}
                </td>
                <td className="py-2">{m.reason}</td>
                <td className="py-2 text-right tabular-nums">{m.delta > 0 ? '+' : ''}{m.delta}</td>
                <td className="py-2 text-right text-[12px] text-muted-foreground whitespace-nowrap">
                  {new Date(m.createdAt).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <form onSubmit={submit} className="rounded-xl border border-neutral-200 bg-white p-3 space-y-2">
        <p className="text-[13px] font-medium">Adjust stock</p>
        <p className="text-[11px] text-muted-foreground">Pick a product and enter a signed delta (negative removes stock).</p>
        <select
          value={productId ?? ''}
          onChange={(e) => setProductId(e.target.value ? Number(e.target.value) : null)}
          className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-[13px] bg-white"
        >
          <option value="">Choose a product</option>
          {products.map((product) => (
            <option key={product.id} value={product.id}>
              {product.name} — {product.stock} {product.unit}
            </option>
          ))}
        </select>
        <div className="grid grid-cols-3 gap-2 items-center">
          <input
            type="number"
            placeholder="Delta"
            value={delta}
            onChange={(e) => setDelta(e.target.value)}
            className="border border-neutral-200 rounded-lg px-3 py-2 text-[13px]"
          />
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value as typeof reason)}
            className="border border-neutral-200 rounded-lg px-3 py-2 text-[13px] bg-white"
          >
            <option value="adjustment">adjustment</option>
            <option value="waste">waste</option>
            <option value="return">return</option>
            <option value="correction">correction</option>
          </select>
          <button
            type="submit"
            disabled={busy || productId == null || delta === ''}
            className="bg-brand text-white rounded-lg px-3 py-2 text-[13px] disabled:opacity-40"
          >
            {busy ? 'Applying…' : 'Apply'}
          </button>
        </div>
        <input
          type="text"
          placeholder="Note (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="border border-neutral-200 rounded-lg px-3 py-2 text-[13px] w-full"
        />
      </form>
    </div>
  );
}

/* ---------------- Purchase Orders ---------------- */

function PurchaseOrdersPanel({ flash, fail }: { flash: (m: string) => void; fail: (m: string) => void }) {
  const [orders, setOrders] = useState<PurchaseOrderRow[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [adding, setAdding] = useState(false);
  const [supplierId, setSupplierId] = useState<number | null>(null);
  const [productId, setProductId] = useState<number | null>(null);
  const [quantity, setQuantity] = useState('1');
  const [unitPrice, setUnitPrice] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [po, s, p] = await Promise.all([
      listPurchaseOrders({ status: statusFilter || undefined }),
      listSuppliers(),
      listAdminProducts(),
    ]);
    setLoading(false);
    if (!po) return fail('Could not reach the service.');
    if (!po.ok) return fail(po.error);
    setOrders(po.data.data);
    if (s && s.ok) setSuppliers(s.data.data);
    if (p && p.ok) setProducts(p.data);
  }, [fail, statusFilter]);

  useEffect(() => { load(); }, [load]);

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    if (supplierId == null) return fail('Choose a supplier.');
    if (productId == null) return fail('Choose a product.');
    const qty = Number(quantity);
    const price = Number(unitPrice || 0);
    if (!Number.isInteger(qty) || qty < 1) return fail('Quantity must be at least 1.');
    if (!Number.isInteger(price) || price < 0) return fail('Unit price must be zero or more.');
    setBusy(true);
    const result = await createPurchaseOrder({
      supplierId,
      items: [{ productId, quantity: qty, unitPrice: price }],
    });
    setBusy(false);
    if (!result) return fail('Could not reach the service.');
    if (!result.ok) return fail(result.error);
    flash(`Purchase order ${result.data.reference} sent.`);
    setAdding(false);
    setSupplierId(null); setProductId(null); setQuantity('1'); setUnitPrice('');
    await load();
  };

  const handleCancel = async (order: PurchaseOrderRow) => {
    if (!window.confirm(`Cancel ${order.reference}?`)) return;
    const result = await cancelPurchaseOrder(order.id);
    if (!result) return fail('Could not reach the service.');
    if (!result.ok) return fail(result.error);
    flash('Cancelled.');
    await load();
  };

  const handleReceive = async (order: PurchaseOrderRow) => {
    const result = await receivePurchaseOrder(order.id);
    if (!result) return fail('Could not reach the service.');
    if (!result.ok) return fail(result.error);
    flash(`Received ${order.reference}; stock was added.`);
    await load();
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2 items-end">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="border border-neutral-200 rounded-lg px-3 py-2 text-[13px]"
        >
          <option value="">All statuses</option>
          <option>sent</option>
          <option>received</option>
          <option>cancelled</option>
        </select>
        <button
          onClick={() => setAdding((open) => !open)}
          className="bg-brand text-white rounded-lg px-3 py-2 text-[13px]"
        >
          {adding ? 'Close' : 'New'}
        </button>
      </div>

      {adding && (
        <form onSubmit={create} className="space-y-2 rounded-xl border border-neutral-200 bg-white p-3">
          <select
            value={supplierId ?? ''}
            onChange={(e) => setSupplierId(e.target.value ? Number(e.target.value) : null)}
            className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-[13px] bg-white"
          >
            <option value="">Choose a supplier</option>
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
            ))}
          </select>
          <select
            value={productId ?? ''}
            onChange={(e) => setProductId(e.target.value ? Number(e.target.value) : null)}
            className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-[13px] bg-white"
          >
            <option value="">Choose a product</option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name} — {product.stock} {product.unit} left
              </option>
            ))}
          </select>
          <div className="grid grid-cols-2 gap-2">
            <input
              type="number"
              min={1}
              placeholder="Quantity"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="border border-neutral-200 rounded-lg px-3 py-2 text-[13px]"
            />
            <input
              type="number"
              min={0}
              placeholder="Unit price (UGX)"
              value={unitPrice}
              onChange={(e) => setUnitPrice(e.target.value)}
              className="border border-neutral-200 rounded-lg px-3 py-2 text-[13px]"
            />
          </div>
          {suppliers.length === 0 && (
            <p className="text-[11px] text-muted-foreground">Add a supplier first on the Suppliers tab.</p>
          )}
          <button
            type="submit"
            disabled={busy || supplierId == null || productId == null}
            className="w-full rounded-lg bg-brand py-2 text-[13px] text-white disabled:opacity-40"
          >
            {busy ? 'Sending…' : 'Create purchase order'}
          </button>
        </form>
      )}

      {loading ? (
        <p className="text-[13px] text-muted-foreground py-4 text-center">Loading…</p>
      ) : orders.length === 0 ? (
        <p className="text-[13px] text-muted-foreground py-4 text-center">No purchase orders.</p>
      ) : (
        <table className="w-full text-left border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-neutral-200">
              <th className="pb-2 text-muted-foreground font-normal">Order</th>
              <th className="pb-2 text-muted-foreground font-normal">Status</th>
              <th className="pb-2 text-muted-foreground font-normal text-right">Raised</th>
              <th className="pb-2 text-muted-foreground font-normal text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id} className="border-b border-neutral-100 align-top">
                {/* Supplier and expected arrival are folded under the reference
                    rather than given columns of their own: six columns at phone
                    width squeezed the dates until "Expected" and "Created"
                    printed on top of each other. */}
                <td className="py-2 pr-2">
                  <span className="block break-all">{o.reference}</span>
                  <span className="block text-[11px] text-muted-foreground">
                    {suppliers.find((s) => s.id === o.supplierId)?.name ?? `Supplier ${o.supplierId}`}
                  </span>
                  {o.expectedAt && (
                    <span className="block text-[11px] text-muted-foreground tabular-nums">
                      due {new Date(o.expectedAt).toLocaleDateString()}
                    </span>
                  )}
                </td>
                <td className="py-2 pr-2">{o.status}</td>
                <td className="py-2 text-right text-[12px] text-muted-foreground whitespace-nowrap tabular-nums">
                  {new Date(o.createdAt).toLocaleDateString()}
                </td>
                <td className="py-2 text-right whitespace-nowrap">
                  {o.status === 'sent' && (
                    <>
                      <button
                        onClick={() => handleReceive(o)}
                        className="mr-2 text-[12px] text-brand underline underline-offset-2"
                      >
                        Receive
                      </button>
                      <button
                        onClick={() => handleCancel(o)}
                        className="text-[12px] text-red-600 underline underline-offset-2"
                      >
                        Cancel
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* ---------------- Suppliers ---------------- */

function SuppliersPanel({ flash, fail }: { flash: (m: string) => void; fail: (m: string) => void }) {
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');

  const load = useCallback(async () => {
    const result = await listSuppliers();
    setLoading(false);
    if (!result) return fail('Could not reach the service.');
    if (!result.ok) return fail(result.error);
    setSuppliers(result.data.data);
  }, [fail]);

  useEffect(() => { load(); }, [load]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const result = await createSupplier({ name: name.trim() });
    if (!result) return fail('Could not reach the service.');
    if (!result.ok) return fail(result.error);
    setName('');
    flash('Supplier added.');
    await load();
  };

  return (
    <div className="space-y-3">
      <SectionTitle size="small" family="label">Suppliers</SectionTitle>
      <form onSubmit={submit} className="flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Supplier name"
          className="flex-1 border border-neutral-200 rounded-lg px-3 py-2 text-[13px]"
        />
        <button className="bg-brand text-white rounded-lg px-3 py-2 text-[13px]">Add</button>
      </form>
      {loading ? (
        <p className="text-[13px] text-muted-foreground py-4 text-center">Loading…</p>
      ) : suppliers.length === 0 ? (
        <p className="text-[13px] text-muted-foreground py-4 text-center">No suppliers.</p>
      ) : (
        <table className="w-full text-left border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-neutral-200">
              <th className="pb-2 text-muted-foreground">Name</th>
              <th className="pb-2 text-muted-foreground">Products</th>
              <th className="pb-2 text-muted-foreground">Region</th>
              <th className="pb-2 text-muted-foreground">Phone</th>
            </tr>
          </thead>
          <tbody>
            {suppliers.map((s) => (
              <tr key={s.id} className="border-b border-neutral-100">
                <td className="py-2">{s.name}</td>
                <td className="py-2">{String(s.productCount ?? 0)}</td>
                <td className="py-2">{s.region ?? '—'}</td>
                <td className="py-2">{s.phone ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* ---------------- Markets ---------------- */

function MarketsPanel({
  markets,
  reload,
  flash,
  fail,
}: {
  markets: MarketRow[];
  reload: () => void;
  flash: (m: string) => void;
  fail: (m: string) => void;
}) {
  const [name, setName] = useState('');
  const [district, setDistrict] = useState('');
  const [region, setRegion] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    const result = await createMarket({
      name: name.trim(),
      district: district.trim() || undefined,
      region: region.trim() || undefined,
    });
    setBusy(false);
    if (!result) return fail('Could not reach the service.');
    if (!result.ok) return fail(result.error);
    setName('');
    setDistrict('');
    setRegion('');
    flash(`${result.data.name} is open.`);
    reload();
  };

  return (
    <div className="space-y-3">
      <SectionTitle size="small" family="label">
        Markets on the platform
      </SectionTitle>
      <p className="text-[13px] text-muted-foreground">
        Each market keeps its own catalogue, orders, staff and roster. Opening one here does not
        move anything between them.
      </p>

      <form onSubmit={submit} className="grid gap-2 sm:grid-cols-[1fr_140px_140px_auto]">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Market name"
          className="border border-neutral-200 rounded-lg px-3 py-2 text-[13px]"
        />
        <input
          value={district}
          onChange={(e) => setDistrict(e.target.value)}
          placeholder="District"
          className="border border-neutral-200 rounded-lg px-3 py-2 text-[13px]"
        />
        <input
          value={region}
          onChange={(e) => setRegion(e.target.value)}
          placeholder="Region"
          className="border border-neutral-200 rounded-lg px-3 py-2 text-[13px]"
        />
        <button
          disabled={busy || !name.trim()}
          className="bg-brand text-white rounded-lg px-3 py-2 text-[13px] disabled:opacity-50"
        >
          Open market
        </button>
      </form>

      <table className="w-full text-left border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-neutral-200">
            <th className="pb-2 text-muted-foreground">Market</th>
            <th className="pb-2 text-muted-foreground">Sells</th>
            <th className="pb-2 text-muted-foreground">Out now</th>
            <th className="pb-2 text-muted-foreground">People</th>
          </tr>
        </thead>
        <tbody>
          {markets.map((item) => (
            <tr key={item.id} className="border-b border-neutral-100">
              <td className="py-2">
                {item.name}
                <span className="text-muted-foreground">
                  {item.district ? ` · ${item.district}` : ''}
                  {item.region ? `, ${item.region}` : ''}
                </span>
              </td>
              <td className="py-2">{item.products ?? 0} products</td>
              <td className="py-2">{item.deliveriesInProgress ?? 0} deliveries</td>
              <td className="py-2">{item.workers ?? 0} on the roster</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------- People ---------------- */

const WORKER_KIND_LABELS: Record<WorkerKind, string> = {
  deliverer: 'Deliverer',
  trader: 'Trader',
  picker: 'Picker',
  driver: 'Driver',
};

function PeoplePanel({
  marketId,
  flash,
  fail,
}: {
  marketId: number | null;
  flash: (m: string) => void;
  fail: (m: string) => void;
}) {
  const [rows, setRows] = useState<WorkerRow[]>([]);
  const [loading, setLoading] = useState(true);
  // An empty kind is the filter 'everyone', not a kind of worker.
  const [kind, setKind] = useState<WorkerKind | ''>('deliverer');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<WorkerKind>('deliverer');
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    const result = await listWorkers();
    setLoading(false);
    if (!result) return fail('Could not reach the service.');
    if (!result.ok) return fail(result.error);
    setRows(result.data);
  }, [fail]);

  useEffect(() => {
    load();
  }, [load]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const result = await createWorker({
      name: name.trim(),
      phone: phone.trim() || undefined,
      kind: role,
      // A platform account has to say where the person works; a market account
      // is pinned by the server, which ignores this.
      marketId: marketId ?? undefined,
    });
    if (!result) return fail('Could not reach the service.');
    if (!result.ok) return fail(result.error);
    setName('');
    setPhone('');
    flash(`${result.data.name} is on the roster.`);
    await load();
  };

  const patch = async (
    id: number,
    change: { name?: string; phone?: string; kind?: WorkerKind; available?: boolean; active?: boolean },
  ) => {
    setBusyId(id);
    const result = await updateWorker(id, change);
    setBusyId(null);
    if (!result) return fail('Could not reach the service.');
    if (!result.ok) return fail(result.error);
    await load();
  };

  const shown = kind ? rows.filter((row) => row.kind === kind) : rows;

  return (
    <div className="space-y-3">
      <SectionTitle size="small" family="label">
        The market's people
      </SectionTitle>
      <p className="text-[13px] text-muted-foreground">
        Deliverers, traders, pickers and drivers are a roster, not logins. Adding somebody here is
        what makes them assignable to a delivery.
      </p>

      <form onSubmit={submit} className="grid gap-2 sm:grid-cols-[1fr_140px_140px_auto]">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name"
          className="border border-neutral-200 rounded-lg px-3 py-2 text-[13px]"
        />
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="Phone"
          className="border border-neutral-200 rounded-lg px-3 py-2 text-[13px]"
        />
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as WorkerKind)}
          className="border border-neutral-200 rounded-lg px-3 py-2 text-[13px] bg-white"
        >
          {WORKER_KINDS.map((item) => (
            <option key={item} value={item}>
              {WORKER_KIND_LABELS[item]}
            </option>
          ))}
        </select>
        <button
          disabled={!name.trim()}
          className="bg-brand text-white rounded-lg px-3 py-2 text-[13px] disabled:opacity-50"
        >
          Add
        </button>
      </form>

      <div className="flex gap-1.5 flex-wrap">
        {(
          [{ value: '', label: 'Everyone' }, ...WORKER_KINDS.map((item) => ({
            value: item,
            label: WORKER_KIND_LABELS[item],
          }))] as { value: string; label: string }[]
        ).map((item) => (
          <button
            key={item.value || 'all'}
            onClick={() => setKind(item.value as WorkerKind | '')}
            className={`px-3 py-1 rounded-full text-[12px] font-medium ${
              kind === item.value ? 'bg-brand text-white' : 'bg-neutral-100 text-black'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-[13px] text-muted-foreground py-4 text-center">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="text-[13px] text-muted-foreground py-4 text-center">Nobody on the roster yet.</p>
      ) : (
        <table className="w-full text-left border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-neutral-200">
              <th className="pb-2 text-muted-foreground">Name</th>
              <th className="pb-2 text-muted-foreground">Works as</th>
              <th className="pb-2 text-muted-foreground">Phone</th>
              <th className="pb-2 text-muted-foreground">Today</th>
              <th className="pb-2 text-muted-foreground" />
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr key={row.id} className="border-b border-neutral-100">
                <td className="py-2">{row.name}</td>
                <td className="py-2">{WORKER_KIND_LABELS[row.kind] ?? row.kind}</td>
                <td className="py-2">{row.phone ?? '—'}</td>
                <td className="py-2">
                  <span
                    className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${
                      !row.active
                        ? 'bg-neutral-100 text-neutral-500'
                        : row.available
                          ? 'bg-brand/10 text-brand'
                          : 'bg-amber-50 text-amber-700'
                    }`}
                  >
                    {!row.active ? 'Left' : row.available ? 'Available' : 'Off'}
                  </span>
                </td>
                <td className="py-2 text-right whitespace-nowrap">
                  {row.active && (
                    <button
                      disabled={busyId === row.id}
                      onClick={() => patch(row.id, { available: !row.available })}
                      className="text-[12px] font-medium text-brand disabled:opacity-50"
                    >
                      {row.available ? 'Mark off' : 'Mark available'}
                    </button>
                  )}
                  {row.active && (
                    <button
                      disabled={busyId === row.id}
                      onClick={() => patch(row.id, { active: false })}
                      className="ml-3 text-[12px] text-red-600 disabled:opacity-50"
                    >
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* ---------------- Promotions ---------------- */

const EMPTY_PROMO: PromoDraft = {
  code: '',
  description: '',
  kind: 'percent',
  value: 10,
  minSubtotal: 0,
  maxDiscount: null,
  usageLimit: null,
  perCustomerLimit: 1,
  endsAt: null,
};

const PROMO_STATE_STYLES: Record<AdminPromo['state'], string> = {
  live: 'bg-brand/10 text-brand',
  scheduled: 'bg-blue-50 text-blue-700',
  paused: 'bg-neutral-100 text-neutral-600',
  expired: 'bg-red-50 text-red-700',
  exhausted: 'bg-amber-50 text-amber-700',
};

function PromotionsPanel({ flash, fail }: { flash: (m: string) => void; fail: (m: string) => void }) {
  const [promos, setPromos] = useState<AdminPromo[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<PromoDraft>(EMPTY_PROMO);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    const result = await listPromos();
    setLoading(false);
    if (!result) return fail('Could not reach the service.');
    if (!result.ok) return fail(result.error);
    setPromos(result.data);
  }, [fail]);

  useEffect(() => { load(); }, [load]);

  const update = <K extends keyof PromoDraft>(key: K, value: PromoDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft.code.trim()) return fail('Enter a code.');
    if (!Number.isInteger(draft.value) || draft.value <= 0) return fail('Enter a discount greater than zero.');

    const result = await createPromo({
      ...draft,
      code: draft.code.trim().toUpperCase(),
      description: draft.description?.trim() || undefined,
      minSubtotal: draft.minSubtotal ?? 0,
      maxDiscount: draft.kind === 'percent' ? (draft.maxDiscount ?? null) : null,
      usageLimit: draft.usageLimit ?? null,
      perCustomerLimit: draft.perCustomerLimit ?? null,
      endsAt: draft.endsAt || null,
    });
    if (!result) return fail('Could not reach the service.');
    if (!result.ok) return fail(result.error);
    setDraft(EMPTY_PROMO);
    setAdding(false);
    flash(`Code ${result.data.code} created.`);
    await load();
  };

  const toggle = async (promo: AdminPromo) => {
    setBusyId(promo.id);
    const result = await setPromoActive(promo.id, !promo.active);
    setBusyId(null);
    if (!result) return fail('Could not reach the service.');
    if (!result.ok) return fail(result.error);
    flash(`${promo.code} is now ${result.data.active ? 'active' : 'paused'}.`);
    await load();
  };

  const numberOrNull = (value: string) => (value.trim() === '' ? null : Math.max(0, Math.floor(Number(value) || 0)));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <SectionTitle size="small" family="label">Promo codes</SectionTitle>
        <button
          onClick={() => setAdding((open) => !open)}
          className="rounded-lg bg-brand px-3 py-1.5 text-[12px] text-white"
        >
          {adding ? 'Close' : 'New code'}
        </button>
      </div>

      {adding && (
        <form onSubmit={submit} className="space-y-2 rounded-xl border border-neutral-200 bg-white p-3">
          <div className="grid grid-cols-2 gap-2">
            <label className="col-span-2 text-[12px] text-muted-foreground">
              Code
              <input
                value={draft.code}
                onChange={(e) => update('code', e.target.value)}
                placeholder="WELCOME10"
                autoCapitalize="characters"
                className="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2 text-[13px] uppercase text-black"
              />
            </label>
            <label className="col-span-2 text-[12px] text-muted-foreground">
              Description
              <input
                value={draft.description ?? ''}
                onChange={(e) => update('description', e.target.value)}
                placeholder="10% off the first basket"
                className="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2 text-[13px] text-black"
              />
            </label>
            <label className="text-[12px] text-muted-foreground">
              Type
              <select
                value={draft.kind}
                onChange={(e) => update('kind', e.target.value as PromoDraft['kind'])}
                className="mt-1 w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-[13px] text-black"
              >
                <option value="percent">Percent off</option>
                <option value="fixed">Shillings off</option>
              </select>
            </label>
            <label className="text-[12px] text-muted-foreground">
              {draft.kind === 'percent' ? 'Percent (1–100)' : 'Shillings off'}
              <input
                type="number"
                min={1}
                value={draft.value}
                onChange={(e) => update('value', Math.floor(Number(e.target.value) || 0))}
                className="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2 text-[13px] text-black"
              />
            </label>
            <label className="text-[12px] text-muted-foreground">
              Minimum basket (UGX)
              <input
                type="number"
                min={0}
                value={draft.minSubtotal ?? 0}
                onChange={(e) => update('minSubtotal', Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                className="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2 text-[13px] text-black"
              />
            </label>
            {draft.kind === 'percent' && (
              <label className="text-[12px] text-muted-foreground">
                Cap (UGX, optional)
                <input
                  type="number"
                  min={1}
                  value={draft.maxDiscount ?? ''}
                  onChange={(e) => update('maxDiscount', numberOrNull(e.target.value))}
                  placeholder="No cap"
                  className="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2 text-[13px] text-black"
                />
              </label>
            )}
            <label className="text-[12px] text-muted-foreground">
              Total uses (optional)
              <input
                type="number"
                min={1}
                value={draft.usageLimit ?? ''}
                onChange={(e) => update('usageLimit', numberOrNull(e.target.value))}
                placeholder="Unlimited"
                className="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2 text-[13px] text-black"
              />
            </label>
            <label className="text-[12px] text-muted-foreground">
              Uses per customer (optional)
              <input
                type="number"
                min={1}
                value={draft.perCustomerLimit ?? ''}
                onChange={(e) => update('perCustomerLimit', numberOrNull(e.target.value))}
                placeholder="Unlimited"
                className="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2 text-[13px] text-black"
              />
            </label>
            <label className="col-span-2 text-[12px] text-muted-foreground">
              Ends on (optional)
              <input
                type="date"
                value={draft.endsAt ?? ''}
                onChange={(e) => update('endsAt', e.target.value || null)}
                className="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2 text-[13px] text-black"
              />
            </label>
          </div>
          <button className="w-full rounded-lg bg-brand py-2 text-[13px] text-white">Create code</button>
        </form>
      )}

      {loading ? (
        <p className="py-4 text-center text-[13px] text-muted-foreground">Loading…</p>
      ) : promos.length === 0 ? (
        <p className="py-4 text-center text-[13px] text-muted-foreground">No promo codes yet.</p>
      ) : (
        <div className="space-y-2">
          {promos.map((promo) => {
            const rule = promo.kind === 'percent'
              ? `${promo.value}% off${promo.maxDiscount ? ` (max ${formatUgx(promo.maxDiscount)})` : ''}`
              : `${formatUgx(promo.value)} off`;
            return (
              <div key={promo.id} className="rounded-xl border border-neutral-200 bg-white p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-[14px] text-black">{promo.code}</p>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${PROMO_STATE_STYLES[promo.state]}`}>
                        {promo.state}
                      </span>
                    </div>
                    {promo.description && (
                      <p className="mt-0.5 text-[11px] leading-[16px] text-muted-foreground">{promo.description}</p>
                    )}
                  </div>
                  <button
                    onClick={() => toggle(promo)}
                    disabled={busyId === promo.id}
                    className="shrink-0 rounded-lg border border-neutral-200 px-2.5 py-1 text-[11px] text-black disabled:opacity-50"
                  >
                    {promo.active ? 'Pause' : 'Resume'}
                  </button>
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                  <div className="flex justify-between">
                    <dt>Rule</dt>
                    <dd className="text-black">{rule}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt>Min basket</dt>
                    <dd className="text-black">{promo.minSubtotal ? formatUgx(promo.minSubtotal) : 'None'}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt>Used</dt>
                    <dd className="text-black">
                      {promo.usedCount}
                      {promo.usageLimit ? ` / ${promo.usageLimit}` : ''}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt>Per customer</dt>
                    <dd className="text-black">{promo.perCustomerLimit ?? 'Unlimited'}</dd>
                  </div>
                </dl>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ---------------- Analytics ---------------- */

const RANGES = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
] as const;

const PIPELINE: { value: string; label: string; color: string }[] = [
  { value: 'pending', label: 'Pending', color: 'bg-amber-400' },
  { value: 'processing', label: 'Processing', color: 'bg-blue-400' },
  { value: 'shipped', label: 'Shipped', color: 'bg-indigo-400' },
  { value: 'delivered', label: 'Delivered', color: 'bg-brand' },
  { value: 'cancelled', label: 'Cancelled', color: 'bg-red-400' },
];

const PAYMENT_LABELS: Record<string, string> = {
  succeeded: 'Paid online',
  cod: 'Cash on delivery',
  pending: 'Awaiting payment',
  awaiting_approval: 'Awaiting approval',
  processing: 'Processing',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

/** Midnight `days` ago, in the server's text timestamp format. */
function daysAgo(days: number) {
  const date = new Date(Date.now() - (days - 1) * 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}

function AnalyticsPanel({ flash, fail }: { flash: (m: string) => void; fail: (m: string) => void }) {
  const [rangeDays, setRangeDays] = useState(30);
  const [overview, setOverview] = useState<AnalyticsOverview | null>(null);
  const [trend, setTrend] = useState<SalesTrendPoint[]>([]);
  const [topProducts, setTopProducts] = useState<ProductPerformanceRow[]>([]);
  const [regions, setRegions] = useState<RegionalDemandRow[]>([]);
  const [forecast, setForecast] = useState<ForecastResult | null>(null);
  const [loading, setLoading] = useState(true);

  const from = useMemo(() => daysAgo(rangeDays), [rangeDays]);
  const bucket = rangeDays > 31 ? 'week' : 'day';

  const load = useCallback(async (announce = false) => {
    setLoading(true);
    const [o, t, p, r, f] = await Promise.all([
      getAnalyticsOverview({ from }),
      listSalesTrend({ from, bucket, limit: rangeDays > 31 ? 14 : rangeDays }),
      listProductPerformance({ from, limit: 6 }),
      listRegionalDemand({ from }),
      getForecast(),
    ]);
    setLoading(false);
    if (!o) return fail('Could not reach the service.');
    if (!o.ok) return fail(o.error);
    setOverview(o.data);
    setTrend(t && t.ok ? t.data : []);
    setTopProducts(p && p.ok ? p.data : []);
    setRegions(r && r.ok ? r.data : []);
    if (f && f.ok) setForecast(f.data);
    if (announce) flash('Dashboard refreshed.');
  }, [bucket, fail, flash, from, rangeDays]);

  useEffect(() => { load(); }, [load]);

  const totals = overview?.totals;
  const chart = [...trend].reverse();
  const peak = Math.max(...chart.map((point) => point.revenue), 1);
  const pipelineTotal = (overview?.status ?? []).reduce((sum, row) => sum + row.count, 0);
  const productPeak = Math.max(...topProducts.map((row) => row.revenue), 1);
  const restock = (forecast?.inventory ?? [])
    .filter((row) => row.daysOfCover !== null && row.daysOfCover <= 10)
    .sort((a, b) => (a.daysOfCover ?? 0) - (b.daysOfCover ?? 0))
    .slice(0, 5);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-1">
          {RANGES.map((range) => (
            <button
              key={range.days}
              onClick={() => setRangeDays(range.days)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
                rangeDays === range.days ? 'bg-brand text-white' : 'bg-neutral-100 text-black'
              }`}
            >
              {range.label}
            </button>
          ))}
        </div>
        <button onClick={() => load(true)} className="text-[11px] text-brand">
          Refresh
        </button>
      </div>

      {loading ? (
        <p className="text-[13px] text-muted-foreground py-6 text-center">Crunching the last {rangeDays} days…</p>
      ) : !overview || !totals ? (
        <p className="text-[13px] text-muted-foreground py-6 text-center">No analytics yet.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Kpi label="Revenue" value={formatUgx(totals.revenue)} note={`${totals.orders} paid orders`} />
            <Kpi label="Average basket" value={formatUgx(totals.averageOrderValue)} note={`${totals.units} units sold`} />
            <Kpi label="Discount given" value={formatUgx(totals.discounts)} note={`${overview.promos.length} codes used`} />
            <Kpi
              label="New customers"
              value={String(overview.newCustomers)}
              note={`${overview.inventory.lowStock} low · ${overview.inventory.outOfStock} out of stock`}
            />
          </div>

          <Section title={`Revenue per ${bucket}`}>
            {chart.length === 0 ? (
              <p className="text-[12px] text-muted-foreground">No paid orders in this window.</p>
            ) : (
              <>
                <div className="flex h-24 items-end justify-start gap-[2px]">
                  {chart.map((point) => (
                    <div
                      key={point.bucket}
                      title={`${point.bucket}: ${formatUgx(point.revenue)} · ${point.orders} orders`}
                      className="max-w-[18px] flex-1 rounded-t bg-brand/80"
                      style={{ height: `${Math.max(4, (point.revenue / peak) * 96)}px` }}
                    />
                  ))}
                </div>
                <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
                  <span>{chart[0]?.bucket}</span>
                  <span>{chart[chart.length - 1]?.bucket}</span>
                </div>
              </>
            )}
          </Section>

          <Section title="Order pipeline">
            {pipelineTotal === 0 ? (
              <p className="text-[12px] text-muted-foreground">No orders in this window.</p>
            ) : (
              <div className="space-y-1.5">
                {PIPELINE.map((stage) => {
                  const count = overview.status.find((row) => row.status === stage.value)?.count ?? 0;
                  return (
                    <div key={stage.value} className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${stage.color}`} />
                      <span className="w-[76px] text-[12px] text-black">{stage.label}</span>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-100">
                        <div className={`h-full ${stage.color}`} style={{ width: `${(count / pipelineTotal) * 100}%` }} />
                      </div>
                      <span className="w-6 text-right text-[12px] text-black">{count}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </Section>

          <Section title="Payment mix">
            {overview.payments.length === 0 ? (
              <p className="text-[12px] text-muted-foreground">No payments in this window.</p>
            ) : (
              <dl className="space-y-1 text-[12px]">
                {overview.payments.map((row) => (
                  <div key={row.status} className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">{PAYMENT_LABELS[row.status] ?? row.status}</dt>
                    <dd className="text-black">{row.count} · {formatUgx(row.amount)}</dd>
                  </div>
                ))}
              </dl>
            )}
          </Section>

          <Section title="Top products">
            {topProducts.length === 0 ? (
              <p className="text-[12px] text-muted-foreground">Nothing sold in this window.</p>
            ) : (
              <div className="space-y-1.5">
                {topProducts.map((product) => (
                  <div key={product.productId}>
                    <div className="flex justify-between gap-2 text-[12px]">
                      <span className="truncate text-black">{product.name}</span>
                      <span className="shrink-0 text-muted-foreground">{product.units} {product.unit}</span>
                    </div>
                    <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-neutral-100">
                      <div
                        className="h-full bg-brand"
                        style={{ width: `${(product.revenue / productPeak) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section title="Regional demand">
            {regions.length === 0 ? (
              <p className="text-[12px] text-muted-foreground">No deliveries in this window.</p>
            ) : (
              <dl className="space-y-1 text-[12px]">
                {regions.slice(0, 5).map((row) => (
                  <div key={`${row.region}-${row.district ?? ''}`} className="flex justify-between gap-2"> <dt className="truncate text-muted-foreground">{row.region}{row.district ? ` · ${row.district}` : ''}</dt>
                    <dd className="shrink-0 text-black">
                      {row.orders} order{row.orders === 1 ? '' : 's'} · {formatUgx(row.revenue)}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </Section>

          <Section title="Restock soon">
            {restock.length === 0 ? (
              <p className="text-[12px] text-muted-foreground">Every product covers more than 10 days.</p>
            ) : (
              <dl className="space-y-1 text-[12px]">
                {restock.map((row) => (
                  <div key={row.productId} className="flex justify-between gap-2">
                    <dt className="truncate text-muted-foreground">{row.name}</dt>
                    <dd className="shrink-0 text-black">
                      {row.daysOfCover} days · {row.stock} {row.unit} left
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </Section>

          <Section title="Promo redemptions">
            {overview.promos.length === 0 ? (
              <p className="text-[12px] text-muted-foreground">No codes redeemed in this window.</p>
            ) : (
              <dl className="space-y-1 text-[12px]">
                {overview.promos.map((promo) => (
                  <div key={promo.code} className="flex justify-between gap-2">
                    <dt className="text-black">{promo.code}</dt>
                    <dd className="text-muted-foreground">{promo.uses} uses · {formatUgx(promo.discount)}</dd>
                  </div>
                ))}
              </dl>
            )}
          </Section>

          <div className="flex flex-wrap gap-2 pt-1">
            {(['sales', 'products', 'regions'] as const).map((source) => (
              <a
                key={source}
                href={analyticsExportUrl(source, { from })}
                className="rounded-lg border border-neutral-200 px-2.5 py-1.5 text-[11px] text-brand"
              >
                Download {source}.csv
              </a>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-3">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="text-[16px] font-medium text-black">{value}</p>
      <p className="text-[10px] text-muted-foreground">{note}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-3">
      <p className="mb-2 text-[12px] font-medium text-black">{title}</p>
      {children}
    </div>
  );
}

/* ---------------- Activity Log ---------------- */

function ActivityPanel({ fail }: { fail: (m: string) => void }) {
  const [logs, setLogs] = useState<ActivityLogRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const result = await listActivityLog({ limit: 50 });
    setLoading(false);
    if (!result) return fail('Could not reach the service.');
    if (!result.ok) return fail(result.error);
    setLogs(result.data.data);
  }, [fail]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-3">
      <SectionTitle size="small" family="label">Activity log</SectionTitle>
      {loading ? (
        <p className="text-[13px] text-muted-foreground py-4 text-center">Loading…</p>
      ) : logs.length === 0 ? (
        <p className="text-[13px] text-muted-foreground py-4 text-center">No activity yet.</p>
      ) : (
        <table className="w-full text-left border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-neutral-200">
              <th className="pb-2 text-muted-foreground">When</th>
              <th className="pb-2 text-muted-foreground">Admin</th>
              <th className="pb-2 text-muted-foreground">Action</th>
              <th className="pb-2 text-muted-foreground">Entity</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id} className="border-b border-neutral-100">
                <td className="py-2">{new Date(l.createdAt).toLocaleString()}</td>
                <td className="py-2">{l.adminEmail ?? '—'}</td>
                <td className="py-2">{l.action}</td>
                <td className="py-2">{l.entity ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* ---------------- Customers ---------------- */

function CustomersPanel({ flash, fail }: { flash: (m: string) => void; fail: (m: string) => void }) {
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    const result = await listCustomers({ q: q || undefined, active: true, limit: 50 });
    setLoading(false);
    if (!result) return fail('Could not reach the service.');
    if (!result.ok) return fail(result.error);
    setCustomers(result.data.data);
  }, [fail, q]);

  useEffect(() => { load(); }, [load]);

  const handleDeactivate = async (c: CustomerRow) => {
    if (!window.confirm(`Deactivate ${c.fullName}?`)) return;
    const result = await deactivateCustomer(c.id);
    if (!result) return fail('Could not reach the service.');
    if (!result.ok) return fail(result.error);
    flash('Deactivated.');
    await load();
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name or phone"
          className="flex-1 border border-neutral-200 rounded-lg px-3 py-2 text-[13px]"
        />
      </div>
      {loading ? (
        <p className="text-[13px] text-muted-foreground py-4 text-center">Loading…</p>
      ) : customers.length === 0 ? (
        <p className="text-[13px] text-muted-foreground py-4 text-center">No customers.</p>
      ) : (
        <table className="w-full text-left border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-neutral-200">
              <th className="pb-2 text-muted-foreground">Name</th>
              <th className="pb-2 text-muted-foreground">Phone</th>
              <th className="pb-2 text-muted-foreground">Region</th>
              <th className="pb-2 text-muted-foreground text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {customers.map((c) => (
              <tr key={c.id} className="border-b border-neutral-100">
                <td className="py-2">{c.fullName}</td>
                <td className="py-2">{c.phone}</td>
                <td className="py-2">{c.region ?? '—'}</td>
                <td className="py-2 text-right">
                  <button
                    onClick={() => handleDeactivate(c)}
                    className="text-[12px] text-red-600 underline underline-offset-2"
                  >
                    Deactivate
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* ---------------- Admins (owner and above) ---------------- */

const ADMIN_ROLE_LABELS: Record<AdminRole, string> = {
  super: 'Super admin',
  owner: 'Market owner',
  manager: 'Manager',
  staff: 'Shop assistant',
};

const ADMIN_ROLE_HINTS: Record<AdminRole, string> = {
  super: 'The platform itself: every market, every permission, and the right to open a new market.',
  owner: 'Everything in one market, including its accounts and customer access.',
  manager: 'Catalogue, stock, orders, promos and suppliers.',
  staff: 'Fulfil orders only.',
};

/**
 * Which roles the signed-in account is allowed to hand out.
 *
 * `super` is missing unless the caller is one: a market owner who could appoint
 * a platform admin would be choosing who outranks them.
 */
function assignableRoles(callerIsSuper: boolean): AdminRole[] {
  return callerIsSuper
    ? ['super', 'owner', 'manager', 'staff']
    : ['owner', 'manager', 'staff'];
}

/**
 * A row whose stored role the caller cannot grant is still shown, so that a
 * drifted account is visible rather than silently renamed by the select.
 */
function roleOptionsFor(callerIsSuper: boolean, current: AdminRole): AdminRole[] {
  const options = assignableRoles(callerIsSuper);
  return options.includes(current) ? options : [...options, current];
}

function AdminsPanel({
  admin,
  markets,
  flash,
  fail,
}: {
  admin: AdminIdentity;
  markets: MarketRow[];
  flash: (m: string) => void;
  fail: (m: string) => void;
}) {
  // A platform account names the market an account belongs to. A market owner
  // sees only their own team and is never offered the choice. A super admin is
  // the platform, and is the only caller that may create one of itself.
  const asPlatform = admin.marketId == null;
  const asSuper = asPlatform && admin.role === 'super';
  const roleChoices = assignableRoles(asSuper);
  const marketLabel = (id: number | null | undefined) =>
    id == null ? 'All markets' : (markets.find((item) => item.id === id)?.name ?? `Market ${id}`);
  const [accounts, setAccounts] = useState<AdminAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingId, setPendingId] = useState<number | null>(null);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<AdminRole>('staff');
  const [marketId, setMarketId] = useState('');
  const [password, setPassword] = useState('');
  const [creating, setCreating] = useState(false);

  const [resetFor, setResetFor] = useState<number | null>(null);
  const [resetPassword, setResetPassword] = useState('');

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const result = await listAdmins();
    setLoading(false);
    if (!result) return fail('Could not reach the service.');
    if (!result.ok) return fail(result.error);
    setAccounts(result.data);
  }, [fail]);

  useEffect(() => {
    load();
  }, [load]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const result = await changePassword(current, next);
    setBusy(false);
    if (!result) return fail('Could not reach the service.');
    if (!result.ok) return fail(result.error);
    setCurrent(''); setNext('');
    flash('Password changed.');
  };

  const addAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    // A super admin holds no market and every role below one must hold one, so
    // the market answer is either forced empty or insisted on here rather than
    // left for the server to explain after the button has been pressed.
    if (role === 'super') {
      setMarketId('');
    } else if (asPlatform && marketId === '') {
      fail('Choose which market this account runs. Only a super admin holds none.');
      return;
    }
    setCreating(true);
    const result = await createAdmin({
      name: name.trim(),
      email: email.trim(),
      role,
      password,
      ...(asPlatform ? { marketId: role === 'super' ? null : Number(marketId) } : {}),
    });
    setCreating(false);
    if (!result) return fail('Could not reach the service.');
    if (!result.ok) return fail(result.error);
    setName(''); setEmail(''); setRole('staff'); setPassword(''); setMarketId('');
    flash(`${result.data.name} can now sign in.`);
    await load();
  };

  const change = async (
    account: AdminAccount,
    patch: {
      role?: AdminRole;
      active?: boolean;
      password?: string;
      revokeSessions?: boolean;
      marketId?: number | null;
    },
  ) => {
    setPendingId(account.id);
    const result = await updateAdmin(account.id, patch);
    setPendingId(null);
    // Reload either way: a refused change (self-demotion, last owner) must not
    // leave the select showing a role the server did not accept.
    await load();
    if (!result) return fail('Could not reach the service.');
    if (!result.ok) return fail(result.error);
    setResetFor(null);
    setResetPassword('');
    flash(`Updated ${result.data.name}.`);
  };

  return (
    <div className="space-y-4">
      <div>
        <SectionTitle size="small" family="label">Staff accounts</SectionTitle>
        <p className="text-[11px] font-normal text-muted-foreground">
          A super admin runs the platform and opens markets. An owner runs one market, including its
          accounts. Managers run the shop. Shop assistants only move orders. An account pinned to a
          market cannot see another market's data.
        </p>
      </div>

      {loading ? (
        <p className="text-[12px] font-normal text-muted-foreground">Loading accounts…</p>
      ) : (
        <div className="space-y-2">
          {accounts.map((account) => {
            const self = account.id === admin.id;
            const pending = pendingId === account.id;
            return (
              <div
                key={account.id}
                className="space-y-2 rounded-xl border border-neutral-200 bg-white p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium text-black">
                      {account.name}
                      {self ? ' (you)' : ''}
                    </p>
                    <p className="truncate text-[11px] font-normal text-muted-foreground">
                      {account.email}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-medium text-neutral-600">
                      {marketLabel(account.marketId)}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        account.active ? 'bg-brand/10 text-brand' : 'bg-neutral-100 text-neutral-500'
                      }`}
                    >
                      {account.active ? 'Active' : 'Disabled'}
                    </span>
                  </div>
                </div>

                <p className="text-[11px] font-normal text-muted-foreground"> {account.activeSessions} open session{account.activeSessions === 1 ? '' : 's'} ·{' '}
                  {account.lastLoginAt
                    ? `last sign-in ${account.lastLoginAt.slice(0, 16)}`
                    : 'never signed in'}
                </p>

                <div className="flex flex-wrap items-center gap-1.5">
                  {asPlatform && (
                    <select
                      value={account.marketId == null ? '' : String(account.marketId)}
                      disabled={pending}
                      onChange={(e) =>
                        change(account, {
                          marketId: e.target.value === '' ? null : Number(e.target.value),
                        })
                      }
                      title="Which market this account works in"
                      className="rounded-lg border border-neutral-200 bg-white px-2 py-1 text-[11px] font-medium disabled:bg-neutral-100 disabled:text-neutral-400"
                    >
                      <option value="">All markets</option>
                      {markets.map((item) => (
                        <option key={item.id} value={String(item.id)}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  )}

                  <select
                    value={account.role}
                    disabled={self || pending}
                    onChange={(e) => {
                      const chosen = e.target.value as AdminRole;
                      // Promoting to super has to detach the market in the same
                      // request, or the server refuses the contradictory row.
                      change(
                        account,
                        chosen === 'super' ? { role: chosen, marketId: null } : { role: chosen },
                      );
                    }}
                    title={ADMIN_ROLE_HINTS[account.role]}
                    className="rounded-lg border border-neutral-200 bg-white px-2 py-1 text-[11px] font-medium disabled:bg-neutral-100 disabled:text-neutral-400"
                  >
                    {roleOptionsFor(asSuper, account.role).map((value) => (
                      <option key={value} value={value}>
                        {ADMIN_ROLE_LABELS[value]}
                      </option>
                    ))}
                  </select>

                  {account.active ? (
                    <button
                      type="button"
                      disabled={self || pending}
                      onClick={() => change(account, { active: false })}
                      className="rounded-lg border border-neutral-200 px-2 py-1 text-[11px] font-medium text-red-600 disabled:text-neutral-300"
                    >
                      Disable
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => change(account, { active: true })}
                      className="rounded-lg border border-neutral-200 px-2 py-1 text-[11px] font-medium text-brand disabled:text-neutral-300"
                    >
                      Enable
                    </button>
                  )}

                  <button
                    type="button"
                    disabled={pending || account.activeSessions === 0}
                    onClick={() => change(account, { revokeSessions: true })}
                    className="rounded-lg border border-neutral-200 px-2 py-1 text-[11px] font-medium text-black disabled:text-neutral-300"
                  >
                    Sign out everywhere
                  </button>

                  {!self && (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => {
                        setResetFor(resetFor === account.id ? null : account.id);
                        setResetPassword('');
                      }}
                      className="rounded-lg border border-neutral-200 px-2 py-1 text-[11px] font-medium text-black disabled:text-neutral-300"
                    >
                      Set password
                    </button>
                  )}
                </div>

                {resetFor === account.id && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      change(account, { password: resetPassword });
                    }}
                    className="flex gap-2"
                  >
                    <input
                      type="password"
                      value={resetPassword}
                      onChange={(e) => setResetPassword(e.target.value)}
                      placeholder="New password (min 10)"
                      className="w-full rounded-lg border border-neutral-200 px-2 py-1 text-[12px]"
                    />
                    <button
                      type="submit"
                      disabled={resetPassword.length < 10 || pending}
                      className={`shrink-0 rounded-lg px-2 py-1 text-[11px] text-white ${
                        resetPassword.length < 10 || pending
                          ? 'bg-neutral-300'
                          : 'bg-brand'
                      }`}
                    >
                      Save
                    </button>
                  </form>
                )}
              </div>
            );
          })}
        </div>
      )}

      <form onSubmit={addAccount} className="space-y-2 rounded-xl border border-neutral-200 bg-white p-3">
        <p className="text-[13px] font-medium text-black">
          Add a staff account
        </p>
        <Field label="Full name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="border border-neutral-200 rounded-lg px-3 py-2 text-[13px] w-full"
          />
        </Field>
        <Field label="Email">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="border border-neutral-200 rounded-lg px-3 py-2 text-[13px] w-full"
          />
        </Field>
        <Field label="Role">
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as AdminRole)}
            className="border border-neutral-200 rounded-lg px-3 py-2 text-[13px] w-full bg-white"
          >
            {roleChoices.map((value) => (
              <option key={value} value={value}>
                {ADMIN_ROLE_LABELS[value]}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[10px] font-normal text-muted-foreground">
            {ADMIN_ROLE_HINTS[role]}
          </p>
        </Field>
        {asPlatform && role === 'super' && (
          <p className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-[11px] font-normal text-muted-foreground">
            A super admin belongs to no market: it works across all of them, which is why no market
            is chosen here.
          </p>
        )}
        {asPlatform && role !== 'super' && (
          <Field label="Market">
            <select
              value={marketId}
              onChange={(e) => setMarketId(e.target.value)}
              className="border border-neutral-200 rounded-lg px-3 py-2 text-[13px] w-full bg-white"
            >
              <option value="">Choose a market</option>
              {markets.map((item) => (
                <option key={item.id} value={String(item.id)}>
                  {item.name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[10px] font-normal text-muted-foreground">
              Pinning somebody to a market is what limits them to it. Only a super admin runs the
              whole platform, and only a super admin may be left without a market.
            </p>
          </Field>
        )}
        <Field label="Temporary password (min 10)">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="border border-neutral-200 rounded-lg px-3 py-2 text-[13px] w-full"
          />
        </Field>
        <button
          type="submit"
          disabled={creating || !name.trim() || !email.trim() || password.length < 10}
          className={`w-full rounded-lg py-2.5 text-[13px] text-white ${
            creating || !name.trim() || !email.trim() || password.length < 10
              ? 'bg-neutral-300 cursor-not-allowed'
              : 'bg-brand'
          }`}
        >
          {creating ? 'Creating…' : 'Create account'}
        </button>
        <p className="text-[10px] font-normal text-muted-foreground">
          Share the temporary password in person. They can change it after signing in.
        </p>
      </form>

      <form onSubmit={submit} className="space-y-2">
        <SectionTitle size="small" family="label">Change your password</SectionTitle>
        <Field label="Current password">
          <input
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            className="border border-neutral-200 rounded-lg px-3 py-2 text-[13px] w-full"
          />
        </Field>
        <Field label="New password (min 10)">
          <input
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            className="border border-neutral-200 rounded-lg px-3 py-2 text-[13px] w-full"
          />
        </Field>
        <button
          type="submit"
          disabled={busy || !current || !next}
          className={`w-full rounded-lg py-2.5 text-[13px] text-white ${busy || !current || !next ? 'bg-neutral-300 cursor-not-allowed' : 'bg-brand'}`}
        >
          {busy ? 'Changing…' : 'Change password'}
        </button>
      </form>
    </div>
  );
}
