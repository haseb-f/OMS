import {
  CBE_LATEST_URL,
  CbeFxProvider,
  isAllowedCbeUrl,
  readBodyCapped,
} from './cbe.provider';
import { FxProviderError } from './fx-provider.types';
import { withDeadline } from '../fx-sync.service';

const href = (url: string | URL | Request) =>
  typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;

/**
 * FIX-PDR L5 — the CBE adapter only ever talks to https://*.cbe.org.eg
 * (redirects followed by hand, host-pinned), caps the response body, and a
 * run is bounded by a deadline. No network: `fetch` is stubbed.
 */
describe('CBE provider hardening', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('allows only https cbe.org.eg hosts', () => {
    expect(isAllowedCbeUrl(CBE_LATEST_URL)).toBe(true);
    expect(isAllowedCbeUrl('https://cbe.org.eg/x')).toBe(true);
    expect(isAllowedCbeUrl('http://www.cbe.org.eg/x')).toBe(false);
    expect(isAllowedCbeUrl('https://evil.com/?www.cbe.org.eg')).toBe(false);
    expect(isAllowedCbeUrl('https://cbe.org.eg.evil.com/')).toBe(false);
    expect(isAllowedCbeUrl('https://notcbe.org.eg/')).toBe(false);
    expect(isAllowedCbeUrl('not a url')).toBe(false);
  });

  it('reads a small body and aborts one larger than the cap', async () => {
    await expect(readBodyCapped(new Response('hello'), 10)).resolves.toBe(
      'hello',
    );
    await expect(
      readBodyCapped(new Response('x'.repeat(64)), 10),
    ).rejects.toBeInstanceOf(FxProviderError);
    const declared = new Response('small', {
      headers: { 'content-length': String(50 * 1024 * 1024) },
    });
    await expect(readBodyCapped(declared, 1024)).rejects.toThrow(/larger than/);
  });

  it('never follows a redirect off cbe.org.eg (and never sends cookies there)', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    global.fetch = jest.fn(
      (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: href(url), init: init ?? {} });
        return Promise.resolve(
          new Response(null, {
            status: 302,
            headers: { location: 'https://attacker.example/steal' },
          }),
        );
      },
    ) as typeof fetch;
    await expect(new CbeFxProvider().fetchLatest()).rejects.toThrow(
      /only https:\/\/\*\.cbe\.org\.eg/,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].init.redirect).toBe('manual');
  });

  it('follows a same-host redirect manually', async () => {
    const urls: string[] = [];
    global.fetch = jest.fn((url: string | URL | Request) => {
      urls.push(href(url));
      if (urls.length === 1) {
        return Promise.resolve(
          new Response(null, {
            status: 301,
            headers: { location: '/en/moved' },
          }),
        );
      }
      return Promise.resolve(new Response('<html>no rates</html>'));
    }) as typeof fetch;
    // The page has no table, so parsing fails — but only after the pinned hop.
    await expect(new CbeFxProvider().fetchLatest()).rejects.toBeInstanceOf(
      FxProviderError,
    );
    expect(urls).toEqual([CBE_LATEST_URL, 'https://www.cbe.org.eg/en/moved']);
  });

  it('withDeadline rejects a run that outlives its budget', async () => {
    await expect(withDeadline(Promise.resolve(1), 50)).resolves.toBe(1);
    await expect(
      withDeadline(new Promise(() => undefined), 20),
    ).rejects.toThrow(/did not finish within/);
  });
});
