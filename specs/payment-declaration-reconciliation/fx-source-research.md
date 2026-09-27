# FX-R — Official EGP exchange-rate source research

Date of research: 2026-09-27 (Sunday, ~07:45 Cairo / 04:45 UTC). Base (functional) currency: EGP.
Canonical convention for OMS: **1 FOREIGN = X EGP**.

Everything below was observed by fetching the cited URL during this research. Nothing here is taken
from vendor marketing; third-party "CBE APIs" (Apify, Fluentax, Fexant) turned up in search, but they
are scrapers of the same CBE page and were **not** evaluated as sources.

---

## 1. Summary

- **No official source publishes EGP rates through a documented API.** CBE has no JSON/XML feed or API docs.
  It does serve an HTML table and a historical query endpoint that can export to **Excel (.xlsx)**, HTML or PDF.
- **Only CBE covers EGP daily.** ECB, IMF (representative and SDR tables), US Fed H.10 and the World Bank all
  **exclude EGP**, or cover it annually only. So an "official cross-rate" secondary cannot be built: every
  EGP leg would itself have to come from CBE.
- **Recommendation:** make the **CBE "Official Exchange Rates" page the primary source**, fetched from a daily
  cron by a strict-schema HTML parser. Use the **historical-data endpoint for backfill and gap repair**.
  Fall back to **manual entry with an audit trail**. Fail closed when no rate is available.

---

## 2. Comparison table

| Source                                                                                  | EGP?                             | Coverage of USD/EUR/SAR/AED/GBP/KWD                | Convention                                                | Frequency / time                                                                    | History                                                    | Format / access                                                        | Auth                                              | Terms                                                   | Verdict                                                                                                                                |
| --------------------------------------------------------------------------------------- | -------------------------------- | -------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **CBE Official Exchange Rates** (`/en/economic-research/statistics/cbe-exchange-rates`) | Yes (base)                       | **All 6** + 12 more (18 total)                     | EGP per 1 unit (JPY per **100**); Buy + Sell              | Egyptian business days only (Sun–Thu, no bank holidays); time of day not documented | Yes, via historical endpoint (verified back to 2020-01-02) | HTML; historical POST → HTML fragment / **.xlsx** / PDF; behind F5 WAF | None (anti-forgery token + cookie for historical) | Copyright CBE; reuse allowed **with citation** (see §8) | **Primary**                                                                                                                            |
| CBE "Average Market Rate in EGP" (`/en/economic-research/statistics/exchange-rates`)    | Yes                              | USD, EUR, GBP, CHF, JPY100, SAR, KWD, AED, CNY (9) | EGP per unit; Buy + Sell                                  | Same days                                                                           | Has a historical-data link                                 | HTML                                                                   | None                                              | Same                                                    | Informational only; a different series (interbank average), not the official rate                                                      |
| ECB euro reference rates (`eurofxref-daily.xml`)                                        | **No**                           | none for EGP (29 currencies, no EGP/SAR/AED/KWD)   | per 1 EUR                                                 | Daily (TARGET days)                                                                 | Yes                                                        | XML                                                                    | None                                              | Free                                                    | Not usable for EGP                                                                                                                     |
| IMF representative rates (`rms_mth.aspx … reportType=REP`)                              | **No**                           | SAR, AED, KWD are present; EGP is not              | Mostly per 1 USD; EUR/GBP/AUD are inverted (USD per unit) | Daily in monthly tables                                                             | Yes                                                        | HTML + TSV                                                             | None                                              | IMF                                                     | Not usable for EGP                                                                                                                     |
| IMF SDR valuation (`reportType=SDRCV`)                                                  | **No**                           | EGP not present                                    | per SDR                                                   | Daily                                                                               | Yes                                                        | HTML/TSV                                                               | None                                              | IMF                                                     | Not usable                                                                                                                             |
| US Federal Reserve H.10                                                                 | **No**                           | Egypt not covered                                  | per USD                                                   | Weekly release                                                                      | Yes                                                        | HTML/CSV                                                               | None                                              | Public domain                                           | Not usable                                                                                                                             |
| World Bank `PA.NUS.FCRF`                                                                | Yes, annual only                 | USD only                                           | LCU per USD, **annual average**                           | Annual                                                                              | Yes                                                        | JSON API                                                               | None                                              | CC-BY                                                   | Not usable for daily transactions                                                                                                      |
| CBUAE exchange rates                                                                    | EGP listed (per search)          | per AED                                            | AED-based, Reuters-sourced, per search snippet only       | Mon–Fri 6pm UAE, per search snippet only                                            | ?                                                          | HTML                                                                   | ?                                                 | ?                                                       | **Unverified:** the page returned HTTP 403 to both WebFetch and curl. Also a Reuters-derived cross-rate, not an Egyptian official rate |
| SAMA                                                                                    | Monthly tables only (per search) | —                                                  | —                                                         | Monthly                                                                             | —                                                          | —                                                                      | —                                                 | —                                                       | **Unverified:** `sama.gov.sa/en-us/FinExc/Pages/Currency.aspx` returned 404                                                            |

