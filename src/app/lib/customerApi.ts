import { triggerUnauthorized } from './apiAuth';
import { apiUrl } from './apiBase';

const API_BASE = apiUrl('/api');

export interface CustomerProfile {
  id: number;
  fullName: string;
  phone: string;
  email?: string;
  region: string;
  district?: string;
  subCounty?: string;
  parish?: string;
  village?: string;
  address: string;
  createdAt: string;
  orderCount: number;
  lastOrderAt?: string;
}

/**
 * What the Details tab may send.
 *
 * The profile endpoint takes a strict schema, so this list has to match it
 * exactly: the form once posted a field the server did not declare and every
 * save was rejected.
 */
export type CustomerProfileUpdate = {
  fullName?: string;
  /** The sign-in number. Changing it changes how the customer logs in. */
  phone?: string;
  email?: string | null;
  region?: string;
  district?: string | null;
  subCounty?: string | null;
  parish?: string | null;
  village?: string | null;
  address?: string;
};

export interface CustomerOrder {
  id: number;
  reference: string;
  status: string;
  total: number;
  currency: string;
  createdAt: string;
  updatedAt: string;
  region?: string;
  district?: string;
  shippingAddress?: {
    fullName: string;
    phone: string;
    address: string;
    region: string;
    district?: string;
    subCounty?: string;
    parish?: string;
    village?: string;
  };
  items: {
    id: number;
    productId: number;
    name: string;
    priceValue: number;
    quantity: number;
    lineTotal: number;
  }[];
  timeline: OrderTimelineEvent[];
  payments: OrderPaymentSummary[];
}

export interface CustomerOrdersResult {
  data: CustomerOrder[];
  meta: {
    total: number;
    limit: number;
    offset: number;
    returned: number;
  };
}

export interface CustomerPreferenceFlags {
  orderUpdates?: boolean;
  farmNotifications?: boolean;
  highlightVegan?: boolean;
  reusablePackaging?: boolean;
  promotions?: boolean;
  [key: string]: unknown;
}

export interface CustomerPreferences {
  customerId: number;
  preferences: CustomerPreferenceFlags;
}

export interface CustomerNotification {
  id: number;
  type: string;
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
}

export interface CustomerAddress {
  id: number;
  label: string;
  fullName: string;
  phone: string;
  region: string;
  district: string | null;
  subCounty: string | null;
  parish: string | null;
  village: string | null;
  address: string;
  isDefault: boolean;
  createdAt: string;
}

export type CustomerAddressInput = {
  label: string;
  fullName: string;
  phone: string;
  region: string;
  district?: string | null;
  subCounty?: string | null;
  parish?: string | null;
  village?: string | null;
  address: string;
  isDefault?: boolean;
};

export interface CustomerNotificationsResult {
  data: CustomerNotification[];
  meta: {
    total: number;
    unread: number;
  };
}

function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has('Content-Type') && options.body) headers.set('Content-Type', 'application/json');

  return fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    credentials: 'include',
  }).then(async (res) => {
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (res.status === 401) triggerUnauthorized();
    if (!res.ok) throw new Error(data?.error || `Request failed: ${res.status}`);
    return data as T;
  });
}

export async function fetchCustomerProfile(): Promise<CustomerProfile> {
  const data = await request<{ data: CustomerProfile }>('/customers/me');
  return data.data;
}

