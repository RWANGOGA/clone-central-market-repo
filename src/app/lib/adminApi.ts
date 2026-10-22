const BASE = '/api/admin';

/**
 * Client for the staff endpoints. The session lives in an HttpOnly cookie the
 * browser attaches on its own, so there is no token for this code to hold or
 * leak. Every call sets credentials: 'include' because the API may sit on
 * another origin in production.
 */

export type AdminRole = 'owner' | 'manager' | 'staff';

export type AdminIdentity = {
  id: number;
  email: string;
  name: string;
  role: AdminRole;
};

export type AdminProduct = {
  id: number;
  slug: string;
  name: string;
  description: string;
  farm: string;
  location: string;
  priceValue: number;
  price: string;
  currency: string;
  unit: string;
  stock: number;
  stockState: string;
  remaining: string;
  dietary: string[];
  images: string[];
  active: boolean;
  createdAt: string;
  lowStockThreshold?: number | null;
  reorderQuantity?: number | null;
  supplierId?: number | null;
};

export type ProductDraft = {
  name: string;
  slug?: string;
  description: string;
  farm: string;
  location: string;
  priceValue: number;
  unit: string;
  stock: number;
  dietary: string[];
  imageDataUrl?: string;
};

type Result<T> = { ok: true; data: T } | { ok: false; error: string; status: number } | null;

/** Sends a request to the staff API and hands back the body untouched. */
async function request(path: string, init?: RequestInit) {
  try {
    const response = await fetch(`${BASE}${path}`, {
      ...init,
      credentials: 'include',
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    });

    if (response.status === 401) return { ok: false as const, error: 'Session expired.', status: 401 };

    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const error =
        (body as { error?: string } | null)?.error ?? `Request failed (${response.status})`;
      return { ok: false as const, error, status: response.status };
    }

    return { ok: true as const, body };
  } catch {
    return null;
  }
}

/**
 * Endpoints that answer `{ data, meta }` where the caller only wants the
 * payload: unwrap one level here so no component has to reach through it.
 */
async function call<T>(path: string, init?: RequestInit): Promise<Result<T>> {
  const result = await request(path, init);
  if (!result) return null;
  if (!result.ok) return result;
  return { ok: true, data: (result.body as { data: T }).data };
}

/**
 * Paged endpoints answer `{ data, meta }` and the component needs the totals as
 * well as the rows, so the envelope stays whole. Unwrapping these is what made
 * `result.data.data` undefined and blanked the staff console: the types promised
 * an envelope while `call` had already stripped it away.
 */
async function callEnvelope<T>(path: string, init?: RequestInit): Promise<Result<T>> {
  const result = await request(path, init);
  if (!result) return null;
  if (!result.ok) return result;
  return { ok: true, data: result.body as T };
}

