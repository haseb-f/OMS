# Round 11 — acceptance evidence (local review stack, tagged demo records)

Run against web :4601 / API :4605 (build of this branch), DB `oms_r7_final`. Records are tagged `R11ACC…` / `R11UI…`.
Scripts: `scripts/acceptance/r11/{api-acceptance,browser-acceptance,mobile-audit}.mjs`. Raw results: `evidence/*.json`.

## Scenario matrix

| #   | Scenario                                                                                                                                                                                         | API                         | Browser                             | Where                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------- | ----------------------------------- | ----------------------------------------------- |
| 1   | Order for a genuinely new customer                                                                                                                                                               | ✔                           | ✔ (mobile 390 / 360 form)           | `api-acceptance` §1                             |
| 2   | Existing phone in different valid formats (`+966`, `00`, national, spaced, Arabic digits, wrong default country, no country)                                                                     | ✔                           | ✔ 4 formats                         | §2 · `ui-recognition-warning.png`               |
| 3   | Prior-order warning with reference, date, amount/currency, fulfilment status, active flag, open-order link                                                                                       | ✔                           | ✔                                   | §3                                              |
| 4   | Cancel creates no customer and no order                                                                                                                                                          | ✔                           | ✔                                   | §4                                              |
| 5   | Confirmed repeat order reuses the customer (no second customer)                                                                                                                                  | ✔                           | ✔ (also via Existing-customer mode) | §5 · `ui-existing-customer-mode.png`            |
| 6   | Double click / retry → one order                                                                                                                                                                 | ✔ (parallel POST, same key) | ✔ (double click)                    | §6                                              |
| 7   | Another employee finds the customer by advanced lookup; masked, no link, no edit (404 on the order / PATCH)                                                                                      | ✔                           | ✔                                   | §7 · `ui-advanced-lookup-result.png`            |
| 8   | Ordinary list search stays scoped (other employee: 0 orders, 0 leads) and offers the lookup                                                                                                      | ✔                           | ✔                                   | §8 · `ui-search-scoped-fallback.png`            |
| 9   | Another agent's data inaccessible: flag only, 404 by id, company lookup 403                                                                                                                      | ✔                           | —                                   | §9                                              |
| 10  | Repeated leads on one number all created                                                                                                                                                         | ✔                           | —                                   | §10                                             |
| 11  | Customer / order / invoice entry on a phone without clipping or re-entry                                                                                                                         | —                           | ✔ 390 + 360, **real touch**         | `ui-order-form-mobile-*.png`                    |
| 12  | Phone country ≠ delivery country preserved (+20 phone, Saudi delivery)                                                                                                                           | ✔                           | ✔ (toggle keeps +20)                | §12                                             |
| B3  | Server refuses: no acknowledgement (409), other employee + other format (409), wrong customer (stale), "different customer" for a matching phone, ambiguous multi-record without a chosen record | ✔                           | —                                   | §B3 + `store-order-duplicates.integration.spec` |

Results: **API 35 / 35**, **browser 41 / 41**, jest `store-order-duplicates.integration` 31 (6 new R11), `phone-matching` 7, web vitest 832 (+ new specs for panel rules, destination, money input, caret).

## Touch / keyboard behaviour (not screenshots)

390 and 360 px, touch emulation: tap opens the calling-code list, it fits the screen (left 8 / right 296 of 390), a country row is 40 px, tapping Egypt sets `+20`, a typed local number is accepted and the focused field stays in view, "different delivery country" opens its own selector and keeps `+20`. The on-screen keyboard inset itself cannot be emulated in desktop Chromium — `EnterpriseModal` already adds `useKeyboardInset` to the sheet offset (unchanged).

## Mobile route coverage (Workstream D)

`mobile-audit.mjs`: **152 routes × 2 widths = 304 combinations, 0 problems** — page overflow, elements outside the viewport not inside a bounded scroller, and the create dialogs (Store order, Lead, Customer: fits width and height, footer actions reachable, ≤ 1 scroller). Company: 134 shell routes (all static list / new / report / settings pages, Home, module overviews) + first-record detail pages of store orders, leads, sales invoices, sales orders, customers, purchase orders. Agent: 10 portal routes + first agent order and lead. The metric was checked to fire on a deliberately broken page.

**Not covered** (stated, not claimed): investor portal (`/investor/*`), login / reset pages, print layouts, dialogs other than the three create dialogs, detail pages beyond the first record per type, the on-screen keyboard inset. The shell was already mobile-sound at these widths (prior rounds); the new work here is the entry form itself.

## Independent review

A fresh-context reviewer examined disclosure and duplicate protection. Fixed in this round: `KNOWN` could hide a stronger match on a second number (high); `KNOWN` is now audited and masks the typed number; agent `alternatives` showed the master name (now the name the agent typed); the legacy phone scan skipped partially-keyed records; lead conversion rewrote the customer address and ignored the chosen record for an already-linked lead; the chosen phone country is authoritative again (no cross-market false positives, 1× not 4× enumeration); agent order search no longer matches the master phone; a customer switch no longer half-copies an address onto an order's own destination; the delivery country must exist. Open (documented): concurrent creates with different keys for a customer with no order yet; cost-analytics country attribution.

## Before / after

`before-order-form-{desktop,mobile-390}.png` (Production, QA admin, dialog opened and closed unsaved) vs `ui-order-form-{desktop,mobile-390,mobile-touch-390}.png`, `ui-lead-create-*.png`, `ui-agent-order-*.png`.