---

## 3. Recommended primary: CBE Official Exchange Rates

### 3.1 Endpoints

| Purpose                                | Method                 | URL                                                                                                                                |
| -------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Latest rates                           | GET                    | `https://www.cbe.org.eg/en/economic-research/statistics/cbe-exchange-rates`                                                        |
| Arabic mirror (same data)              | GET                    | `https://www.cbe.org.eg/ar/economic-research/statistics/cbe-exchange-rates`                                                        |
| Historical form (gives token + cookie) | GET                    | `https://www.cbe.org.eg/en/economic-research/statistics/cbe-exchange-rates/historical-data`                                        |
| Historical query / export              | POST (form-urlencoded) | `https://www.cbe.org.eg/api/statistics/GetHistoricalData`                                                                          |
| Terms                                  | GET                    | `https://www.cbe.org.eg/en/disclaimer`                                                                                             |
| robots.txt                             | GET                    | `https://www.cbe.org.eg/robots.txt` returns only `User-agent: * / Disallow: /sitecore`, so the statistics paths are not disallowed |

### 3.2 Latest page: observed structure (trimmed)

```html
<span class="newsupdateddata">Last Updated: 24 Sep 2026</span>
... CBE Official Exchange rates and prices are expressed in pounds. ... Rates for Date: 24/09/2026
<table class="table-comp layout-auto">
  <thead class="bg-primaryIndigo-400">
    <tr class="content-height">
      <th class="column-width table-head">Currency</th>
      <th class="column-width table-head">Buy</th>
      <th class="column-width table-head">Sell</th>
    </tr>
  </thead>
  <tbody>
    <tr class="content-height">
      <td class="column-width table-cell">US Dollar</td>
      <td class="column-width table-cell">51.7144</td>
      <td class="column-width table-cell">51.8520</td>
    </tr>
    ...
  </tbody>
</table>
```

Full observed data for **Rates for Date 24/09/2026** (Buy / Sell, EGP):

| Label on page        | ISO               | Buy      | Sell     |
| -------------------- | ----------------- | -------- | -------- |
| US Dollar            | USD               | 51.7144  | 51.8520  |
| Euro                 | EUR               | 58.8147  | 58.9817  |
| Pound Sterling       | GBP               | 68.3974  | 68.6054  |
| Canadian Dollar      | CAD               | 36.6327  | 36.7380  |
| Danish Krone         | DKK               | 7.8673   | 7.8903   |
| Norwegian Krone      | NOK               | 5.4563   | 5.4715   |
| Swedish Krona        | SEK               | 5.2244   | 5.2388   |
| Swiss Franc          | CHF               | 62.4947  | 62.6838  |
| **Japanese Yen 100** | JPY (**per 100**) | 32.5760  | 32.6647  |
| Saudi Riyal          | SAR               | 13.7729  | 13.8103  |
| Kuwaiti Dinar        | KWD               | 168.0402 | 168.5422 |
| UAE Dirham           | AED               | 14.0804  | 14.1186  |
| Australian Dollar    | AUD               | 36.3500  | 36.4520  |
| Bahraini Dinar       | BHD               | 137.1370 | 137.6042 |
| Omani Riyal          | OMR               | 134.2777 | 134.7225 |
| Qatari Riyal         | QAR               | 14.1866  | 14.2267  |
| Jordanian Dinar      | JOD               | 72.8371  | 73.2373  |
| Chinese Yuan         | CNY               | 7.7029   | 7.7245   |

