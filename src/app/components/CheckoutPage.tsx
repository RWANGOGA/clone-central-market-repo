import React, { useState, useEffect } from 'react';
import svgPaths from "../imports/svg-toln6of0ig";
import { Input } from './ui/input';
import GeoCascade from './GeoCascade';
import { isValidUgandanPhone, normalizeUgandanPhone } from '../lib/uganda';
import { fetchHierarchy, validateSelection, type GeoNode } from '../lib/geoApi';
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
}

export default function CheckoutPage({ cartCount, customerInfo, signedIn = false, onBack, onMenuClick, onProceedToPayment }: CheckoutPageProps) {
  const [formData, setFormData] = useState<CustomerInfo>(customerInfo);
  const [hierarchy, setHierarchy] = useState<GeoNode[] | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [phoneTouched, setPhoneTouched] = useState(false);
  const [savedAddresses, setSavedAddresses] = useState<CustomerAddress[]>([]);

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

  return (
    <div className="relative flex h-full flex-col bg-white">
      {/* Status Bar */}
      <StatusBar />
      
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
                setFormData((prev) => ({ ...prev, ...next }));
                setGeoError(null);
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
}

function Footer({ isFormValid, onProceedToPayment }: FooterProps) {
  return (
    <div className="shrink-0 border-t border-neutral-200 bg-white px-6 py-4">
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