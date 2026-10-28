import { useState, useEffect, useCallback, useMemo } from 'react';
import StatusBar from './shared/StatusBar';
import svgPaths from "../imports/svg-s5y93igtx2";
import { formatUgx } from "../lib/currency";
import { fetchCustomerProfile, updateCustomerProfile, fetchCustomerOrders, fetchCustomerPreferences, updateCustomerPreferences, fetchCustomerNotifications, markCustomerNotificationsRead, fetchCustomerAddresses, createCustomerAddress, updateCustomerAddress, deleteCustomerAddress, type CustomerProfile, type CustomerOrder, type CustomerNotification, type CustomerAddress, type CustomerPreferenceFlags } from '../lib/customerApi';
import type { ReorderOutcome } from '../lib/cartProvider';
import { PageTitle } from './shared/PageTitle';

interface ProfilePageProps {
  customerInfo: {
    fullName: string;
    phone: string;
    region: string;
    district: string;
    subCounty: string;
    parish: string;
    village: string;
    address: string;
  };
  customerSession: {
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
  } | null;
  onUpdateCustomerInfo: (info: {
    fullName: string;
    phone: string;
    region: string;
    district: string;
    subCounty: string;
    parish: string;
    village: string;
    address: string;
  }) => void;
  onBack: () => void;
  onMenuClick: () => void;
  onCartClick: () => void;
  onLogout: () => void;
  onShopClick: () => void;
  onReorder: (reference: string) => Promise<ReorderOutcome | null>;
  cartCount: number;
}

type Tab = 'overview' | 'orders' | 'details' | 'preferences';

/** The editable shape of one address-book entry. */
type AddressDraft = {
  label: string;
  fullName: string;
  phone: string;
  region: string;
  district: string;
  address: string;
  isDefault: boolean;
};

const EMPTY_ADDRESS_DRAFT: AddressDraft = {
  label: 'Home',
  fullName: '',
  phone: '',
  region: '',
  district: '',
  address: '',
  isDefault: false,
};

/**
 * The notification and delivery flags the server will store.
 *
 * This list and the schema on `PATCH /api/customers/preferences` are the same
 * contract. The form used to read these values out of the DOM by data
 * attribute, which meant a renamed attribute silently saved the default.
 */
const PREFERENCE_FLAGS = [
  { key: 'orderUpdates', label: 'Order status updates', fallback: true },
  { key: 'farmNotifications', label: 'Farm harvest notifications', fallback: false },
  { key: 'highlightVegan', label: 'Highlight Certified Vegan (VG) produce', fallback: false },
  { key: 'reusablePackaging', label: 'Reusable bags and crates preferred', fallback: false },
  { key: 'promotions', label: 'Promotions and offers', fallback: false },
] as const;

type PreferenceKey = (typeof PREFERENCE_FLAGS)[number]['key'];
type PreferenceDraft = Record<PreferenceKey, boolean>;

/** Anything the server has not confirmed as a boolean falls back to the default. */
function draftFrom(stored: CustomerPreferenceFlags | undefined): PreferenceDraft {
  const draft = {} as PreferenceDraft;
  for (const flag of PREFERENCE_FLAGS) {
    const value = stored?.[flag.key];
    draft[flag.key] = typeof value === 'boolean' ? value : flag.fallback;
  }
  return draft;
}

