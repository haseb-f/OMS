# R13 browser acceptance — final run

- Script: `scripts/acceptance/r13/browser-acceptance.mjs` (lint clean)
- Stack: web http://localhost:3001 (production build), API http://localhost:3005, local PostgreSQL
- Run: 2026-10-06T09:40:08.555Z · demo tag `R13UI426625` · user admin@oms.local (password read at runtime from the dev seed, not recorded)
- Result: **74 / 74 PASS**, 0 FAIL
- Raw results: `browser-acceptance.json`

Re-run: `BASE=http://localhost:3001 API=http://localhost:3005 node scripts/acceptance/r13/browser-acceptance.mjs`
(`ONLY="3.,9."` limits to some journeys; `CHROMIUM_PATH` overrides the browser when the pinned Playwright revision is not installed.)

## Checks

| Check                                                                                                    | Result |
| -------------------------------------------------------------------------------------------------------- | ------ |
| setup: a sellable active product exists                                                                  | PASS   |
| setup: tagged fixed asset created via API                                                                | PASS   |
| setup: tagged prepaid expense created via API                                                            | PASS   |
| 1. customer: address country Egypt proposes +20 to the empty phone                                       | PASS   |
| 1. customer: +966 chosen in the picker sticks after typing (address stays Egypt)                         | PASS   |
| 1. customer: saved with Egypt address and a +966 mobile                                                  | PASS   |
| 1. customer: reopened edit shows +966 and the same number                                                | PASS   |
| 1. customer: changing the address country afterwards (→ Kuwait) leaves +966 unchanged                    | PASS   |
| 1. supplier: address country Egypt proposes +20 to the empty phone                                       | PASS   |
| 1. supplier: +966 chosen in the picker sticks after typing (address stays Egypt)                         | PASS   |
| 1. supplier: saved with Egypt address and a +966 mobile                                                  | PASS   |
| 1. supplier: reopened edit shows +966 and the same number                                                | PASS   |
| 1. supplier: changing the address country afterwards (→ Kuwait) leaves +966 unchanged                    | PASS   |
| 1. users: the mobile field has the in-field calling-code picker                                          | PASS   |
| 1. users: a picked code (+20, default would be +966) sticks after typing                                 | PASS   |
| 2. password: a generated password is present on open and meets the policy (≥8, upper/lower/digit/symbol) | PASS   |
| 2. password: reveal / hide toggles the input type                                                        | PASS   |
| 2. password: Regenerate changes the value and still meets the policy                                     | PASS   |
| 2. password: Copy shows the 'Password copied' toast and the clipboard holds the field's value            | PASS   |
| 3. mobile: dialog opens on step 1 of 4 (compact step header)                                             | PASS   |
| 10. 390 px: order dialog — no horizontal page scroll                                                     | PASS   |
| 3. Next validates step 1: empty name shows an error and stays on step 1                                  | PASS   |
| 3. calling-code dropdown is a long scrollable list                                                       | PASS   |
| 3. wheel over the open dropdown scrolls the list (dialog/page stay put)                                  | PASS   |
| 3. touch swipe over the open dropdown scrolls the list (dialog/page stay put)                            | PASS   |
| 3. Escape closes only the dropdown, the order dialog stays open                                          | PASS   |
| 3. step 1 complete → step 2 (products)                                                                   | PASS   |
| 3. step 2 complete → step 3 (delivery & payment)                                                         | PASS   |
| 3. step 3 complete → step 4 (review)                                                                     | PASS   |
| 3. Back keeps values (step 3 city, step 2 product line, step 1 name)                                     | PASS   |
| 3. Review shows the totals (2 × 150 = 300) with the order currency                                       | PASS   |
| 3. double-click Create → exactly one order created                                                       | PASS   |
| 3. success feedback toast after Create                                                                   | PASS   |
| 4. [ar/RTL] tone-1 control sits on the RIGHT of the highest tone                                         | PASS   |
| 4. [ar/RTL] tone-1 is lighter than the highest tone                                                      | PASS   |
| 4. [en/LTR] tone-1 control sits on the LEFT of the highest tone                                          | PASS   |
| 4. [en/LTR] tone-1 is lighter than the highest tone                                                      | PASS   |
| 5. create dialog offers the Group / Posting choice                                                       | PASS   |
| 5. Posting is the default and explains it cannot have sub-accounts                                       | PASS   |
| 5. UI: a Posting account has no 'Add Sub-Account' action; a Group account has it                         | PASS   |
| 5. API: creating a child under a Posting account is refused with the explanatory message                 | PASS   |
| 6. automation state shown as text + icon                                                                 | PASS   |
| 6. 'Enable automatic updates' switch and a separate 'Refresh now' button                                 | PASS   |
| 6. last successful update and next run are shown                                                         | PASS   |
| 7. fixed asset detail loads (name + code)                                                                | PASS   |
| 7. depreciation schedule section visible                                                                 | PASS   |
| 7. schedule preview (before capitalization) lists the 24 monthly periods                                 | PASS   |
| 7. prepaid detail loads with its recognition schedule                                                    | PASS   |
| 10. 390 px: fixed asset detail — no horizontal page scroll                                               | PASS   |
| 10. 390 px: payment methods — no horizontal page scroll                                                  | PASS   |
| 8. tabs Methods / Channels / Receiving accounts                                                          | PASS   |
| 8. /finance/payment-sources redirects to the Channels tab                                                | PASS   |
| 9. [ar/light] direction and theme applied                                                                | PASS   |
| 9. [ar/light] Live: 5 period cards with currency-labelled amounts                                        | PASS   |
| 9. [ar/light] Live: last refresh time shown                                                              | PASS   |
| 9. [ar/light] الموظفون tab renders                                                                       | PASS   |
| 9. [ar/light] المقارنة tab renders                                                                       | PASS   |
| 9. [ar/dark] direction and theme applied                                                                 | PASS   |
| 9. [ar/dark] Live: 5 period cards with currency-labelled amounts                                         | PASS   |
| 9. [ar/dark] Live: last refresh time shown                                                               | PASS   |
| 9. [ar/dark] الموظفون tab renders                                                                        | PASS   |
| 9. [ar/dark] المقارنة tab renders                                                                        | PASS   |
| 9. [en/light] direction and theme applied                                                                | PASS   |
| 9. [en/light] Live: 5 period cards with currency-labelled amounts                                        | PASS   |
| 9. [en/light] Live: last refresh time shown                                                              | PASS   |
| 9. [en/light] Employees tab renders                                                                      | PASS   |
| 9. [en/light] Comparison tab renders                                                                     | PASS   |
| 9. [en/dark] direction and theme applied                                                                 | PASS   |
| 9. [en/dark] Live: 5 period cards with currency-labelled amounts                                         | PASS   |
| 9. [en/dark] Live: last refresh time shown                                                               | PASS   |
| 9. [en/dark] Employees tab renders                                                                       | PASS   |
| 9. [en/dark] Comparison tab renders                                                                      | PASS   |
| 9. 390 px: sales reports Live — no horizontal page scroll                                                | PASS   |
| 9. 390 px: sales reports Comparison — no horizontal page scroll                                          | PASS   |

