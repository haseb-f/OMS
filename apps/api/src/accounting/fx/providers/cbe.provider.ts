import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import {
  CBE_ENGLISH_LABELS,
  parseCbeHistorical,
  parseCbeHistoricalForm,
  parseCbeLatest,
  toCbeDate,
  type CbeParsed,
} from './cbe-parser';
import {
  FxProviderError,
  type FxProviderResult,
  type FxRateProvider,
} from './fx-provider.types';

const ORIGIN = 'https://www.cbe.org.eg';
export const CBE_LATEST_URL = `${ORIGIN}/en/economic-research/statistics/cbe-exchange-rates`;
export const CBE_HISTORICAL_FORM_URL = `${CBE_LATEST_URL}/historical-data`;

/** The site sits behind an F5 WAF that rejects non-browser clients (research §3.9). */
const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

/** Must stay well inside the 60 s Vercel function limit, retries included. */
const REQUEST_TIMEOUT_MS = 10_000;
/** A CBE page is ~200 KB; anything far larger is not the page we expect. */
export const CBE_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
/** Redirects are followed manually (host-pinned), at most this many. */
const MAX_REDIRECTS = 3;

/**
 * Only https URLs on cbe.org.eg (or a subdomain) are ever requested, so a
 * redirect or a scraped form action can never send the request — or the
 * session cookie — to another host.
 */
export function isAllowedCbeUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return (
      url.protocol === 'https:' &&
      (host === 'cbe.org.eg' || host.endsWith('.cbe.org.eg'))
    );
  } catch {
    return false;
  }
}

/** Reads a response body as text, aborting once it exceeds `maxBytes`. */
export async function readBodyCapped(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new FxProviderError(
      `CBE response is ${declared} bytes — larger than the ${maxBytes}-byte limit.`,
      'VALIDATION',
    );
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new FxProviderError(
        `CBE response exceeded the ${maxBytes}-byte limit — aborted.`,
        'VALIDATION',
      );
    }
    parts.push(value);
  }
  return Buffer.concat(parts).toString('utf8');
}
/** Polite pause between the historical GET and POST (≤ 2–3 requests per run). */
const POLITE_DELAY_MS = 1_500;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Central Bank of Egypt official exchange rates — the only official daily
 * EGP publisher (see fx-source-research.md). Public, no credentials. Rates
 * are EGP per 1 unit (JPY per 100), Buy + Sell, Egyptian business days only.
 */
@Injectable()
export class CbeFxProvider implements FxRateProvider {
  readonly name = 'CBE';
  private readonly logger = new Logger(CbeFxProvider.name);

  async fetchLatest(): Promise<FxProviderResult> {
    const { body } = await this.request(CBE_LATEST_URL);
    return this.toResult(parseCbeLatest(body), body, CBE_LATEST_URL);
  }