export default function ProfilePage({
  customerInfo,
  customerSession,
  onUpdateCustomerInfo,
  onBack,
  onMenuClick,
  onCartClick,
  onLogout,
  onShopClick,
  onReorder,
  cartCount
}: ProfilePageProps) {
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editedInfo, setEditedInfo] = useState(customerInfo);
  const [editedEmail, setEditedEmail] = useState('');
  const [orderFilter, setOrderFilter] = useState<'all' | 'active' | 'delivered'>('all');
  const [notifications, setNotifications] = useState<CustomerNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showNotifications, setShowNotifications] = useState(false);
  const [savingPreferences, setSavingPreferences] = useState(false);
  const [prefDraft, setPrefDraft] = useState<PreferenceDraft>(() => draftFrom(undefined));
  const [addresses, setAddresses] = useState<CustomerAddress[]>([]);
  const [addressEditor, setAddressEditor] = useState<{ id: number | null; draft: AddressDraft } | null>(null);
  const [addressError, setAddressError] = useState<string | null>(null);
  const [addressSaving, setAddressSaving] = useState(false);
  const [reorderingReference, setReorderingReference] = useState<string | null>(null);
  const [reorderFeedback, setReorderFeedback] = useState<{ tone: 'ok' | 'warn' | 'error'; lines: string[] } | null>(null);

  const loadProfile = useCallback(async () => {
    setError(null);
    try {
      const data = await fetchCustomerProfile();
      setProfile(data);
      onUpdateCustomerInfo({
        fullName: data.fullName,
        phone: data.phone,
        region: data.region,
        district: data.district || '',
        subCounty: data.subCounty || '',
        parish: data.parish || '',
        village: data.village || '',
        address: data.address,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load profile');
    }
  }, [onUpdateCustomerInfo]);

  const loadOrders = useCallback(async () => {
    setOrdersLoading(true);
    try {
      const data = await fetchCustomerOrders({ limit: 50 });
      setOrders(data);
    } catch {
      // Orders are optional; don't block the rest of the profile
    } finally {
      setOrdersLoading(false);
    }
  }, []);

  const loadPreferences = useCallback(async () => {
    try {
      const data = await fetchCustomerPreferences();
      setPrefDraft(draftFrom(data.preferences));
    } catch {
      // Preferences are optional
    }
  }, []);

  const loadNotifications = useCallback(async () => {
    try {
      const data = await fetchCustomerNotifications({ limit: 20 });
      setNotifications(data.data || []);
      setUnreadCount(data.meta?.unread || 0);
    } catch {
      // Notifications are optional
    }
  }, []);

  const loadAddresses = useCallback(async () => {
    try {
      setAddresses(await fetchCustomerAddresses());
    } catch {
      // The address book is optional; checkout still accepts a typed address.
    }
  }, []);

  const handleMarkAllRead = useCallback(async () => {
    if (unreadCount === 0) return;
    try {
      await markCustomerNotificationsRead({ all: true });
      setNotifications((prev) => prev.map((notification) => ({ ...notification, read: true })));
      setUnreadCount(0);
    } catch {
      // Leave the badge alone if the server refused; the next load will resync.
    }
  }, [unreadCount]);

  const handleMarkOneRead = useCallback(async (id: number) => {
    const target = notifications.find((notification) => notification.id === id);
    if (!target || target.read) return;
    try {
      await markCustomerNotificationsRead({ id });
      setNotifications((prev) =>
        prev.map((notification) => (notification.id === id ? { ...notification, read: true } : notification)),
      );
      setUnreadCount((prev) => Math.max(prev - 1, 0));
    } catch {
      // The row stays unread; retrying is harmless.
    }
  }, [notifications]);

  useEffect(() => {
    loadProfile();
    loadOrders();
    loadPreferences();
    loadNotifications();
    loadAddresses();
  }, [loadProfile, loadOrders, loadPreferences, loadNotifications, loadAddresses]);

  useEffect(() => {
    if (activeTab === 'orders') {
      loadOrders();
    }
  }, [activeTab, loadOrders]);

  const displayName = profile?.fullName?.trim() || customerInfo.fullName.trim() || 'Guest shopper';
  const displayPhone = profile?.phone?.trim() || customerInfo.phone.trim() || 'No number saved';
  const displayAddress = profile?.address?.trim() || customerInfo.address.trim() || 'No delivery address saved';
  const displayPlace = [profile?.district || customerInfo.district, profile?.region || customerInfo.region].filter(Boolean).join(', ');
  const displayPlaceOrDefault = displayPlace || 'Kampala, Central Region';

  const memberSince = profile?.createdAt ? new Date(profile.createdAt).toLocaleDateString('en-UG', { month: 'long', year: 'numeric' }) : '2024';

  const totalOrders = orders.length;
  // Cancelled orders never took money, so they should not inflate "total spent".
  const totalSpent = orders
    .filter((order) => order.status !== 'cancelled')
    .reduce((sum, order) => sum + (order.total || 0), 0);
  const activeOrders = orders.filter(o => ['pending', 'processing', 'shipped'].includes(o.status));
  const deliveredOrders = orders.filter(o => o.status === 'delivered');

  const showAllOrders = () => {
    setOrderFilter('all');
    setActiveTab('orders');
  };

  const showActiveOrders = () => {
    setOrderFilter('active');
    setActiveTab('orders');
  };

  const showDeliveredOrders = () => {
    setOrderFilter('delivered');
    setActiveTab('orders');
  };

  const filteredOrders = useMemo(() => {
    if (orderFilter === 'active') return orders.filter(o => ['pending', 'processing', 'shipped'].includes(o.status));
    if (orderFilter === 'delivered') return orders.filter(o => o.status === 'delivered');
    return orders;
  }, [orders, orderFilter]);

  /** Persists the Details tab form. The API returns the saved row, so the card
   *  reflects what the server stored rather than what was typed. */
  const handleSave = async () => {
    setError(null);
    try {
      const saved = await updateCustomerProfile({
        fullName: editedInfo.fullName.trim(),
        phone: editedInfo.phone.trim(),
        email: editedEmail.trim(),
        region: editedInfo.region.trim(),
        district: editedInfo.district.trim(),
        subCounty: editedInfo.subCounty.trim(),
        parish: editedInfo.parish.trim(),
        village: editedInfo.village.trim(),
        address: editedInfo.address.trim(),
      });
      setProfile(saved);
      onUpdateCustomerInfo({
        fullName: saved.fullName,
        phone: saved.phone,
        region: saved.region,
        district: saved.district || '',
        subCounty: saved.subCounty || '',
        parish: saved.parish || '',
        village: saved.village || '',
        address: saved.address,
      });
      setIsEditing(false);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save profile');
    }
  };

  const handleSavePreferences = async () => {
    setSavingPreferences(true);
    setError(null);
    try {
      await updateCustomerPreferences({ ...prefDraft });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2500);
      await loadPreferences();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save preferences');
    } finally {
      setSavingPreferences(false);
    }
  };

  /** Sends a past order back to the basket and reports what the server did. */
  const handleReorder = async (reference: string) => {
    setReorderingReference(reference);
    setReorderFeedback(null);
    try {
      const outcome = await onReorder(reference);
      if (!outcome) {
        setReorderFeedback({
          tone: 'error',
          lines: ['The basket service is not reachable. Start the API and try again.'],
        });
        return;
      }
      const lines = outcome.added > 0
        ? [`${outcome.added} item${outcome.added === 1 ? '' : 's'} added to your basket.`]
        : ['Nothing could be added from this order.'];
      for (const skip of outcome.skipped) lines.push(`${skip.name}: ${skip.reason}`);
      setReorderFeedback({
        tone: outcome.added === 0 ? 'warn' : outcome.skipped.length > 0 ? 'warn' : 'ok',
        lines,
      });
    } catch (err) {
      setReorderFeedback({
        tone: 'error',
        lines: [err instanceof Error ? err.message : 'Could not reorder this order.'],
      });
    } finally {
      setReorderingReference(null);
    }
  };

  const openAddressEditor = (address?: CustomerAddress) => {
    setAddressError(null);
    setAddressEditor({
      id: address?.id ?? null,
      draft: address
        ? {
            label: address.label,
            fullName: address.fullName,
            phone: address.phone,
            region: address.region,
            district: address.district ?? '',
            address: address.address,
            isDefault: address.isDefault,
          }
        : {
            ...EMPTY_ADDRESS_DRAFT,
            fullName: profile?.fullName ?? customerInfo.fullName,
            phone: profile?.phone ?? customerInfo.phone,
            region: profile?.region ?? customerInfo.region,
            district: profile?.district ?? customerInfo.district,
          },
    });
  };

  const updateAddressDraft = <K extends keyof AddressDraft>(field: K, value: AddressDraft[K]) => {
    setAddressEditor((prev) => (prev ? { ...prev, draft: { ...prev.draft, [field]: value } } : prev));
  };

  const saveAddress = async () => {
    if (!addressEditor) return;
    const draft = addressEditor.draft;

    if (
      draft.label.trim().length === 0 ||
      draft.fullName.trim().length < 2 ||
      draft.phone.trim().length === 0 ||
      draft.region.trim().length === 0 ||
      draft.address.trim().length < 3
    ) {
      setAddressError('Fill in the label, name, phone, region and delivery address.');
      return;
    }

    setAddressSaving(true);
    setAddressError(null);
    const input = {
      label: draft.label.trim(),
      fullName: draft.fullName.trim(),
      phone: draft.phone.trim(),
      region: draft.region.trim(),
      district: draft.district.trim() || null,
      address: draft.address.trim(),
      isDefault: draft.isDefault,
    };
    try {
      if (addressEditor.id === null) {
        await createCustomerAddress(input);
      } else {
        await updateCustomerAddress(addressEditor.id, input);
      }
      await loadAddresses();
      setAddressEditor(null);
    } catch (err) {
      setAddressError(err instanceof Error ? err.message : 'Could not save this address.');
    } finally {
      setAddressSaving(false);
    }
  };

  const deleteAddress = async (address: CustomerAddress) => {
    if (!window.confirm(`Delete the “${address.label}” address?`)) return;
    try {
      await deleteCustomerAddress(address.id);
      await loadAddresses();
    } catch {
      setAddressError('Could not delete this address.');
    }
  };

  const makeDefaultAddress = async (address: CustomerAddress) => {
    try {
      await updateCustomerAddress(address.id, { isDefault: true });
      await loadAddresses();
    } catch {
      setAddressError('Could not change the default address.');
    }
  };

  const statusConfig: Record<string, { label: string; className: string }> = {
    pending: { label: 'Pending', className: 'bg-yellow-100 text-yellow-800' },
    processing: { label: 'Processing', className: 'bg-blue-100 text-blue-800' },
    shipped: { label: 'Shipped', className: 'bg-purple-100 text-purple-800' },
    delivered: { label: 'Delivered', className: 'bg-green-100 text-green-800' },
    cancelled: { label: 'Cancelled', className: 'bg-red-100 text-red-800' },
  };

  return (
    <div className="bg-[#ffffff] relative size-full select-none">
      <StatusBar />

      {/* Header */}
      <div className="absolute bg-[#ffffff] h-[149px] left-0 right-0 top-0 z-10">
        <div className="absolute border-[0px_0px_1px] border-neutral-200 border-solid inset-0 pointer-events-none shadow-[0px_0px_20px_0px_rgba(0,0,0,0.1)]" />

        {/* Mobile Nav */}
        <div className="absolute bg-[#ffffff] h-16 left-0 overflow-clip right-0 top-[31px]">
          <div className="absolute bg-[#ffffff] h-[66px] left-0 top-0 w-[393px]" />
          <div
            className="absolute flex flex-col font-serif font-medium justify-center leading-[0] text-brand text-[24px] text-center text-nowrap top-9 tracking-[-0.24px] translate-x-[-50%] translate-y-[-50%]"
            style={{ left: "calc(50% - 0.5px)" }}
          >
            <p className="block leading-none whitespace-pre text-[24px]">Mu Katale</p>
          </div>

          {/* Cart Icon */}
          <button
            onClick={onCartClick}
            aria-label="View basket"
            className="absolute right-5 rounded-2xl size-8 top-[18px] cursor-pointer"
          >
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
                    <div className="flex flex-col font-medium justify-center leading-[0] not-italic relative shrink-0 text-[#ffffff] text-[12px] text-center text-nowrap tracking-[-0.12px]">
                      <p className="block leading-none whitespace-pre text-[9px]">{cartCount}</p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </button>

          {/* Notifications Bell */}
          <button
            onClick={() => setShowNotifications((v) => !v)}
            aria-label="Notifications"
            className="absolute right-14 rounded-2xl size-8 top-[18px] cursor-pointer flex items-center justify-center"
          >
            <div className="size-5">
              <svg className="block size-full" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
            </div>
            {unreadCount > 0 && (
              <div className="absolute bg-red-500 left-[17px] rounded-full size-4 top-[-1px]">
                <div className="flex flex-col items-center justify-center relative size-full">
                  <div className="box-border content-stretch flex flex-col gap-2 items-center justify-center px-0.5 py-px relative size-4">
                    <div className="flex flex-col font-medium justify-center leading-[0] not-italic relative shrink-0 text-[#ffffff] text-[10px] text-center text-nowrap tracking-[-0.1px]">
                      <p className="block leading-none whitespace-pre text-[9px]">{unreadCount > 9 ? '9+' : unreadCount}</p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </button>

          {/* Notifications Dropdown */}
          {showNotifications && (
            <div className="absolute right-0 top-[52px] w-[320px] bg-white border border-neutral-200 rounded-xl shadow-lg z-50 max-h-[400px] overflow-y-auto">
              <div className="p-3 border-b border-neutral-100 flex items-center justify-between">
                <h3 className="font-medium text-[15px] text-[#000000]">Notifications</h3>
                <div className="flex items-center gap-3">
                  {unreadCount > 0 && (
                    <button
                      onClick={handleMarkAllRead}
                      className="text-brand hover:underline text-[12px] font-medium"
                    >
                      Mark all read
                    </button>
                  )}
                  <button
                    onClick={() => setShowNotifications(false)}
                    className="text-muted-foreground hover:text-[#000000] text-[12px]"
                  >
                    Close
                  </button>
                </div>
              </div>
              {notifications.length === 0 ? (
                <div className="p-4 text-center text-muted-foreground text-[13px]">No notifications yet</div>
              ) : (
                <div className="divide-y divide-neutral-100">
                  {notifications.map((notification) => (
                    <button
                      key={notification.id}
                      type="button"
                      onClick={() => handleMarkOneRead(notification.id)}
                      className={`w-full text-left p-3 transition-colors hover:bg-neutral-50 ${notification.read ? 'bg-white' : 'bg-brand/5'}`}
                    >
                      <div className="flex items-start gap-2">
                        <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${notification.read ? 'bg-transparent' : 'bg-brand'}`} />
                        <div className="grow min-w-0">
                          <p className="text-[13px] font-medium text-[#000000] truncate">{notification.title}</p>
                          <p className="text-[12px] text-muted-foreground line-clamp-2">{notification.message}</p>
                          <p className="text-[11px] text-[#9a9a9a] mt-1">
                            {new Date(notification.createdAt).toLocaleDateString('en-UG', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Menu Hamburger */}
          <button
            onClick={onMenuClick}
            aria-label="Open navigation menu"
            className="absolute left-5 rounded-2xl size-8 top-[18px] flex items-center justify-center cursor-pointer"
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
          <div className="box-border content-stretch flex flex-col font-normal items-center justify-start leading-[0] p-0 relative text-left w-full">
            <PageTitle>My Page</PageTitle>
            <div className="flex gap-3">
              <button
                onClick={onBack}
                className="cursor-pointer flex items-center font-normal not-italic relative shrink-0 text-brand text-[14px] text-nowrap tracking-[-0.14px] hover:opacity-80 transition-opacity"
              >
                <div className="flex flex-row items-center gap-1">
                  <div className="w-3 h-3">
                    <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 12 12">
                      <path d="M7.5 9L4.5 6L7.5 3" stroke="#426b1f" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                  <p className="block leading-[24px] whitespace-pre">Back</p>
                </div>
              </button>
              {customerSession && (
                <button
                  onClick={onLogout}
                  className="cursor-pointer flex items-center font-normal not-italic relative shrink-0 text-red-600 text-[14px] text-nowrap tracking-[-0.14px] hover:opacity-80 transition-opacity"
                >
                  <p className="block leading-[24px] whitespace-pre">Sign out</p>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="absolute left-0 right-0 top-[149px] bottom-0 overflow-y-auto">
        <div className="px-6 pt-5 pb-10 space-y-5">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-[13px] text-red-700 text-center">
              {error}
            </div>
          )}

          {saveSuccess && (
            <div className="p-3 bg-brand/10 border border-brand/30 rounded-lg text-[13px] text-brand font-normal text-center">
              ✓ Profile updated successfully!
            </div>
          )}

          {/* User Bio Card */}
          <div className="border border-neutral-200 rounded-2xl p-4 bg-white flex items-center gap-4">
            <div className="size-14 rounded-full bg-brand text-white flex items-center justify-center font-serif text-[22px] font-medium shrink-0">
              {displayName.charAt(0).toUpperCase()}
            </div>
            <div className="grow min-w-0">
              <h2 className="font-serif font-normal text-[20px] text-[#000000] leading-tight truncate">
                {displayName}
              </h2>
              <p className="font-normal text-[12px] text-muted-foreground truncate">
                Member since {memberSince} • Farm Patron
              </p>
            </div>
          </div>

          {/* Shop CTA */}
          <button
            onClick={onShopClick}
            className="w-full bg-brand text-white font-medium text-[15px] py-3.5 rounded-xl hover:bg-[#355a19] transition-colors flex items-center justify-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z" />
            </svg>
            Continue Shopping
          </button>

          {/* Overview Tab - Stats */}
          {activeTab === 'overview' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={showAllOrders}
                  className="border border-neutral-200 rounded-xl p-4 bg-white text-left hover:border-brand hover:shadow-sm transition-all cursor-pointer"
                >
                  <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-1">Total Orders</p>
                  <p className="font-serif font-normal text-[28px] text-[#000000] leading-none">
                    {totalOrders}
                  </p>
                </button>
                <button
                  onClick={showAllOrders}
                  className="border border-neutral-200 rounded-xl p-4 bg-white text-left hover:border-brand hover:shadow-sm transition-all cursor-pointer"
                >
                  <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-1">Total Spent</p>
                  <p className="font-serif font-normal text-[28px] text-[#000000] leading-none">
                    {formatUgx(totalSpent)}
                  </p>
                </button>
                <button
                  onClick={showActiveOrders}
                  className="border border-neutral-200 rounded-xl p-4 bg-white text-left hover:border-brand hover:shadow-sm transition-all cursor-pointer"
                >
                  <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-1">Active Orders</p>
                  <p className="font-serif font-normal text-[28px] text-[#000000] leading-none">
                    {activeOrders.length}
                  </p>
                </button>
                <button
                  onClick={showDeliveredOrders}
                  className="border border-neutral-200 rounded-xl p-4 bg-white text-left hover:border-brand hover:shadow-sm transition-all cursor-pointer"
                >
                  <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-1">Delivered</p>
                  <p className="font-serif font-normal text-[28px] text-[#000000] leading-none">
                    {deliveredOrders.length}
                  </p>
                </button>
              </div>

              {/* Recent Activity */}
              <div className="border border-neutral-200 rounded-xl p-4 bg-white">
                <h3 className="font-medium text-[15px] text-[#000000] mb-3">Recent Orders</h3>
                <div className="space-y-3">
                  {orders.slice(0, 3).map((order) => {
                    const status = statusConfig[order.status] || { label: order.status, className: 'bg-neutral-100 text-neutral-800' };
                    return (
                      <div key={order.id} className="flex items-center justify-between py-2 border-b border-neutral-100 last:border-0">
                        <div>
                          <p className="text-[13px] font-medium text-[#000000]">#{order.reference}</p>
                          <p className="text-[12px] text-muted-foreground">
                            {new Date(order.createdAt).toLocaleDateString('en-UG', { month: 'short', day: 'numeric', year: 'numeric' })} • {order.items.length} item{order.items.length !== 1 ? 's' : ''}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-[13px] font-medium text-[#000000]">{formatUgx(order.total)}</p>
                          <span className={`text-[11px] px-2 py-0.5 rounded ${status.className}`}>{status.label}</span>
                        </div>
                      </div>
                    );
                  })}
                  {orders.length === 0 && (
                    <p className="text-[13px] text-muted-foreground text-center py-4">No orders yet. Start shopping to see your history here.</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Segmented Tab Controls */}
          <div className="flex rounded-lg bg-neutral-100 p-1 border border-neutral-200 text-[13px] font-normal">
            <button
              onClick={() => setActiveTab('overview')}
              className={`flex-1 py-1.5 rounded-md text-center transition-all ${
                activeTab === 'overview' ? 'bg-white text-brand font-medium shadow-sm' : 'text-muted-foreground'
              }`}
            >
              Overview
            </button>
            <button
              onClick={() => setActiveTab('orders')}
              className={`flex-1 py-1.5 rounded-md text-center transition-all ${
                activeTab === 'orders' ? 'bg-white text-brand font-medium shadow-sm' : 'text-muted-foreground'
              }`}
            >
              Orders
            </button>
            <button
              onClick={() => setActiveTab('details')}
              className={`flex-1 py-1.5 rounded-md text-center transition-all ${
                activeTab === 'details' ? 'bg-white text-brand font-medium shadow-sm' : 'text-muted-foreground'
              }`}
            >
              Details
            </button>
            <button
              onClick={() => setActiveTab('preferences')}
              className={`flex-1 py-1.5 rounded-md text-center transition-all ${
                activeTab === 'preferences' ? 'bg-white text-brand font-medium shadow-sm' : 'text-muted-foreground'
              }`}
            >
              Preferences
            </button>
          </div>

          {/* Tab: Orders */}
          {activeTab === 'orders' && (
            <div className="space-y-3 font-normal">
              {reorderFeedback && (
                <div
                  className={`rounded-lg border p-3 text-[12px] space-y-1 ${
                    reorderFeedback.tone === 'error'
                      ? 'bg-red-50 border-red-200 text-red-700'
                      : reorderFeedback.tone === 'warn'
                        ? 'bg-yellow-50 border-yellow-200 text-yellow-800'
                        : 'bg-brand/10 border-brand/30 text-brand'
                  }`}
                >
                  {reorderFeedback.lines.map((line, index) => (
                    <p key={index}>{line}</p>
                  ))}
                  <button onClick={onCartClick} className="font-medium underline pt-1">
                    View basket
                  </button>
                </div>
              )}
              {orderFilter !== 'all' && (
                <button
                  onClick={() => setOrderFilter('all')}
                  className="text-[13px] text-brand font-medium hover:underline"
                >
                  ← Show all orders
                </button>
              )}
              {ordersLoading ? (
                <div className="p-8 text-center text-muted-foreground text-[14px]">Loading orders...</div>
              ) : filteredOrders.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground text-[14px]">
                  {orderFilter === 'active' ? 'No active orders.' : orderFilter === 'delivered' ? 'No delivered orders yet.' : 'No orders yet.'}
                </div>
              ) : (
                filteredOrders.map((order) => {
                  const status = statusConfig[order.status] || { label: order.status, className: 'bg-neutral-100 text-neutral-800' };
                  return (
                    <div key={order.id} className="border border-neutral-200 rounded-xl p-4 bg-white space-y-2">
                      <div className="flex items-center justify-between text-[13px]">
                        <span className="font-medium text-[#000000]">Order #{order.reference}</span>
                        <span className={`${status.className} px-2 py-0.5 rounded text-[11px] font-semibold`}>{status.label}</span>
                      </div>
                      <p className="text-[12px] text-muted-foreground">
                        {new Date(order.createdAt).toLocaleDateString('en-UG', { month: 'short', day: 'numeric', year: 'numeric' })} • {order.items.length} item{order.items.length !== 1 ? 's' : ''}
                      </p>
                      <div className="text-[13px] text-[#000000] pt-1 border-t border-neutral-100 space-y-1">
                        {order.items.map((item) => (
                          <div key={item.id} className="flex justify-between">
                            <span className="truncate mr-2">{item.name}</span>
                            <span className="font-medium whitespace-nowrap">{item.quantity} × {formatUgx(item.priceValue)}</span>
                          </div>
                        ))}
                      </div>
                      <div className="flex justify-between items-center pt-2 border-t border-neutral-100">
                        <span className="text-[12px] text-muted-foreground">{order.region}{order.district ? `, ${order.district}` : ''}</span>
                        <span className="font-medium text-[#000000]">{formatUgx(order.total)}</span>
                      </div>
                      <div className="flex justify-end pt-1">
                        <button
                          onClick={() => handleReorder(order.reference)}
                          disabled={reorderingReference !== null}
                          className="text-[12px] font-medium text-brand border border-brand/30 rounded-lg px-3 py-1.5 hover:bg-brand/5 transition-colors disabled:opacity-50"
                        >
                          {reorderingReference === order.reference ? 'Adding…' : 'Reorder'}
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* Tab: Shipping Details */}
          {activeTab === 'details' && (
            <div className="space-y-4">
            <div className="border border-neutral-200 rounded-xl p-4 bg-white space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-neutral-100">
                <span className="font-medium text-[15px] text-[#000000]">
                  Profile Details
                </span>
                <button
                  onClick={() => {
                    if (isEditing) handleSave();
                    else {
                      setEditedInfo({
                        fullName: profile?.fullName || customerInfo.fullName,
                        phone: profile?.phone || customerInfo.phone,
                        region: profile?.region || customerInfo.region,
                        district: profile?.district || customerInfo.district,
                        subCounty: profile?.subCounty || customerInfo.subCounty,
                        parish: profile?.parish || customerInfo.parish,
                        village: profile?.village || customerInfo.village,
                        address: profile?.address || customerInfo.address,
                      });
                      setEditedEmail(profile?.email ?? '');
                      setIsEditing(true);
                    }
                  }}
                  className="text-[13px] text-brand font-medium hover:underline"
                >
                  {isEditing ? 'Save Changes' : 'Edit'}
                </button>
              </div>

              {isEditing ? (
                <div className="space-y-3 font-normal text-[14px]">
                  <div>
                    <label className="text-[12px] text-muted-foreground block mb-1">Full Name</label>
                    <input
                      type="text"
                      value={editedInfo.fullName}
                      onChange={(e) => setEditedInfo({ ...editedInfo, fullName: e.target.value })}
                      className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-[14px]"
                    />
                  </div>
                  <div>
                    <label className="text-[12px] text-muted-foreground block mb-1">Address</label>
                    <input
                      type="text"
                      value={editedInfo.address}
                      onChange={(e) => setEditedInfo({ ...editedInfo, address: e.target.value })}
                      className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-[14px]"
                    />
                  </div>
                  <div>
                    <label className="text-[12px] text-muted-foreground block mb-1">Phone number</label>
                    <input
                      type="tel"
                      value={editedInfo.phone}
                      onChange={(e) => setEditedInfo({ ...editedInfo, phone: e.target.value })}
                      placeholder="07XX XXX XXX"
                      className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-[14px]"
                    />
                    <p className="text-[11px] text-[#9a9a9a] mt-1">
                      This is your sign-in number. Change it only if you can receive messages on the new one.
                    </p>
                  </div>
                  <div>
                    <label className="text-[12px] text-muted-foreground block mb-1">Email (optional)</label>
                    <input
                      type="email"
                      value={editedEmail}
                      onChange={(e) => setEditedEmail(e.target.value)}
                      placeholder="you@example.com"
                      className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-[14px]"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[12px] text-muted-foreground block mb-1">Region</label>
                      <input
                        type="text"
                        value={editedInfo.region}
                        onChange={(e) => setEditedInfo({ ...editedInfo, region: e.target.value })}
                        placeholder="Central Region"
                        className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-[14px]"
                      />
                    </div>
                    <div>
                      <label className="text-[12px] text-muted-foreground block mb-1">District / town</label>
                      <input
                        type="text"
                        value={editedInfo.district}
                        onChange={(e) => setEditedInfo({ ...editedInfo, district: e.target.value })}
                        placeholder="Kampala"
                        className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-[14px]"
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-1 font-normal text-[14px] text-[#000000] leading-[22px]">
                  <p className="font-medium">{displayName}</p>
                  <p className="text-muted-foreground">{displayPhone}</p>
                  {profile?.email && <p className="text-muted-foreground">{profile.email}</p>}
                  <p className="text-muted-foreground">{displayAddress}</p>
                  <p className="text-muted-foreground">{displayPlaceOrDefault}</p>
                </div>
              )}
            </div>

            {/* Saved addresses */}
            <div className="border border-neutral-200 rounded-xl p-4 bg-white space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-medium text-[15px] text-[#000000]">
                  Saved addresses
                </h4>
                {!addressEditor && addresses.length < 10 && (
                  <button
                    onClick={() => openAddressEditor()}
                    className="text-[13px] font-medium text-brand hover:underline"
                  >
                    Add address
                  </button>
                )}
              </div>

              {addressError && (
                <p className="font-normal text-[12px] text-red-600">{addressError}</p>
              )}

              {addresses.length === 0 && !addressEditor && (
                <p className="font-normal text-[13px] text-muted-foreground">
                  No saved addresses yet. Add one to check out in a couple of taps.
                </p>
              )}

              <div className="space-y-2">
                {addresses.map((address) => (
                  <div key={address.id} className="border border-neutral-100 rounded-lg p-3 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-[13px] text-[#000000]">
                        {address.label}
                      </span>
                      {address.isDefault && (
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-brand bg-brand/10 px-2 py-0.5 rounded">
                          Default
                        </span>
                      )}
                    </div>
                    <p className="font-normal text-[12px] text-muted-foreground">
                      {address.fullName} • {address.phone}
                    </p>
                    <p className="font-normal text-[12px] text-muted-foreground">
                      {address.address}
                      {address.district ? `, ${address.district}` : ''}
                      {address.region ? `, ${address.region}` : ''}
                    </p>
                    <div className="flex gap-3 pt-1 font-medium text-[12px]">
                      <button onClick={() => openAddressEditor(address)} className="text-brand hover:underline">
                        Edit
                      </button>
                      {!address.isDefault && (
                        <button onClick={() => makeDefaultAddress(address)} className="text-brand hover:underline">
                          Set default
                        </button>
                      )}
                      <button onClick={() => deleteAddress(address)} className="text-red-600 hover:underline">
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {addressEditor && (
                <div className="border border-brand/30 rounded-lg p-3 space-y-2 font-normal text-[14px]">
                  <p className="font-medium text-[13px] text-[#000000]">
                    {addressEditor.id === null ? 'New address' : 'Edit address'}
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[12px] text-muted-foreground block mb-1">Label</label>
                      <input
                        type="text"
                        value={addressEditor.draft.label}
                        onChange={(e) => updateAddressDraft('label', e.target.value)}
                        placeholder="Home, Office…"
                        className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-[14px]"
                      />
                    </div>
                    <div>
                      <label className="text-[12px] text-muted-foreground block mb-1">Full name</label>
                      <input
                        type="text"
                        value={addressEditor.draft.fullName}
                        onChange={(e) => updateAddressDraft('fullName', e.target.value)}
                        className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-[14px]"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-[12px] text-muted-foreground block mb-1">Phone number</label>
                    <input
                      type="tel"
                      value={addressEditor.draft.phone}
                      onChange={(e) => updateAddressDraft('phone', e.target.value)}
                      placeholder="07XX XXX XXX"
                      className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-[14px]"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[12px] text-muted-foreground block mb-1">Region</label>
                      <input
                        type="text"
                        value={addressEditor.draft.region}
                        onChange={(e) => updateAddressDraft('region', e.target.value)}
                        placeholder="Central Region"
                        className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-[14px]"
                      />
                    </div>
                    <div>
                      <label className="text-[12px] text-muted-foreground block mb-1">District / town</label>
                      <input
                        type="text"
                        value={addressEditor.draft.district}
                        onChange={(e) => updateAddressDraft('district', e.target.value)}
                        placeholder="Kampala"
                        className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-[14px]"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-[12px] text-muted-foreground block mb-1">Delivery address and landmark</label>
                    <input
                      type="text"
                      value={addressEditor.draft.address}
                      onChange={(e) => updateAddressDraft('address', e.target.value)}
                      placeholder="Plot number, street and nearest landmark"
                      className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-[14px]"
                    />
                  </div>
                  <label className="flex items-center gap-2 text-[12px] text-muted-foreground pt-1">
                    <input
                      type="checkbox"
                      checked={addressEditor.draft.isDefault}
                      onChange={(e) => updateAddressDraft('isDefault', e.target.checked)}
                      className="accent-brand w-4 h-4"
                    />
                    Use as my default address
                  </label>
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={saveAddress}
                      disabled={addressSaving}
                      className="px-4 py-2 rounded-lg bg-brand text-white text-[13px] font-medium disabled:opacity-50"
                    >
                      {addressSaving ? 'Saving…' : 'Save address'}
                    </button>
                    <button
                      onClick={() => {
                        setAddressEditor(null);
                        setAddressError(null);
                      }}
                      className="px-4 py-2 rounded-lg border border-neutral-200 text-[13px] text-[#000000]"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
            </div>
          )}

          {/* Tab: Preferences */}
          {activeTab === 'preferences' && (
            <div className="border border-neutral-200 rounded-xl p-4 bg-white space-y-4 font-normal text-[14px]">
              <div className="flex items-center justify-between">
                <h4 className="font-medium text-[15px] text-[#000000]">
                  Notification & Delivery Preferences
                </h4>
                <button
                  onClick={handleSavePreferences}
                  disabled={savingPreferences}
                  className="text-[13px] font-medium text-brand hover:underline disabled:opacity-50"
                >
                  {savingPreferences ? 'Saving...' : 'Save'}
                </button>
              </div>
              <div className="space-y-3">
                {PREFERENCE_FLAGS.map((flag) => (
                  <label key={flag.key} className="flex items-center justify-between cursor-pointer">
                    <span className="text-[13px] text-[#000000]">{flag.label}</span>
                    <input
                      type="checkbox"
                      checked={prefDraft[flag.key]}
                      onChange={(event) =>
                        setPrefDraft((prev) => ({ ...prev, [flag.key]: event.target.checked }))
                      }
                      className="accent-brand w-4 h-4 rounded"
                    />
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Environmental Impact Widget */}
          <div className="border border-brand/20 bg-brand/5 rounded-xl p-4 space-y-1">
            <span className="text-[11px] font-bold uppercase tracking-wider text-brand">Your Impact</span>
            <p className="font-serif font-normal text-[16px] text-[#000000]">
              {formatUgx(totalSpent)} of regional organic produce purchased
            </p>
            <p className="font-normal text-[12px] text-muted-foreground"> {orders.length} order{orders.length !== 1 ? 's' : ''} placed • {activeOrders.length} active
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