The required set USD, EUR, SAR, AED, GBP, KWD is **fully covered**. There are 18 currencies in total; the
historical `<select>` lists exactly the same 18 labels.

### 3.3 Historical endpoint (verified working)

The form on the historical-data page posts to `/api/statistics/GetHistoricalData` with these fields
(values as observed):

```
__RequestVerificationToken=<from hidden input on GET page>   (plus the cookie set by that GET)
uid=54010050-4405-48c8-9c56-fe19328e9e65
DataSourceId=19CFFDDBFF494350A5E9C6A4397FC7DF
FallbackUrl=/en/economic-research/statistics/cbe-exchange-rates/historical-data
LanguageName=en
FromDateRaw=17/09/2026          <- MUST be dd/MM/yyyy; ISO or MM/dd returned "no matching results"
ToDateRaw=24/09/2026
SelectedSelectOptions=US Dollar  (repeatable; value = English label)
SelectedSelectOptions=UAE Dirham
SubmitAction=1   (1 = HTML fragment, 2 = Excel .xlsx, 3 = HTML download, 4 = PDF)
```

Response for `SubmitAction=1`: an HTML fragment `<div id="api-data" data-present='true'>` holding a table with
columns **Date | Currency | Buy | Sell**, newest first, grouped by currency (trimmed):

```
24/09/2026 US Dollar 51.7144 51.8520
23/09/2026 US Dollar 51.3606 51.4956
22/09/2026 US Dollar 51.5297 51.6694
21/09/2026 US Dollar 51.8636 51.9985
20/09/2026 US Dollar 51.9520 52.0911
17/09/2026 US Dollar 52.0769 52.2151
24/09/2026 UAE Dirham 14.0804 14.1186 ...
```

When no data matches, the response is `<div id="api-data"><div class="status-container"><p>There are no matching results.</p>…`.

Response for `SubmitAction=2`: `Content-Disposition: attachment; filename="Official Exchange Rates Historical.xlsx"`,
a real OOXML workbook (Row 1 is a merged title, row 2 holds the headers `Date, Currency, Buy, Sell`, and dates are
Excel serials). Sample for 2020-01-02 and 2020-01-05: USD 15.9735/16.0996 and 15.9862/16.1089; KWD 52.6326/53.1532
and 52.725/53.1645. **This confirms history back to at least January 2020.**

### 3.4 Quotation mapping to "1 FOREIGN = X EGP"

- Every row is already **EGP per 1 unit of foreign currency**. The page itself says "prices are expressed in pounds".
- **Exception: `Japanese Yen 100`** is EGP per **100 JPY**, so `rate_JPY = value / 100`. Normalise with a
  per-label `unitDivisor` map. Do not infer the divisor from the number.
- Map labels to ISO codes with an **explicit, closed dictionary** (the 18 labels above). Treat an unknown label
  as a schema-drift signal, not a new currency. Note that the separate "Average Market Rate" page spells it
  `Chinese yuan` (lower case), so match case-insensitively or keep the two dictionaries apart.

### 3.5 Which rate to use

- CBE publishes **Buy** and **Sell** and does **not** publish an explicit mid.
- Recommended accounting rate: **mid = (Buy + Sell) / 2**, rounded and stored at 4–6 dp. For 24/09/2026:
  USD mid = (51.7144 + 51.8520) / 2 = **51.7832**.
  - Store all three values (buy, sell, mid) plus the source date. The choice then stays auditable and can be
    changed by policy (for example, Sell for liabilities or Buy for receivables) without refetching.
  - **Business decision needed:** whether OMS uses mid, buy or sell for payment declarations and reconciliation.
    Egyptian practice and the auditor's preference should decide. Nothing on the CBE site defines which one is
    "the" official rate.
- Do **not** use the "Average Market Rate in EGP" page (`/statistics/exchange-rates`). It is a different series
  (for example, its USD 24/09 is 51.7303/51.8303) and covers only 9 currencies.

### 3.6 Publication schedule and timezone

- Dates on the page are `dd/MM/yyyy` in **Egypt local time (Africa/Cairo)**. Egypt observes DST, so use the IANA
  zone and never a fixed offset.
- **The time of day of publication is not documented** anywhere I fetched. Observation: at 04:46 UTC
  (07:46 Cairo) on **Sunday** 27 Sep 2026, the page still showed "Rates for Date: 24/09/2026" (Thursday).
  Sunday's rate was therefore not yet published by early morning.