  /**
   * Backfill/gap repair via the historical endpoint: GET the form (token +
   * cookie + CMS ids, scraped every time), then ONE POST for the range and
   * all 18 labels. Two requests per call, never more.
   */
  async fetchHistorical(
    dateFrom: string,
    dateTo: string,
  ): Promise<FxProviderResult> {
    const formPage = await this.request(CBE_HISTORICAL_FORM_URL);
    const form = parseCbeHistoricalForm(formPage.body);
    await sleep(POLITE_DELAY_MS);
    const payload = new URLSearchParams();
    for (const [name, value] of Object.entries(form.fields)) {
      payload.append(name, value);
    }
    payload.set('FromDateRaw', toCbeDate(dateFrom));
    payload.set('ToDateRaw', toCbeDate(dateTo));
    for (const label of CBE_ENGLISH_LABELS) {
      payload.append('SelectedSelectOptions', label);
    }
    payload.set('SubmitAction', '1'); // 1 = HTML fragment
    const url = new URL(form.action, ORIGIN).toString();
    if (!isAllowedCbeUrl(url)) {
      throw new FxProviderError(
        `CBE historical form posts to an unexpected host (${new URL(url).host}) — refusing to send it.`,
        'VALIDATION',
      );
    }
    const { body } = await this.request(url, {
      method: 'POST',
      body: payload.toString(),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: ORIGIN,
        Referer: CBE_HISTORICAL_FORM_URL,
        ...(formPage.cookie ? { Cookie: formPage.cookie } : {}),
      },
    });
    return this.toResult(parseCbeHistorical(body), body, url);
  }

  private toResult(
    parsed: CbeParsed,
    raw: string,
    sourceUrl: string,
  ): FxProviderResult {
    return {
      provider: this.name,
      quoteCurrency: 'EGP',
      effectiveDates: parsed.effectiveDates,
      // CBE publishes the rate date only — no time of day is documented.
      sourceTimestamp: null,
      fetchedAt: new Date(),
      quotes: parsed.quotes,
      warnings: parsed.warnings,
      rawHash: createHash('sha256').update(raw).digest('hex'),
      sourceUrl,
    };
  }

  /**
   * One GET/POST with a timeout, a 2 MB body cap and a single back-off retry
   * on transient failures (never on a WAF block). Redirects are followed by
   * hand and only to cbe.org.eg, so cookies never leave that host.
   */
  private async request(
    url: string,
    init: {
      method?: string;
      body?: string;
      headers?: Record<string, string>;
    } = {},
  ): Promise<{ body: string; cookie: string | null }> {
    let lastError: FxProviderError | null = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (attempt > 0) await sleep(2_000);
      try {
        const response = await this.fetchPinned(url, init);
        const body = await readBodyCapped(response, CBE_MAX_RESPONSE_BYTES);
        if (
          response.status === 403 ||
          /Request Rejected/i.test(body.slice(0, 2000))
        ) {
          // Do not retry: the WAF escalates per session/IP.
          throw new FxProviderError(
            `CBE blocked the request (HTTP ${response.status}). The site's bot protection rejected this server; try again later or record the rate manually.`,
            'BLOCKED',
          );
        }
        if (!response.ok) {
          lastError = new FxProviderError(
            `CBE returned HTTP ${response.status}.`,
            'HTTP',
          );
          if (response.status >= 500) continue;
          throw lastError;
        }
        const setCookie =
          typeof response.headers.getSetCookie === 'function'
            ? response.headers.getSetCookie()
            : [];
        const cookie = setCookie.length
          ? setCookie.map((c) => c.split(';')[0]).join('; ')
          : null;
        return { body, cookie };
      } catch (error) {
        // Blocks and 4xx are final; only 5xx (above) and network errors retry.
        if (error instanceof FxProviderError) throw error;
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`CBE request failed (${url}): ${message}`);
        lastError = new FxProviderError(
          `Could not reach CBE: ${message}`,
          'NETWORK',
        );
      }
    }
    throw lastError ?? new FxProviderError('CBE request failed.', 'NETWORK');
  }

  /** fetch with `redirect: 'manual'`, following at most MAX_REDIRECTS hops inside cbe.org.eg. */
  private async fetchPinned(
    url: string,
    init: {
      method?: string;
      body?: string;
      headers?: Record<string, string>;
    },
  ): Promise<Response> {
    let target = url;
    let method = init.method ?? 'GET';
    let body = init.body;
    const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      if (!isAllowedCbeUrl(target)) {
        throw new FxProviderError(
          `Refusing to contact ${target}: only https://*.cbe.org.eg is allowed.`,
          'VALIDATION',
        );
      }
      const response = await fetch(target, {
        method,
        body,
        headers: { ...BROWSER_HEADERS, ...init.headers },
        redirect: 'manual',
        signal,
      });
      const location = response.headers.get('location');
      if (response.status < 300 || response.status >= 400 || !location) {
        return response;
      }
      await response.body?.cancel().catch(() => undefined);
      target = new URL(location, target).toString();
      if (response.status === 303 || method === 'POST') {
        // Browser semantics: a redirected form POST continues as a GET.
        method = 'GET';
        body = undefined;
      }
    }
    throw new FxProviderError('CBE redirected too many times.', 'NETWORK');
  }
}
