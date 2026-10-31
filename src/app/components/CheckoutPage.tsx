import React, { useState, useEffect } from 'react';
import svgPaths from "../imports/svg-toln6of0ig";
import { Input } from './ui/input';
import GeoCascade from './GeoCascade';
import { isValidUgandanPhone, normalizeUgandanPhone } from '../lib/uganda';
import { fetchHierarchy, validateSelection, reverseGeocode, type GeoNode } from '../lib/geoApi';
import { fetchCustomerAddresses, type CustomerAddress } from '../lib/customerApi';
import ScreenHeader from './shared/ScreenHeader';

interface CheckoutPageProps {
  cartCount: number;
  customerInfo: CustomerInfo;
  /** Saved addresses only exist for a signed-in customer. */
  signedIn?: boolean;
  onBack: () => void;
  onMenuClick: () => void;
  onProceedToPayment: (customerInfo: CustomerInfo) => void;
  /** The last failure from placing the order, shown above the button so a
   *  refused checkout is never silent. */
  errorMessage?: string | null;
}

/**
 * The full administrative chain. Sub-county, parish and village are carried
 * through so a delivery can be as precise as the data allows, even though only
 * region and district are populated today.
 */
interface CustomerInfo {
  fullName: string;
  phone: string;
  region: string;
  district: string;
  subCounty: string;
  parish: string;
  village: string;
  address: string;
  /** Optional pin from "use my current location". */
  lat?: number;
  lng?: number;
  accuracyM?: number;
  locationSource?: 'gps' | 'manual';
}