export async function updateCustomerProfile(updates: CustomerProfileUpdate): Promise<CustomerProfile> {
  const data = await request<{ data: CustomerProfile }>('/customers/me', {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
  return data.data;
}

export async function fetchCustomerOrders(params?: { limit?: number; offset?: number }): Promise<CustomerOrder[]> {
  const searchParams = new URLSearchParams();
  if (params?.limit) searchParams.set('limit', String(params.limit));
  if (params?.offset) searchParams.set('offset', String(params.offset));
  const qs = searchParams.toString();
  const body = await request<{ data: CustomerOrder[] }>(`/customers/me/orders${qs ? `?${qs}` : ''}`);
  return body.data;
}

/** The signed-in customer, or null when the session cookie is absent or expired. */
export async function fetchCustomerSession(): Promise<CustomerProfile | null> {
  const body = await request<{ data: CustomerProfile | null }>('/customers/session');
  return body.data;
}

export async function loginCustomer(phone: string, password: string): Promise<CustomerProfile> {
  const data = await request<{ data: CustomerProfile }>('/customers/login', {
    method: 'POST',
    body: JSON.stringify({ phone, password }),
  });
  return data.data;
}

export async function logoutCustomer(): Promise<void> {
  await request('/customers/session', { method: 'POST' });
}

export async function createOrder(
  cartId: number,
  shipping?: {
    fullName: string;
    phone: string;
    region: string;
    district?: string;
    subCounty?: string;
    parish?: string;
    village?: string;
    address: string;
  },
  promoCode?: string,
): Promise<{ reference: string }> {
  const data = await request<{ data: { reference: string } }>('/orders', {
    method: 'POST',
    body: JSON.stringify({
      cartId,
      ...(shipping ? { shipping } : {}),
      ...(promoCode ? { promoCode } : {}),
    }),
  });
  return data.data;
}

export interface OrderTimelineEvent {
  id: number;
  fromStatus: string | null;
  toStatus: string;
  note: string | null;
  actor: 'customer' | 'staff' | 'system';
  at: string;
}

export interface OrderPaymentSummary {
  reference: string;
  status: string;
  amount: number;
  currency: string;
  channel: string;
  provider: string;
  maskedCard: string | null;
  failureReason: string | null;
  createdAt?: string;
}

export interface TrackedOrderItem {
  id: number;
  productId: number;
  name: string;
  priceValue: number;
  quantity: number;
  lineTotal: number;
}

export interface TrackedOrder {
  id: number;
  reference: string;
  status: string;
  subtotal: number;
  discount: number;
  promoCode: string | null;
  shipping: number;
  tax: number;
  total: number;
  currency: string;
  customerName: string;
  phone: string;
  region: string | null;
  district: string | null;
  createdAt: string;
  updatedAt: string;
  shippingAddress?: {
    fullName?: string;
    phone?: string;
    address?: string;
    region?: string;
    district?: string | null;
    subCounty?: string | null;
    parish?: string | null;
    village?: string | null;
  } | null;
  items: TrackedOrderItem[];
  timeline: OrderTimelineEvent[];
  payments: OrderPaymentSummary[];
}

/**
 * One order, with its public status timeline. Guests prove ownership with the
 * tracking cookie, signed-in customers with their session.
 */
export async function fetchOrder(reference: string): Promise<TrackedOrder> {
  const body = await request<{ data: TrackedOrder }>(`/orders/${encodeURIComponent(reference)}`);
  return body.data;
}

export async function fetchCustomerPreferences(): Promise<CustomerPreferences> {
  const data = await request<{ data: CustomerPreferences }>('/customers/preferences');
  return data.data;
}

export async function updateCustomerPreferences(preferences: CustomerPreferenceFlags): Promise<CustomerPreferences> {
  const data = await request<{ data: CustomerPreferences }>('/customers/preferences', {
    method: 'PATCH',
    body: JSON.stringify({ preferences }),
  });
  return data.data;
}

export async function fetchCustomerNotifications(params?: { unreadOnly?: boolean; limit?: number }): Promise<CustomerNotificationsResult> {
  const searchParams = new URLSearchParams();
  if (params?.unreadOnly) searchParams.set('unreadOnly', 'true');
  if (params?.limit) searchParams.set('limit', String(params.limit));
  const qs = searchParams.toString();
  // The endpoint answers with the whole { data, meta } envelope; both the rows
  // and the unread count live at the top level.
  return request<CustomerNotificationsResult>(`/customers/notifications${qs ? `?${qs}` : ''}`);
}

/** Mark one notification, or every unread one, as read. */
export async function markCustomerNotificationsRead(input: { id?: number; all?: boolean }): Promise<number> {
  const body = await request<{ data: { updated: number } }>('/customers/notifications', {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  return body.data.updated;
}

/** The customer's saved delivery addresses, default first. */
export async function fetchCustomerAddresses(): Promise<CustomerAddress[]> {
  const body = await request<{ data: CustomerAddress[] }>('/customers/addresses');
  return body.data;
}

export async function createCustomerAddress(input: CustomerAddressInput): Promise<CustomerAddress> {
  const body = await request<{ data: CustomerAddress }>('/customers/addresses', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return body.data;
}

export async function updateCustomerAddress(
  id: number,
  input: Partial<CustomerAddressInput>,
): Promise<CustomerAddress> {
  const body = await request<{ data: CustomerAddress }>(`/customers/addresses/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  return body.data;
}

export async function deleteCustomerAddress(id: number): Promise<void> {
  await request(`/customers/addresses/${id}`, { method: 'DELETE' });
}