export async function signIn(email: string, password: string): Promise<Result<AdminIdentity>> {
  const result = await call<{ admin: AdminIdentity }>('/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  if (!result) return null;
  if (!result.ok) return result;
  return { ok: true, data: result.data.admin };
}

export async function signOut(): Promise<void> {
  await call('/logout', { method: 'POST' });
}

/** Null means "not signed in", which is different from "the check failed". */
export async function currentAdmin(): Promise<AdminIdentity | null | undefined> {
  try {
    const response = await fetch(`${BASE}/me`, { credentials: 'include' });
    if (response.status === 401) return null;
    if (!response.ok) return undefined;
    const body = (await response.json()) as { data: AdminIdentity };
    return body.data;
  } catch {
    return undefined;
  }
}

export async function listAdminProducts(): Promise<Result<AdminProduct[]>> {
  return call<AdminProduct[]>('/products');
}

export async function createProduct(draft: ProductDraft): Promise<Result<AdminProduct>> {
  return call<AdminProduct>('/products', { method: 'POST', body: JSON.stringify(draft) });
}

export async function updateProduct(
  id: number | string,
  changes: Partial<ProductDraft> & { active?: boolean },
): Promise<Result<AdminProduct>> {
  return call<AdminProduct>(`/products/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(changes),
  });
}

/** Withdraws rather than deletes, so past orders keep referring to the row. */
export async function withdrawProduct(id: number | string): Promise<Result<AdminProduct>> {
  return call<AdminProduct>(`/products/${id}`, { method: 'DELETE' });
}

/** Read a picked file into a data URL for the API to store. */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('That file could not be read.'));
    reader.readAsDataURL(file);
  });
}

/* ---------- Inventory ---------- */

export type StockMovementRow = {
  id: number;
  productId: number;
  productName: string | null;
  productSlug: string | null;
  unit: string | null;
  delta: number;
  reason: string;
  reference: string | null;
  note: string | null;
  actorLabel: string | null;
  actorEmail: string | null;
  createdAt: string;
};

export type InventoryMovementsResult = {
  data: StockMovementRow[];
  meta: {
    total: number;
    net: number;
    limit: number;
    offset: number;
    returned: number;
    reasons: string[];
  };
};

export type InventoryAdjustment = {
  delta: number;
  reason: 'adjustment' | 'waste' | 'return' | 'correction' | 'delivery';
  note?: string;
};

export type AdjustmentResult = {
  id: number;
  slug: string;
  name: string;
  stock: number;
  previous: number;
  delta: number;
  unit: string;
  state: string;
  remaining: string;
  threshold: number;
  lowStockThreshold: number | null;
  reorderQuantity: number | null;
  supplierId: number | null;
};

export type LowStockItem = {
  id: number;
  slug: string;
  name: string;
  stock: number;
  unit: string;
  price: string;
  threshold: number;
  reorderQuantity: number | null;
  ratio: number;
};

export type ReconciliationResult = {
  data: {
    lowStock: LowStockItem[];
    reconciliation: { id: number; name: string; slug: string; stock_column: number; ledger_total: number; drift: number }[];
  };
  meta: {
    lowStockCount: number;
    unreconciledCount: number;
    healthy: boolean;
  };
};

export async function listInventoryMovements(
  filters?: {
    productId?: number;
    reason?: string;
    reference?: string;
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
  },
): Promise<Result<InventoryMovementsResult>> {
  const params = new URLSearchParams();
  if (filters?.productId) params.set('productId', String(filters.productId));
  if (filters?.reason) params.set('reason', filters.reason);
  if (filters?.reference) params.set('reference', filters.reference);
  if (filters?.from) params.set('from', filters.from);
  if (filters?.to) params.set('to', filters.to);
  if (filters?.limit !== undefined) params.set('limit', String(filters.limit));
  if (filters?.offset !== undefined) params.set('offset', String(filters.offset));
  const qs = params.toString();
  return callEnvelope<InventoryMovementsResult>(`/inventory/movements${qs ? `?${qs}` : ''}`);
}

export async function adjustInventory(
  id: number | string,
  adjustment: InventoryAdjustment,
): Promise<Result<AdjustmentResult>> {
  return call<AdjustmentResult>(`/inventory/products/${encodeURIComponent(String(id))}`, {
    method: 'PATCH',
    body: JSON.stringify(adjustment),
  });
}

export async function reconciliation(): Promise<Result<ReconciliationResult>> {
  return callEnvelope<ReconciliationResult>('/inventory/reconciliation');
}

/* ---------- Purchase Orders ---------- */

export type PurchaseOrderRow = {
  id: number;
  reference: string;
  supplierId: number;
  status: 'draft' | 'sent' | 'received' | 'cancelled';
  expectedAt: string | null;
  receivedAt: string | null;
  note: string | null;
  createdByAdminId: number | null;
  createdAt: string;
};

export type PurchaseOrderLine = {
  id: number;
  purchaseOrderId: number;
  productId: number;
  productName?: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  receivedQuantity: number | null;
};

export type PurchaseOrderDetail = PurchaseOrderRow & {
  items: PurchaseOrderLine[];
};

export type PurchaseOrderListResult = {
  data: PurchaseOrderRow[];
  meta: { total: number };
};

export type CreatePurchaseOrderInput = {
  supplierId: number;
  expectedAt?: string;
  note?: string;
  items: { productId: number; quantity: number; unitPrice: number }[];
};

/**
 * The queue of purchase orders. Asking for one order by id answers with a
 * different envelope (the order with its lines), so it is not exposed here; no
 * screen reads a single purchase order.
 */
export async function listPurchaseOrders(
  filters?: { status?: string },
): Promise<Result<PurchaseOrderListResult>> {
  const params = new URLSearchParams();
  if (filters?.status) params.set('status', filters.status);
  const qs = params.toString();
  return callEnvelope<PurchaseOrderListResult>(`/purchase-orders${qs ? `?${qs}` : ''}`);
}

export async function createPurchaseOrder(
  input: CreatePurchaseOrderInput,
): Promise<Result<{ reference: string; status: string }>> {
  return call<{ reference: string; status: string }>('/purchase-orders', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function cancelPurchaseOrder(id: number | string): Promise<Result<{ reference: string; status: string }>> {
  return call<{ reference: string; status: string }>(`/purchase-orders/${encodeURIComponent(String(id))}/cancel`, {
    method: 'PATCH',
  });
}

export async function receivePurchaseOrder(id: number | string): Promise<Result<unknown>> {
  return call<unknown>(`/purchase-orders/${encodeURIComponent(String(id))}/receive`, {
    method: 'POST',
  });
}

/* ---------- Suppliers ---------- */

export type SupplierRow = {
  id: number;
  name: string;
  contactName: string | null;
  phone: string | null;
  district: string | null;
  region: string | null;
  active: boolean;
  createdAt: string;
  productCount?: number;
};

export type SupplierListResult = {
  data: SupplierRow[];
  meta: { total: number };
};

export type CreateSupplierInput = {
  name: string;
  contactName?: string;
  phone?: string;
  district?: string;
  region?: string;
};

export async function listSuppliers(): Promise<Result<SupplierListResult>> {
  return callEnvelope<SupplierListResult>('/suppliers');
}

export async function createSupplier(input: CreateSupplierInput): Promise<Result<SupplierRow>> {
  return call<SupplierRow>('/suppliers', { method: 'POST', body: JSON.stringify(input) });
}

/* ---------- Promo codes ---------- */

export type AdminPromo = {
  id: number;
  code: string;
  description: string;
  kind: 'percent' | 'fixed';
  value: number;
  minSubtotal: number;
  maxDiscount: number | null;
  active: boolean;
  startsAt: string | null;
  endsAt: string | null;
  usageLimit: number | null;
  usedCount: number;
  perCustomerLimit: number | null;
  createdAt: string;
  state: 'live' | 'scheduled' | 'paused' | 'expired' | 'exhausted';
};

export type PromoDraft = {
  code: string;
  description?: string;
  kind: 'percent' | 'fixed';
  value: number;
  minSubtotal?: number;
  maxDiscount?: number | null;
  usageLimit?: number | null;
  perCustomerLimit?: number | null;
  endsAt?: string | null;
};

export async function listPromos(): Promise<Result<AdminPromo[]>> {
  return call<AdminPromo[]>('/promos');
}

export async function createPromo(draft: PromoDraft): Promise<Result<AdminPromo>> {
  return call<AdminPromo>('/promos', { method: 'POST', body: JSON.stringify(draft) });
}

export async function setPromoActive(id: number, active: boolean): Promise<Result<AdminPromo>> {
  return call<AdminPromo>(`/promos/${id}`, { method: 'PATCH', body: JSON.stringify({ active }) });
}

/* ---------- Analytics ---------- */

export type AnalyticsOverview = {
  totals: {
    orders: number;
    units: number;
    revenue: number;
    discounts: number;
    averageOrderValue: number;
  };
  status: { status: string; count: number }[];
  payments: { status: string; count: number; amount: number }[];
  promos: { code: string; uses: number; discount: number }[];
  inventory: { activeProducts: number; lowStock: number; outOfStock: number };
  newCustomers: number;
};

export type AnalyticsRange = { from?: string; to?: string };

export async function getAnalyticsOverview(
  filters?: AnalyticsRange,
): Promise<Result<AnalyticsOverview>> {
  const params = new URLSearchParams();
  if (filters?.from) params.set('from', filters.from);
  if (filters?.to) params.set('to', filters.to);
  const qs = params.toString();
  return call<AnalyticsOverview>(`/analytics/overview${qs ? `?${qs}` : ''}`);
}

export type ExportSource = 'sales' | 'products' | 'regions' | 'activity';

/** A plain link the browser downloads with the session cookie attached. */
export function analyticsExportUrl(source: ExportSource, filters?: AnalyticsRange): string {
  const params = new URLSearchParams({ source });
  if (filters?.from) params.set('from', filters.from);
  if (filters?.to) params.set('to', filters.to);
  return `${BASE}/analytics/export?${params.toString()}`;
}

export type SalesTrendPoint = {
  bucket: string;
  orders: number;
  revenue: number;
  units: number;
};

export type ProductPerformanceRow = {
  productId: number;
  name: string;
  unit: string;
  orders: number;
  units: number;
  revenue: number;
};

export type RegionalDemandRow = {
  region: string;
  district: string | null;
  orders: number;
  revenue: number;
  units: number;
};

export type ForecastResult = {
  trailing: {
    revenue7d: number;
    revenue30d: number;
    dailyAverage7d: number;
    dailyAverage30d: number;
  };
  inventory: {
    productId: number;
    name: string;
    unit: string;
    stock: number;
    threshold: number;
    sold30d: number;
    dailyAverage: number;
    daysOfCover: number | null;
  }[];
};

export async function listSalesTrend(
  filters?: { from?: string; to?: string; bucket?: 'day' | 'week' | 'month'; limit?: number },
): Promise<Result<SalesTrendPoint[]>> {
  const params = new URLSearchParams();
  if (filters?.from) params.set('from', filters.from);
  if (filters?.to) params.set('to', filters.to);
  if (filters?.bucket) params.set('bucket', filters.bucket);
  if (filters?.limit !== undefined) params.set('limit', String(filters.limit));
  const qs = params.toString();
  return call<SalesTrendPoint[]>(`/analytics/sales${qs ? `?${qs}` : ''}`);
}

export async function listProductPerformance(
  filters?: { from?: string; to?: string; limit?: number },
): Promise<Result<ProductPerformanceRow[]>> {
  const params = new URLSearchParams();
  if (filters?.from) params.set('from', filters.from);
  if (filters?.to) params.set('to', filters.to);
  if (filters?.limit !== undefined) params.set('limit', String(filters.limit));
  const qs = params.toString();
  return call<ProductPerformanceRow[]>(`/analytics/products${qs ? `?${qs}` : ''}`);
}

export async function listRegionalDemand(
  filters?: { from?: string; to?: string },
): Promise<Result<RegionalDemandRow[]>> {
  const params = new URLSearchParams();
  if (filters?.from) params.set('from', filters.from);
  if (filters?.to) params.set('to', filters.to);
  const qs = params.toString();
  return call<RegionalDemandRow[]>(`/analytics/regions${qs ? `?${qs}` : ''}`);
}

export async function getForecast(): Promise<Result<ForecastResult>> {
  return call<ForecastResult>('/analytics/forecast');
}

/* ---------- Activity Log ---------- */

export type ActivityLogRow = {
  id: number;
  action: string;
  entity: string;
  entityId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  adminEmail: string | null;
  createdAt: string;
};

export type ActivityLogResult = {
  data: ActivityLogRow[];
  meta: { total: number; adminId?: number; action?: string; entity?: string; from?: string; to?: string; limit: number; offset: number };
};

export async function listActivityLog(
  filters?: {
    adminId?: number;
    action?: string;
    entity?: string;
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
  },
): Promise<Result<ActivityLogResult>> {
  const params = new URLSearchParams();
  if (filters?.adminId !== undefined) params.set('adminId', String(filters.adminId));
  if (filters?.action) params.set('action', filters.action);
  if (filters?.entity) params.set('entity', filters.entity);
  if (filters?.from) params.set('from', filters.from);
  if (filters?.to) params.set('to', filters.to);
  if (filters?.limit !== undefined) params.set('limit', String(filters.limit));
  if (filters?.offset !== undefined) params.set('offset', String(filters.offset));
  const qs = params.toString();
  return callEnvelope<ActivityLogResult>(`/analytics/activity${qs ? `?${qs}` : ''}`);
}

/* ---------- Customers ---------- */

export type CustomerRow = {
  id: number;
  fullName: string;
  phone: string;
  email: string | null;
  region: string;
  district: string | null;
  active: boolean;
  createdAt: string;
};

export type CustomerListResult = {
  data: CustomerRow[];
  meta: { total: number; limit: number; offset: number; returned: number };
};

export async function listCustomers(
  filters?: { q?: string; active?: boolean; limit?: number; offset?: number },
): Promise<Result<CustomerListResult>> {
  const params = new URLSearchParams();
  if (filters?.q) params.set('q', filters.q);
  if (filters?.active !== undefined) params.set('active', String(filters.active));
  if (filters?.limit !== undefined) params.set('limit', String(filters.limit));
  if (filters?.offset !== undefined) params.set('offset', String(filters.offset));
  const qs = params.toString();
  return callEnvelope<CustomerListResult>(`/customers${qs ? `?${qs}` : ''}`);
}

export async function deactivateCustomer(id: number | string): Promise<Result<{ id: number; fullName: string; phone: string; active: boolean }>> {
  return call<{ id: number; fullName: string; phone: string; active: boolean }>(`/customers/${encodeURIComponent(String(id))}/deactivate`, {
    method: 'PATCH',
  });
}

/* ---------- Admin password ---------- */

export async function changePassword(currentPassword: string, newPassword: string): Promise<Result<{ id: number; email: string; name: string; role: string }>> {
  return call<{ id: number; email: string; name: string; role: string }>('/password', {
    method: 'PATCH',
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}

/* ---------- Staff accounts (owner only) ---------- */

export type AdminAccount = {
  id: number;
  name: string;
  email: string;
  role: AdminRole;
  active: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  activeSessions: number;
};

export type AdminDraft = {
  name: string;
  email: string;
  role: AdminRole;
  password: string;
};

export type AdminChange = {
  name?: string;
  role?: AdminRole;
  active?: boolean;
  password?: string;
  revokeSessions?: boolean;
};

export async function listAdmins(): Promise<Result<AdminAccount[]>> {
  return call<AdminAccount[]>('/admins');
}

export async function createAdmin(draft: AdminDraft): Promise<Result<AdminAccount>> {
  return call<AdminAccount>('/admins', { method: 'POST', body: JSON.stringify(draft) });
}

/** The server refuses self-demotion, self-deactivation and removing the last owner. */
export async function updateAdmin(
  id: number,
  change: AdminChange,
): Promise<Result<AdminAccount>> {
  return call<AdminAccount>(`/admins/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(change),
  });
}