export default function CheckoutPage({ cartCount, customerInfo, signedIn = false, onBack, onMenuClick, onProceedToPayment, errorMessage = null }: CheckoutPageProps) {
  const [formData, setFormData] = useState<CustomerInfo>(customerInfo);
  const [hierarchy, setHierarchy] = useState<GeoNode[] | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [phoneTouched, setPhoneTouched] = useState(false);
  const [savedAddresses, setSavedAddresses] = useState<CustomerAddress[]>([]);
  // "Use my current location" walks through these states so the buyer always
  // knows whether the app is asking the device, checking the map, or has given
  // up and is leaving the cascade for them.
  const [locateState, setLocateState] = useState<'idle' | 'locating' | 'found' | 'denied' | 'unavailable' | 'outside'>('idle');
  const [locateNote, setLocateNote] = useState<string | null>(null);

  useEffect(() => {
    setFormData(customerInfo);
  }, [customerInfo]);

  // The address book is a shortcut, not a requirement: when it cannot be
  // loaded the form works exactly as before.
  useEffect(() => {
    if (!signedIn) {
      setSavedAddresses([]);
      return;
    }
    let cancelled = false;
    fetchCustomerAddresses()
      .then((rows) => {
        if (!cancelled) setSavedAddresses(rows);
      })
      .catch(() => {
        // Signed out mid-session or API unreachable; the manual form remains.
      });
    return () => {
      cancelled = true;
    };
  }, [signedIn]);

  // The cascade is driven by the same hierarchy the server validates against,
  // so anything selectable here is guaranteed to be accepted there.
  useEffect(() => {
    const controller = new AbortController();

    fetchHierarchy(controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        if (!result) {
          setGeoError(
            'Could not load the administrative areas. Start the API with npm run dev --prefix api, then reload.',
          );
          return;
        }
        setHierarchy(result.regions);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setGeoError('Could not load the administrative areas.');
        }
      });

    return () => controller.abort();
  }, []);

  const showPhoneError =
    phoneTouched && formData.phone.trim() !== '' && !isValidUgandanPhone(formData.phone);

  /**
   * Final check before the button will fire. The cascade already prevents a
   * mismatched pair, so this catches anything that arrived pre-filled from a
   * stored customer rather than chosen in this session.
   */
  const localCheck = hierarchy
    ? validateSelection(hierarchy, {
        region: formData.region,
        district: formData.district,
        subCounty: formData.subCounty,
        parish: formData.parish,
        village: formData.village,
      })
    : null;

  const isFormValid =
    formData.fullName.trim().length > 1 &&
    isValidUgandanPhone(formData.phone) &&
    formData.region !== '' &&
    formData.district !== '' &&
    formData.address.trim().length > 3 &&
    localCheck?.ok === true;

  const updateFormField = (field: keyof CustomerInfo, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    updateFormField('phone', e.target.value);
    setPhoneTouched(true);
  };

  const handleProceedToPayment = () => {
    if (!isFormValid) return;

    const phone = normalizeUgandanPhone(formData.phone);
    onProceedToPayment({
      ...formData,
      phone: phone ?? formData.phone,
      fullName: formData.fullName.trim(),
    });
  };

  /** Fills the form from a saved address. The cascade re-validates every level,
   *  so a stale address is corrected rather than silently submitted. */
  const applySavedAddress = (address: CustomerAddress) => {
    setFormData({
      fullName: address.fullName,
      phone: address.phone,
      region: address.region,
      district: address.district ?? '',
      subCounty: address.subCounty ?? '',
      parish: address.parish ?? '',
      village: address.village ?? '',
      address: address.address,
    });
    setPhoneTouched(false);
    setGeoError(null);
  };

  /**
   * Ask the device for a position, then let the server say which district it is
   * in. The result only ever fills region and district — the two levels we hold
   * boundaries for — and never types a finer area the buyer has not confirmed.
   */
  const useCurrentLocation = () => {
    if (locateState === 'locating') return;
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      setLocateState('unavailable');
      setLocateNote('This device will not share a location. Choose your area below.');
      return;
    }
    setLocateState('locating');
    setLocateNote(null);

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude, accuracy } = position.coords;
        const result = await reverseGeocode(latitude, longitude);
        if (result.state === 'found' && result.region) {
          setFormData((prev) => ({
            ...prev,
            region: result.region as string,
            district: result.district,
            // The outline only proves the district; clear anything finer so a
            // stale sub-county is not carried under a new location.
            subCounty: '',
            parish: '',
            village: '',
            lat: latitude,
            lng: longitude,
            accuracyM: Number.isFinite(accuracy) ? Math.round(accuracy) : undefined,
            locationSource: 'gps',
          }));
          setGeoError(null);
          setLocateState('found');
          setLocateNote(`Located in ${result.district}, ${result.region}. Check the finer areas below.`);
        } else if (result.state === 'rejected') {
          setLocateState('outside');
          setLocateNote(result.message);
        } else if (result.state === 'unreachable') {
          setLocateState('unavailable');
          setLocateNote('Could not reach the location service. Choose your area below.');
        } else {
          setLocateState('outside');
          setLocateNote('No mapped delivery area covers that point. Choose your area below.');
        }
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setLocateState('denied');
          setLocateNote('Location permission was declined. Choose your area below.');
        } else {
          setLocateState('unavailable');
          setLocateNote('Could not read your location right now. Choose your area below.');
        }
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 },
    );
  };

  return (
    <div className="relative flex h-full flex-col bg-white">
      <Header
        cartCount={cartCount}
        onBack={onBack}
        onMenuClick={onMenuClick}
      />
      
      {/* Step one of the checkout. The exported version pinned the dot at
          top-[174px] and the label at left-[72px] against a 393px canvas, so
          the pair could not move when the copy under it wrapped. */}
      <div className="shrink-0 px-6 pt-5">
        <div className="flex flex-col items-center gap-2">
          <div className="flex items-center gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-medium text-white">
              1
            </span>
            <h2 className="font-serif leading-tight text-brand text-display">Shipping</h2>
          </div>
          <p className="text-center text-base text-muted-foreground">
            Where in Uganda should we deliver?
          </p>
        </div>
        <div className="mt-4 h-px bg-neutral-200" />
      </div>
      
      {/* Form Fields */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="px-6 pb-6 pt-1">
          <div className="box-border content-stretch flex flex-col gap-2 items-start justify-start p-0 relative w-full">

            {/* Saved addresses fill the form in one tap; the fields stay editable. */}
            {savedAddresses.length > 0 && (
              <div className="w-full pb-1">
                <p className="font-normal text-[12px] text-muted-foreground pb-1">
                  Deliver to a saved address
                </p>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {savedAddresses.map((address) => (
                    <button
                      key={address.id}
                      type="button"
                      onClick={() => applySavedAddress(address)}
                      className="shrink-0 max-w-[180px] text-left border border-neutral-200 rounded-lg px-3 py-2 hover:border-brand transition-colors"
                    >
                      <span className="block font-medium text-[13px] text-black truncate">
                        {address.label}{address.isDefault ? ' · default' : ''}
                      </span>
                      <span className="block font-normal text-[11px] text-muted-foreground truncate">
                        {address.address}{address.district ? `, ${address.district}` : ''}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Full Name */}
            <FormField id="checkout-name" label="Full name">
              <Input
                id="checkout-name"
                value={formData.fullName}
                onChange={(e) => updateFormField('fullName', e.target.value)}
                placeholder="e.g. Namukasa Allen"
                autoComplete="name"
                className="bg-white border border-neutral-200 rounded-lg px-4 py-2 w-full font-normal text-[16px] text-black"
              />
            </FormField>

            {/* Phone */}
            <FormField id="checkout-phone" label="Phone number">
              <div className="w-full">
                <Input
                  id="checkout-phone"
                  value={formData.phone}
                  onChange={handlePhoneChange}
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="07XX XXX XXX"
                  className={`bg-white border rounded-lg px-4 py-2 w-full font-normal text-[16px] text-black ${
                    showPhoneError ? 'border-red-500' : 'border-neutral-200'
                  }`}
                  aria-invalid={showPhoneError}
                  aria-describedby={showPhoneError ? 'checkout-phone-error' : undefined}
                />
                {showPhoneError && (
                  <p id="checkout-phone-error" className="mt-1 text-red-500 text-[12px] font-normal">
                    Enter a Ugandan number, for example 0772 123 456
                  </p>
                )}
              </div>
            </FormField>

            {/* Administrative chain. GeoCascade enforces that a level can only
                be chosen after the level above it, and clears every level below
                whenever a parent changes. */}
            <div className="w-full">
              <button
                type="button"
                onClick={useCurrentLocation}
                disabled={locateState === 'locating'}
                className="inline-flex items-center gap-2 rounded-lg border border-brand bg-brand-soft px-3 py-2 text-[13px] font-medium text-brand-deep disabled:opacity-60"
              >
                <svg className="size-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 21s-6-5.2-6-9.9A6 6 0 1 1 18 11.1C18 15.8 12 21 12 21Z" />
                  <circle cx="12" cy="11" r="2.2" />
                </svg>
                {locateState === 'locating' ? 'Finding you…' : 'Use my current location'}
              </button>
              {locateNote && (
                <p
                  role="status"
                  aria-live="polite"
                  className={`mt-1.5 text-[12px] leading-[18px] font-normal ${
                    locateState === 'found'
                      ? 'text-brand-deep'
                      : locateState === 'denied' || locateState === 'unavailable' || locateState === 'outside'
                        ? 'text-amber-700'
                        : 'text-muted-foreground'
                  }`}
                >
                  {locateNote}
                </p>
              )}
              {locateState === 'found' && formData.lat != null && formData.lng != null && (
                <p className="mt-1 text-[11px] font-normal text-caption">
                  Pin at {formData.lat.toFixed(4)}, {formData.lng.toFixed(4)}
                  {formData.accuracyM != null ? ` · ±${formData.accuracyM} m` : ''}
                </p>
              )}
            </div>

            <GeoCascade
              hierarchy={hierarchy}
              value={{
                region: formData.region,
                district: formData.district,
                subCounty: formData.subCounty,
                parish: formData.parish,
                village: formData.village,
              }}
              onChange={(next) => {
                // A hand-picked area supersedes any pin from "current location",
                // so drop the stored point rather than keep a mismatched pair.
                setFormData((prev) => ({ ...prev, ...next, lat: undefined, lng: undefined, accuracyM: undefined, locationSource: undefined }));
                setGeoError(null);
                setLocateState('idle');
                setLocateNote(null);
              }}
              error={geoError}
            />

            {/* Delivery address */}
            <FormField id="checkout-address" label="Delivery address and landmark">
              <Input
                id="checkout-address"
                value={formData.address}
                onChange={(e) => updateFormField('address', e.target.value)}
                placeholder="Plot number, street and nearest landmark"
                autoComplete="street-address"
                className="bg-white border border-neutral-200 rounded-lg px-4 py-2 w-full font-normal text-[16px] text-black"
              />
            </FormField>

            <p className="pt-1 text-[12px] leading-[18px] font-normal text-muted-foreground">
              Our rider calls the number above before delivery. Orders to Kampala and Wakiso are
              delivered same day for orders placed before 4pm.
            </p>
          </div>
        </div>
      </div>
      
      {/* Footer */}
      <Footer 
        isFormValid={isFormValid}
        onProceedToPayment={handleProceedToPayment}
        errorMessage={errorMessage}
      />
    </div>
  );
}

interface FormFieldProps {
  id: string;
  label: string;
  children: React.ReactNode;
}

function FormField({ id, label, children }: FormFieldProps) {
  return (
    <div className="relative shrink-0 w-full">
      <div className="box-border content-stretch flex flex-col gap-1 items-start justify-start p-0 relative w-full">
        <label
          htmlFor={id}
          className="flex flex-col font-normal justify-center leading-[0] not-italic relative shrink-0 text-muted-foreground text-[14px] text-left tracking-[-0.14px] w-full"
        >
          <span className="block leading-[24px]">{label}</span>
        </label>
        {children}
      </div>
    </div>
  );
}



// The fake phone status bar (9:41 clock, Wi-Fi and battery glyphs, notch) used
// to be drawn here. It has been removed app-wide: on a real handset the OS
// already shows the true clock, signal and battery, so the mock only ever
// duplicated them and pushed content down. Screens now start at their own header.

interface HeaderProps {
  cartCount: number;
  onBack: () => void;
  onMenuClick: () => void;
}

function Header({ cartCount, onBack, onMenuClick }: HeaderProps) {
  return (
    <ScreenHeader
      title="Checkout"
      cartCount={cartCount}
      onMenuClick={onMenuClick}
      back={{ onClick: onBack }}
    />
  );
}

interface FooterProps {
  isFormValid: boolean;
  onProceedToPayment: () => void;
  errorMessage?: string | null;
}

function Footer({ isFormValid, onProceedToPayment, errorMessage }: FooterProps) {
  return (
    <div className="shrink-0 border-t border-neutral-200 bg-white px-6 py-4">
      {errorMessage && (
        <p
          role="alert"
          className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] font-normal leading-[18px] text-red-700"
        >
          {errorMessage}
        </p>
      )}
      <button
        onClick={onProceedToPayment}
        disabled={!isFormValid}
        aria-disabled={!isFormValid}
        className={`flex w-full items-center justify-between rounded-lg py-3 pl-6 pr-3 ${
          isFormValid ? 'cursor-pointer bg-brand text-white' : 'cursor-not-allowed bg-neutral-200 text-neutral-500'
        }`}
      >
        <span className="text-base leading-relaxed">Proceed to payment</span>
        <span className="size-8 shrink-0">
          <svg className="block size-full" fill="none" viewBox="0 0 32 32">
            <path d={svgPaths.p3d7c1f80} fill="currentColor" />
          </svg>
        </span>
      </button>
    </div>
  );
}