## Screenshots (14)

- `r13-customer-edit-egypt-address-966-phone.png`
- `r13-user-create-password-and-phone.png`
- `r13-order-mobile-dropdown-scrolled.png`
- `r13-order-mobile-review.png`
- `r13-toolbar-tones-ar-rtl.png`
- `r13-coa-create-group-posting.png`
- `r13-fx-automation-state.png`
- `r13-fixed-asset-detail.png`
- `r13-fixed-asset-schedule-preview.png`
- `r13-prepaid-detail.png`
- `r13-payment-methods-channels.png`
- `r13-sales-live-ar-light.png`
- `r13-sales-live-en-dark.png`
- `r13-sales-live-mobile-390.png`

## Product issues found

1. **Arabic comma in the English order review (minor, i18n).** Repro: English UI → Store Orders → New Order → new customer, fill city + address → go to Review. "Delivered to" reads `street 1، Riyadh، Saudi Arabia` (Arabic comma U+060C) instead of a locale-aware separator. Suspected: `apps/web/src/components/store-orders/store-order-create-dialog.tsx` ~line 759, `.join("، ")` is hardcoded. Visible in `r13-order-mobile-review.png`.

No functional failures.

## Environment notes (not product bugs)

- The FX page shows **Last update failed: CBE blocked the request (HTTP 403)** — the sandbox has no egress to the CBE site. The state is shown correctly (text + icon, switch separate from Refresh now, last success, next run).
- Live sales amounts include many `A…` test currencies from earlier agent test runs in this database. This is seeded data, not a reporting defect.
- The local Playwright package expects Chromium revision 1243 but the machine has 1194. The script falls back to `/opt/pw-browsers/chromium`.