- **Weekends:** Friday and Saturday have no rows. Observed: 17/09 (Thu) was followed directly by 20/09 (Sun).
- **Holidays:** there are no rows on bank holidays. Observed gaps in history:
  - 2026-01-01 (New Year) and 2026-01-07 (Coptic Christmas) are missing.
  - 2026-05-26 → 2026-05-31 are missing (Eid al-Adha plus the weekend). **The gap from 25/05 to 01/06 is 7 calendar days.**
- **Cron recommendation (Vercel):**
  - Run twice daily, around **14:00 UTC and 20:00 UTC**, on all 7 days so a late publication is still picked up.
  - The job is idempotent: an upsert keyed on `(currency, rateDate)`, where `rateDate` comes from the page's
    "Rates for Date" and **not** from the fetch time.
  - Add a nightly backfill job that calls the historical endpoint for the last 10 days to repair missed runs.

### 3.7 Stale-rate policy (recommended)

The "≤ 3 calendar days" rule **does not hold** for EGP. The normal Thu → Sun gap is already 3 days, and Eid produced
a 7-day gap. Recommended rule:

- For a transaction dated D (Cairo), use the **latest CBE observation with `rateDate ≤ D`**. This matches the
  "latest published official rate" convention.
- Accept that observation only if `D − rateDate ≤ 10 calendar days`, and make the limit configurable. Eid
  al-Fitr and Eid al-Adha closures of about 5–6 days plus a weekend produce gaps of about 7–9 days.
  Otherwise **fail closed** and require a manual rate with reason and approver.
- Separately, raise an operational alert when the newest stored `rateDate` is more than 4 calendar days behind
  today. That usually means the scraper is broken, not that the date is a holiday.

### 3.8 Parsing notes

- Parse the `thead` and assert the headers are exactly `[Currency, Buy, Sell]` (EN) after trimming whitespace.
  Latest page: assert exactly one `table.table-comp`. Historical: assert `[Date, Currency, Buy, Sell]`.
- Extract `Rates for Date: dd/MM/yyyy` with a strict regex and reject the payload if it is missing.
  Do not use "Last Updated", which is a CMS date.
- Values are plain decimals with `.` as separator and no thousands separator (for example `168.0402`).
  Validate them with `^\d+\.\d{1,6}$` and parse with a decimal library, not float.
- Sanity checks before insert:
  - `0 < buy ≤ sell`.
  - `(sell − buy) / mid < 2%`.
  - Day-over-day change `< 15%`. Anything larger needs a human review flag, since EGP has had step devaluations.
  - All 6 required currencies are present.
- Use the Node server-side HTML parser already in the stack if there is one (e.g. cheerio). **Do not** rely on
  CSS utility classes beyond `table-comp`, `table-head` and `table-cell`.
- The English and Arabic pages carry identical values. Parse EN only.

### 3.9 Failure modes and fragility

- **WAF / bot protection (high risk).** The site is behind F5 Distributed Cloud (`server: volt-adc`, `x-volterra-location`).
  - Observed outcomes:
    - WebFetch was rejected ("Request Rejected").
    - A HEAD request with a short `Mozilla/5.0` UA got **403**.
    - A GET with a full browser UA got **200**.
    - A historical POST without token or cookie got **403**. Right after that, the same session's valid-token
      POST also got **403**, which suggests the WAF escalates per session or IP.
    - A fresh session worked again.
  - Vercel egress IPs are shared and may be blocked outright.
  - Mitigations:
    - Send a realistic UA and a low request rate (≤ 2–3 requests per run).
    - Always GET the form before POSTing.
    - Retry with backoff.
    - Alert on a 403.
  - If Vercel IPs are persistently blocked, move the fetch to a fixed-egress worker (for example Vercel Secure
    Compute or an external runner). Do **not** try to evade the WAF by other means.
- **Markup drift** (Sitecore redesign): strict schema validation must reject the payload, alert, and keep the last good rates.
- **Hidden-field drift:** `uid` and `DataSourceId` are CMS IDs. Scrape them from the GET page on every run instead of hard-coding.
- **Partial or late publication:** handled by the `rateDate` idempotent upsert and the second cron run.
- **Revisions:** none observed. Store `fetchedAt` and a raw-payload hash. If a later fetch for the same `rateDate`
  differs, keep both and flag it; never silently overwrite a rate already used in a posted document.

