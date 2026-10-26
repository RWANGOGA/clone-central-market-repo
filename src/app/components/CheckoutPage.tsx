import React, { useState, useEffect } from 'react';
import svgPaths from "../imports/svg-toln6of0ig";
import { Input } from './ui/input';
import GeoCascade from './GeoCascade';
import { isValidUgandanPhone, normalizeUgandanPhone } from '../lib/uganda';
import { fetchHierarchy, validateSelection, type GeoNode } from '../lib/geoApi';
import { fetchCustomerAddresses, type CustomerAddress } from '../lib/customerApi';

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
    <div className="bg-[#ffffff] relative size-full">
      {/* Status Bar */}
      <StatusBar />
      
      {/* Header */}
      <Header 
        cartCount={cartCount}
        onBack={onBack}
        onMenuClick={onMenuClick}
      />
      
      {/* Progress Indicators */}
      <ProgressIndicators />
      
      {/* Divider Line */}
      <div className="absolute h-0 left-6 right-6 top-[222px]">
        <div className="absolute bottom-0 left-0 right-0 top-[-1px]">
          <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 327 1">
            <line stroke="var(--stroke-0, #E5E5E5)" x2="327" y1="0.5" y2="0.5" />
          </svg>
        </div>
      </div>
      
      {/* Shipping Label */}
      <div className="absolute flex flex-col font-serif font-normal justify-center leading-[0] left-[72px] text-brand text-[24px] text-left top-[190px] tracking-[-0.48px] translate-y-[-50%] w-[138.5px]">
        <p className="block leading-[32px] text-[24px]">Shipping</p>
      </div>
      
      {/* Shipping Description */}
      <div className="absolute flex flex-col font-normal justify-center leading-[0] left-6 not-italic text-[#000000] text-[16px] text-left text-nowrap top-[258px] translate-y-[-50%]">
        <p className="block leading-[1.5] whitespace-pre text-[16px]">
          Where in Uganda should we deliver?
        </p>
      </div>
      
