import React, { useEffect, useState } from 'react';
import { currentAdmin, signIn, type AdminIdentity } from '../lib/adminApi';

interface AdminGateProps {
  onSignedIn: (admin: AdminIdentity) => void;
}

/**
 * Staff sign-in.
 *
 * The session is an HttpOnly cookie the browser manages, so there is no token
 * held in JavaScript here. Only the caller's own account is affected by a
 * successful sign-in.
 */
export default function AdminGate({ onSignedIn }: AdminGateProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // An existing session should not have to sign in again.
  useEffect(() => {
    let cancelled = false;
    currentAdmin().then((admin) => {
      if (!cancelled && admin) onSignedIn(admin);
    });
    return () => {
      cancelled = true;
    };
  }, [onSignedIn]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;

    setBusy(true);
    setError(null);

    const result = await signIn(email, password);

    setBusy(false);

    if (!result) {
      setError('Could not reach the service. Start the API with npm run dev --prefix api.');
      return;
    }
    if (!result.ok) {
      setError(result.error);
      return;
    }

    setPassword('');
    onSignedIn(result.data);
  };

  return (
    <div className="bg-white relative size-full">
      <div className="absolute inset-0 flex items-center justify-center px-6">
        <form onSubmit={submit} className="w-full max-w-[320px] space-y-4">
          <div>
            <h1 className="font-serif font-medium text-[24px] text-brand leading-[32px]">
              Staff sign in
            </h1>
            <p className="mt-1 text-[13px] leading-[20px] font-normal text-muted-foreground">
              Manage the catalogue and stock levels.
            </p>
          </div>

          <div className="space-y-1">
            <label className="block text-[13px] font-normal text-muted-foreground">
              Email
            </label>
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@market.ug"
              className="w-full border border-neutral-200 rounded-lg px-4 py-2.5 text-[16px] font-normal"
            />
          </div>

          <div className="space-y-1">
            <label className="block text-[13px] font-normal text-muted-foreground">
              Password
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Your password"
                className="w-full border border-neutral-200 rounded-lg px-4 py-2.5 pr-10 text-[16px] font-normal"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-brand transition-colors"
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

          {error && (
            <p className="text-[13px] leading-[19px] font-normal text-red-600">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy || !email || !password}
            className={`w-full rounded-lg py-3 text-[15px] font-medium text-white ${
              busy || !email || !password ? 'bg-neutral-300 cursor-not-allowed' : 'bg-brand'
            }`}
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>

          <p className="text-[11px] leading-[16px] font-normal text-caption">
            Accounts are created by an owner with <code>npm run db:seed:admin</code>. There is no
            default account.
          </p>
        </form>
      </div>
    </div>
  );
}