### 3.10 Credentials

None. The source is public, with no API key. The historical endpoint only needs the page's anti-forgery token and cookie.

---

## 4. Secondary / fallback

- **No independent official secondary exists for EGP.** ECB, IMF, H.10 and SAMA daily data do not include EGP.
  A "cross-rate" (for example EUR→EGP via USD) would still need a USD/EGP leg from CBE, so it adds no
  independence. The only non-CBE EGP publisher found, CBUAE, could not be fetched (403) and is Reuters-derived.
- Recommended fallback chain:
  1. CBE latest page.
  2. CBE historical endpoint (same data, different path; useful when only the latest page breaks).
  3. **Manual rate entry**, restricted to a Finance role, with a mandatory reason, the source reference
     (for example a CBE PDF or screenshot), and an approver. Label it `source=MANUAL`.
  4. Otherwise fail closed.
- Optional: a USD-based cross for **non-CBE currencies only**, using `EGP/USD (CBE) × USD/XXX (IMF representative rate)`.
  It must be labeled `source=DERIVED` and should only be used if the business needs currencies outside the 18.

## 5. Legal / terms

From `https://www.cbe.org.eg/en/disclaimer`, last updated 10 Mar 2026 (paraphrased):

- Content is CBE copyright.
- Users may make use of information obtained from the site (print, download, extracts, links).
- **CBE must be cited as the source** when the information is distributed or reproduced, and it must appear accurately.
- **If the data is transformed** (the text gives "calculation of average rates" as an example), **this must be
  stated explicitly**. That applies to the mid-rate: label it in the UI and on printouts as "Mid of CBE official
  buy/sell rates, CBE rates for dd/MM/yyyy".

The terms contain no explicit clause on automated access. robots.txt does not disallow the statistics paths. Low-rate,
once- or twice-daily fetching with attribution is defensible. Heavy or bulk scraping is not.

## 6. Sources fetched

- https://www.cbe.org.eg/en/economic-research/statistics/cbe-exchange-rates (curl, 200; WebFetch rejected by WAF)
- https://www.cbe.org.eg/ar/economic-research/statistics/cbe-exchange-rates
- https://www.cbe.org.eg/en/economic-research/statistics/cbe-exchange-rates/historical-data
- https://www.cbe.org.eg/api/statistics/GetHistoricalData (POST, HTML and XLSX responses)
- https://www.cbe.org.eg/en/economic-research/statistics/exchange-rates (Average Market Rate)
- https://www.cbe.org.eg/en/disclaimer
- https://www.cbe.org.eg/robots.txt
- https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml (2026-09-25; no EGP)
- https://www.imf.org/external/np/fin/data/rms_mth.aspx?SelectDate=2026-08-31&reportType=REP (no EGP)
- https://www.imf.org/external/np/fin/data/rms_mth.aspx?SelectDate=2026-08-31&reportType=SDRCV (no EGP)
- https://www.federalreserve.gov/releases/h10/current/ (no Egypt)
- https://api.worldbank.org/v2/country/EGY/indicator/PA.NUS.FCRF?format=json&per_page=5 (annual only)
- https://www.centralbank.ae/en/forex-eibor/exchange-rates/ (403; content unverified)
- https://www.sama.gov.sa/en-us/FinExc/Pages/Currency.aspx (404)

---

## 7. Implementation notes (IMPL-FX, 2026-09-27)

- **Quotation convention.** Only `FOREIGN → functional (EGP)` is stored: "1 FOREIGN = X EGP". Manual
  daily rates (`POST /exchange-rates`, bulk import) and overrides are rejected with a 400 when the "from"
  currency is the functional currency or the "to" currency is anything else. Existing reverse-pair rows
  are left untouched, and resolution never inverts a pair.