{/* Form Fields */}
      <div className="absolute left-0 right-0 top-[286px] bottom-[124px] overflow-y-auto">
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
                      <span className="block font-medium text-[13px] text-[#000000] truncate">
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
            <FormField label="Full name">
              <Input
                value={formData.fullName}
                onChange={(e) => updateFormField('fullName', e.target.value)}
                placeholder="e.g. Namukasa Allen"
                autoComplete="name"
                className="bg-[#ffffff] border border-neutral-200 rounded-lg px-4 py-2 w-full font-normal text-[16px] text-[#000000]"
              />
            </FormField>

            {/* Phone */}
            <FormField label="Phone number">
              <div className="w-full">
                <Input
                  value={formData.phone}
                  onChange={handlePhoneChange}
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="07XX XXX XXX"
                  className={`bg-[#ffffff] border rounded-lg px-4 py-2 w-full font-normal text-[16px] text-[#000000] ${
                    showPhoneError ? 'border-red-500' : 'border-neutral-200'
                  }`}
                />
                {showPhoneError && (
                  <p className="mt-1 text-red-500 text-[12px] font-normal">
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
            <FormField label="Delivery address and landmark">
              <Input
                value={formData.address}
                onChange={(e) => updateFormField('address', e.target.value)}
                placeholder="Plot number, street and nearest landmark"
                autoComplete="street-address"
                className="bg-[#ffffff] border border-neutral-200 rounded-lg px-4 py-2 w-full font-normal text-[16px] text-[#000000]"
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
  label: string;
  children: React.ReactNode;
}

function FormField({ label, children }: FormFieldProps) {
  return (
    <div className="relative shrink-0 w-full">
      <div className="box-border content-stretch flex flex-col gap-1 items-start justify-start p-0 relative w-full">
        <div className="flex flex-col font-normal justify-center leading-[0] not-italic relative shrink-0 text-muted-foreground text-[14px] text-left tracking-[-0.14px] w-full">
          <p className="block leading-[24px]">{label}</p>
        </div>
        {children}
      </div>
    </div>
  );
}

function ProgressIndicators() {
  return (
    <>
      {/* Step 1 - Active */}
      <div className="absolute left-6 top-[174px] size-8">
        <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 32 32">
          <circle cx="16" cy="16" fill="var(--fill-0, #426B1F)" r="16" />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="font-normal text-[#ffffff] text-[16px] leading-none">1</span>
        </div>
      </div>
      
      {/* Step 2 - Inactive */}
      <div className="absolute size-8 top-[174px]" style={{ left: "calc(50% + 93.5px)" }}>
        <svg fill="none" preserveAspectRatio="none" viewBox="0 0 32 32" className="block size-full">
          <circle cx="16" cy="16" fill="var(--fill-0, #757575)" r="16" />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="font-normal text-[#ffffff] text-[16px] leading-none">2</span>
        </div>
      </div>
      
      {/* Step 3 - Inactive */}
      <div className="absolute size-8 top-[174px]" style={{ left: "calc(50% + 131.5px)" }}>
        <svg fill="none" preserveAspectRatio="none" viewBox="0 0 32 32" className="block size-full">
          <circle cx="16" cy="16" fill="var(--fill-0, #757575)" r="16" />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="font-normal text-[#ffffff] text-[16px] leading-none">3</span>
        </div>
      </div>
    </>
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
        <div className="absolute font-bold h-5 leading-[0] left-[27px] not-italic text-[#000000] text-[17px] text-center top-px tracking-[-0.408px] translate-x-[-50%] w-[54px]">
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
    <div className="absolute bg-[#ffffff] h-[149px] left-0 right-0 top-0">
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
                  <div className="flex flex-col font-medium justify-center leading-[0] not-italic relative shrink-0 text-[#ffffff] text-[12px] text-center text-nowrap tracking-[-0.12px]">
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
              <div className="basis-0 flex flex-col font-serif font-normal grow justify-center min-h-px min-w-px relative shrink-0 text-[#000000] text-[24px] tracking-[-0.48px]">
                <p className="block leading-[32px] text-[24px]">Checkout</p>
              </div>
              <button 
                onClick={onBack}
                className="cursor-pointer flex items-center font-normal not-italic relative shrink-0 text-brand text-[14px] text-nowrap tracking-[-0.14px]"
              >
                <div className="flex flex-row items-center gap-2">
                  <div className="w-3 h-3">
                    <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 12 12">
                      <path d="M7.5 9L4.5 6L7.5 3" stroke="#426b1f" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                  <p className="block leading-[24px] whitespace-pre">Back</p>
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
  isFormValid: boolean;
  onProceedToPayment: () => void;
}

function Footer({ isFormValid, onProceedToPayment }: FooterProps) {
  return (
    <div className="absolute bg-[#ffffff] bottom-0 h-[124px] left-0 overflow-clip right-0 shadow-[0px_0px_20px_0px_rgba(0,0,0,0.1)]">
      {/* Proceed to Payment Button */}
      <button
        onClick={isFormValid ? onProceedToPayment : undefined}
        disabled={!isFormValid}
        className={`absolute left-6 right-6 rounded-lg top-6 ${
          isFormValid ? 'bg-brand cursor-pointer' : 'bg-neutral-200 cursor-not-allowed'
        }`}
      >
        <div className="flex flex-row items-center relative size-full">
          <div className="box-border content-stretch flex flex-row gap-2 items-center justify-start pl-6 pr-4 py-2 relative w-full">
            <div className="basis-0 flex flex-col font-normal grow justify-center leading-[0] min-h-px min-w-px not-italic relative shrink-0 text-[#ffffff] text-[16px] text-left tracking-[-0.16px]">
              <p className="block leading-[24px]">Proceed to payment</p>
            </div>
            <div className="size-8 relative shrink-0">
              <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 32 32">
                <g>
                  <path d={svgPaths.p3d7c1f80} fill="var(--fill-0, white)" />
                </g>
              </svg>
            </div>
          </div>
        </div>
      </button>
    </div>
  );
}