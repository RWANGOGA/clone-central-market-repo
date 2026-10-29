import React, { useState } from 'react';
import StatusBar from './shared/StatusBar';
import { isValidUgandanPhone, normalizeUgandanPhone } from '../lib/uganda';
import { apiUrl } from '../lib/apiBase';
import type { CustomerSession } from '../lib/authProvider';

interface SignupPageProps {
  onBack: () => void;
  /** Called with the new account: signing up signs you straight in. */
  onSignup: (customer: CustomerSession) => void;
  onNavigateToLogin: () => void;
}

export default function SignupPage({ onBack, onSignup, onNavigateToLogin }: SignupPageProps) {
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [region, setRegion] = useState('');
  const [district, setDistrict] = useState('');
  const [address, setAddress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const phoneTouched = phone.length > 0;
  const phoneValid = isValidUgandanPhone(phone);
  const passwordMatch = password === confirmPassword && confirmPassword.length > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    if (!phoneValid) {
      setError('Please enter a valid Ugandan phone number');
      setLoading(false);
      return;
    }

    if (!email.trim()) {
      setError('Enter an email address. It is how we reach you if there is a problem with an order.');
      setLoading(false);
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      setLoading(false);
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      setLoading(false);
      return;
    }

    try {
      const res = await fetch(apiUrl('/api/customers/signup'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName,
          phone: normalizeUgandanPhone(phone),
          email: email.trim(),
          password,
          region,
          district: district || undefined,
          address,
        }),
        credentials: 'include',
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Signup failed');
        return;
      }

      onSignup(data.data);
    } catch {
      setError('Could not connect to the server');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white relative size-full select-none">
      <StatusBar />

      <div className="absolute bg-white h-[149px] left-0 right-0 top-0 z-10">
        <div className="absolute border-[0px_0px_1px] border-neutral-200 border-solid inset-0 pointer-events-none shadow-[0px_0px_20px_0px_rgba(0,0,0,0.1)]" />

        <div className="absolute bg-white h-16 left-0 overflow-clip right-0 top-[31px]">
          <div className="absolute bg-white h-[66px] left-0 top-0 w-[393px]" />
          <div
            className="absolute flex flex-col font-serif font-medium justify-center leading-[0] text-brand text-[24px] text-center text-nowrap top-9 tracking-[-0.24px] translate-x-[-50%] translate-y-[-50%]"
            style={{ left: "calc(50% - 0.5px)" }}
          >
            <p className="block leading-none whitespace-pre text-[24px]">Mu Katale</p>
          </div>
        </div>
      </div>

      <div className="absolute left-0 right-0 top-[149px] bottom-0 overflow-y-auto">
        <div className="px-6 pt-6 pb-10 space-y-5">
          <div>
            <h1 className="font-serif font-normal text-[28px] text-black leading-tight">
              Create account
            </h1>
            <p className="font-normal text-[14px] text-muted-foreground mt-1">
              Join Mu Katale for fresh market delivery
            </p>
          </div>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-[13px] text-red-700 text-center">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-[12px] text-muted-foreground block mb-1 font-normal">
                Full name
              </label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Your name"
                className="w-full px-4 py-3 border border-neutral-200 rounded-xl text-[15px]"
                required
              />
            </div>

            <div>
              <label className="text-[12px] text-muted-foreground block mb-1 font-normal">
                Phone number
              </label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="07XX XXX XXX"
                className={`w-full px-4 py-3 border rounded-xl text-[15px] ${
                  phoneTouched && !phoneValid ? 'border-red-300 bg-red-50' : 'border-neutral-200'
                }`}
                required
              />
              {phoneTouched && !phoneValid && (
                <p className="text-[12px] text-red-600 mt-1">Enter a valid Ugandan number (07XX XXX XXX)</p>
              )}
            </div>

            <div>
              <label className="text-[12px] text-muted-foreground block mb-1 font-normal">
                Email address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full px-4 py-3 border border-neutral-200 rounded-xl text-[15px]"
                required
              />
              <p className="text-[12px] text-caption mt-1">
                We use this to tell you about your orders. Your phone number is what you sign in with, so keep it
                correct.
              </p>
            </div>

            <div>
              <label className="text-[12px] text-muted-foreground block mb-1 font-normal">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  className="w-full px-4 py-3 pr-12 border border-neutral-200 rounded-xl text-[15px]"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-brand transition-colors"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.292 4.292M3 3l18 18" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.543 7-1.275 4.057-5.065 7-9.543 7-4.478 0-8.268-2.943-9.543-7z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            <div>
              <label className="text-[12px] text-muted-foreground block mb-1 font-normal">
                Confirm password
              </label>
              <div className="relative">
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repeat your password"
                  className={`w-full px-4 py-3 pr-12 border rounded-xl text-[15px] ${
                    confirmPassword.length > 0 && !passwordMatch ? 'border-red-300 bg-red-50' : 'border-neutral-200'
                  }`}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-brand transition-colors"
                  aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                >
                  {showConfirmPassword ? (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.292 4.292M3 3l18 18" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.543 7-1.275 4.057-5.065 7-9.543 7-4.478 0-8.268-2.943-9.543-7z" />
                    </svg>
                  )}
                </button>
              </div>
              {confirmPassword.length > 0 && !passwordMatch && (
                <p className="text-[12px] text-red-600 mt-1">Passwords do not match</p>
              )}
            </div>

            <div>
              <label className="text-[12px] text-muted-foreground block mb-1 font-normal">
                Region
              </label>
              <select
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                className="w-full px-4 py-3 border border-neutral-200 rounded-xl text-[15px] bg-white"
                required
              >
                <option value="">Select region</option>
                <option value="Central Region">Central Region</option>
                <option value="Eastern Region">Eastern Region</option>
                <option value="Northern Region">Northern Region</option>
                <option value="Western Region">Western Region</option>
              </select>
            </div>

            <div>
              <label className="text-[12px] text-muted-foreground block mb-1 font-normal">
                District / Town
              </label>
              <input
                type="text"
                value={district}
                onChange={(e) => setDistrict(e.target.value)}
                placeholder="e.g. Kampala"
                className="w-full px-4 py-3 border border-neutral-200 rounded-xl text-[15px]"
                required
              />
            </div>

            <div>
              <label className="text-[12px] text-muted-foreground block mb-1 font-normal">
                Delivery address
              </label>
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Street, building, landmark"
                className="w-full px-4 py-3 border border-neutral-200 rounded-xl text-[15px]"
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-brand text-white font-medium text-[15px] py-3.5 rounded-xl hover:bg-[#355a19] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Creating account...' : 'Create Account'}
            </button>
          </form>

          <div className="text-center">
            <button
              onClick={onNavigateToLogin}
              className="text-brand font-normal text-[14px] hover:underline"
            >
              Already have an account? Sign in
            </button>
          </div>

          <div className="text-center">
            <button
              onClick={onBack}
              className="text-muted-foreground font-normal text-[13px] hover:text-black"
            >
              ← Back to shop
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