- **Resolution** (`ExchangeRatesService.resolveRateDetailed`, used by `snapshotRate`/`resolveRate`), on the
  UTC calendar day of `asOf`:
  1. an active override (`deletedAt IS NULL`) whose inclusive `[dateFrom, dateTo]` contains the day
     → `source = OVERRIDE`;
  2. the latest daily rate (CBE, MANUAL or IMPORT) with `effectiveDate ≤ day`, accepted only if
     `day − effectiveDate ≤ FxSyncSettings.maxStaleDays` (default **10**) → `source` from the row;
  3. otherwise fail closed: `MISSING_EXCHANGE_RATE` (no observation) or `STALE_EXCHANGE_RATE` (message and
     `details` carry the last date, its age, the limit, and the fix: run the import, or record a rate or override).
- **Weekends and holidays** are covered by step 2. The result carries the explicit `effectiveDate`, so for
  example Thursday 24/09's rate is used for Saturday 26/09. The rate-lookup tool on the settings page shows this.
- **Overrides** (`/exchange-rates/overrides`) cover inclusive date ranges and require a reason. They are
  soft-deleted with a reason, which is appended to `reason` because there is no dedicated column. A Postgres
  `EXCLUDE` constraint rejects overlapping active ranges per pair, even under concurrency; `23P01` becomes a
  409 naming the conflicting range. Automatic imports never touch overrides, and overrides win by precedence.
  Deleting or adding an override never changes a posted document, which keeps its frozen rate.
- **Source adapter** (`accounting/fx/providers/cbe.provider.ts` + `cbe-parser.ts`):
  - Fetch: GET of the latest page with a browser UA, a 15 s timeout, and one retry on 5xx or network errors.
    A 403 or WAF page is never retried.
  - Validation: a strict parse (one `table-comp`, exact headers, the `Rates for Date` line, a closed label
    dictionary, `^\d+\.\d{1,6}$`, `0 < buy ≤ sell`, spread < 2%, USD/EUR/GBP/SAR/AED/KWD all present).
    Any violation rejects the whole payload. An unknown label is skipped and reported as a warning.
  - Units: "Japanese Yen 100" is divided by 100.
  - Historical backfill: GET the form (token, cookie and CMS ids scraped each time), pause 1.5 s, then one POST
    for the range with all 18 labels. It runs from "Repair last 10 days" in the settings dialog.
- **Rate basis.** `FxSyncSettings.rateBasis` defaults to **MID = (buy + sell) / 2 (derived by OMS)**. The owner
  can switch to BUY or SELL in the settings. Buy and sell are always stored (`buyRate`/`sellRate`), with
  `source = provider = 'CBE'`, `syncRunId`, and `sourceTimestamp`. CBE publishes no time of day, so
  `sourceTimestamp` is the time the published page was fetched. The UI carries the CBE citation and the
  "mid derived" statement required by the CBE terms.
- **Idempotency.** Rows are keyed on `(from, to, effectiveDate)`:
  - An existing CBE row is kept. A differing later value is recorded as a warning and the run is `PARTIAL`.
  - An existing MANUAL or IMPORT row is never overwritten; it is skipped and counted.
  - A day-over-day move above 15% is imported but flagged as a warning.
- **Schedule.** `vercel.json` crons: `/api/cron/fx-rates` runs at **14:00 UTC** and
  `/api/cron/fx-rates?slot=late` at **20:00 UTC** (two daily entries, so it stays valid on plans that allow
  daily crons only). The endpoint is secured like `/api/cron/accounting-schedules`: the `CRON_SECRET` bearer is
  compared with a timing-safe check (shared `assertCronAuthorized`), and the endpoint refuses to run when
  the secret is unset.
- **Runs.** Each attempt is one `FxSyncRun` with status, counts, error, effective date and details
  (inserted/skipped keys, warnings, raw sha256, source URL).
  - `enabled = false` makes a scheduled run `SKIPPED`. "Run now" is an explicit user action and still runs.
  - Only one run happens at a time: a transaction-scoped advisory lock plus a check for a `RUNNING` row.
    A `RUNNING` row older than 10 minutes is marked `FAILED`.
  - The whole payload is validated before anything is written, and all rows are written in one transaction.
- **Failure modes.**
  - Provider, network, WAF or parse failure → the run is `FAILED` with the reason, shown in the UI, and
    nothing is written.
  - Resolution keeps using the latest valid rate within `maxStaleDays`, and fails closed after that.
  - A banner appears when the newest CBE rate is older than `staleAlertDays` (default 4).
- **Credentials:** none (public source). `CRON_SECRET` is already required by the existing cron.
