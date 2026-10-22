import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The module reads WEB_ORIGINS while it loads, so each case sets the variable
 * and imports it fresh rather than mutating one shared instance.
 */
async function loadWith(value: string | undefined) {
  vi.resetModules();
  if (value === undefined) delete process.env.WEB_ORIGINS;
  else process.env.WEB_ORIGINS = value;
  return import('./webOrigins');
}

afterEach(() => {
  delete process.env.WEB_ORIGINS;
});

describe('cross-site API access', () => {
  it('keeps cookies first party when no front end is listed', async () => {
    const mod = await loadWith(undefined);

    expect(mod.crossSite).toBe(false);
    expect(mod.cookieAttributes()).toContain('SameSite=Strict');
    expect(mod.cookieAttributes()).not.toContain('SameSite=None');
    expect(mod.corsHeaders('https://rwangoga.github.io')).toEqual({});
  });

  it('moves cookies to None plus Secure for a listed front end', async () => {
    const mod = await loadWith('https://rwangoga.github.io');

    expect(mod.crossSite).toBe(true);
    // A cross-site fetch carries nothing else, and a browser only stores None
    // over https — so enabling one enables the other.
    expect(mod.cookieAttributes()).toBe('SameSite=None; Secure');
  });

  it('answers only the origins it was told about', async () => {
    const mod = await loadWith('https://rwangoga.github.io, http://localhost:3000');

    expect(mod.corsHeaders('https://rwangoga.github.io')['Access-Control-Allow-Origin']).toBe(
      'https://rwangoga.github.io',
    );
    // Credentials cannot be shared with a wildcard, so an unlisted site gets no
    // CORS headers at all rather than a permissive one.
    expect(mod.corsHeaders('https://evil.example')['Access-Control-Allow-Origin']).toBeUndefined();
    expect(mod.preflightResponse('https://evil.example')).toBeNull();

    const preflight = mod.preflightResponse('https://rwangoga.github.io');
    expect(preflight?.status).toBe(204);
    expect(preflight?.headers.get('access-control-allow-credentials')).toBe('true');
  });

  it('tolerates a trailing slash and stray spaces in the list', async () => {
    const mod = await loadWith(' https://rwangoga.github.io/ , ');

    expect(mod.isWebOrigin('https://rwangoga.github.io')).toBe(true);
    expect(mod.isWebOrigin('https://rwangoga.github.io/')).toBe(true);
    expect(mod.isWebOrigin(null)).toBe(false);
  });
});
