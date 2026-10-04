# Round 11 — simplified entry, customer recognition, search and mobile completion

Branch `feat/r11-entry` · local review stack web :4601 / API :4605 (DB `oms_r7_final`) · **not deployed — awaiting owner visual approval**.

## 1. Root causes (reproduced, not assumed)

Reproduced against the local clone and — read-only, as the QA admin — against Production.

| #   | Symptom                                            | Cause                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Standard list search did not find a known phone    | Only Store Orders used the phone-aware candidate search. Customers, Leads and the agent lists did a literal `contains` on the typed text, so a national number (`0548551887`), `00966…`, spaces or Arabic digits matched nothing (Production: `/partners?search=0548551887` → 0 of 1). Arabic digits were also stripped by `\D` in the one place that was phone-aware.                                                                                                                                           |
| 2   | Advanced lookup "found nothing"                    | (a) An Arabic-digit number was classified as a one-word NAME and refused (400 → the dialog showed a generic error). (b) The permission `customers.lookup_advanced` was granted to nobody by the R7 migration: on Production exactly one user held it, so ordinary Sales never even saw the button. (c) The button existed only on the Store Orders page and an empty list search never pointed to it. (d) `403` / validation errors were not distinguished from an empty result.                                 |
| 3   | An existing phone was accepted with no recognition | (a) The duplicate check read the number with the form's phone country only: a local Egyptian number typed under the default Saudi country normalised to nothing → `NONE`. (b) A customer with no order yet (a lead-only or just-created customer) was reused **silently** by design — the employee never saw that the customer existed. (c) A customer holding the number on a second legacy record was resolved silently to one of them. (d) `findPhoneMatches` loaded every partner into memory on each check. |
| 4   | Entry form friction                                | A separate full-width "phone country" dropdown next to a second "country" dropdown; city / address / email each full width; selecting a customer then re-entering the same fields; an address typed for an existing customer was silently discarded (the server never updates an existing customer).                                                                                                                                                                                                             |
| 5   | "0" in empty money fields                          | `unitPrice: 0`, `useState(0)` and `defaultValues: { amount: 0 }` rendered a 0 the user had to delete.                                                                                                                                                                                                                                                                                                                                                                                                            |

## 2. What changed

**B / C — one canonical path**

- `PhoneNumberService.lookupCandidates(raw, region?, narrow?)`: the chosen phone country is authoritative when the number is valid in it; otherwise the number on its own (`+`, `00`, `966…`, Arabic digits); otherwise every valid reading in SA / EG / AE. Always a full valid E.164 — never a suffix. `phoneSearchCandidates()` is the list-search twin (digit fragments, Arabic digits, trunk `0` / `00`).
- Used by: order duplicate check, advanced lookup, `PartnersService.findPhoneMatches` (narrow, for Create/Update guards), list search of Customers (`phoneSearchFields` in `MasterDataCrudService`), Leads, agent leads / orders, agent admin list, Store Orders.
- `findPhoneMatches` is now an index lookup (phone keys + exact E.164) plus a bounded legacy scan (trailing-7-digit narrowing, then full normalised comparison) instead of a table scan.
- Duplicate check results: `PHONE` (orders in scope, active first), **`KNOWN`** (customer exists but has no order in scope: masked name + typed number, informational, audited), `PHONE.alternatives` (several records hold one number → the employee must name the right one; server answers 409 `AMBIGUOUS` / `STALE`), cross-scope flag only (unchanged). `KNOWN` never hides a stronger match on another number.
- Server enforcement is unchanged in shape and still the only gate (manual order, lead conversion, agent order). Retries are covered by the per-form idempotency key (same key → same order; same key + other payload → 409).
- Advanced lookup: Arabic digits; grant migration `20261005090000_r11_lookup_advanced_for_order_staff` (see §4); `Search all customers` link under an empty search on Customers, Leads and Store Orders; distinct 403 / 429 / error states.
- Leads are **not** subject to the order confirmation (verified: repeated leads on one number all create).

**A — entry forms**

- Store order form: **New / Existing customer** toggle. Existing → a picker, then a concise identity summary; name, phone and address are not asked again. New → name and phone side by side, the calling-code selector **inside** the phone field (flag + `+966 ▾`), delivery City + Address once, side by side.
- Delivery country follows the phone country; **Different delivery country** is one click away (international phone, local delivery is preserved). **Deliver to a different address** for an existing customer.
- The order's destination is stored **on the order** (`store_orders.delivery_country_id / delivery_city / delivery_address`, additive nullable). It is never written to the customer master; readers fall back to the customer for older orders. Amendments edit the order's own destination (customer switch hands the parcel to the new customer's address).
- Shipping / Pickup; pickup or an all-service order hides the delivery block.
- Recognised customer → "New order for this customer" turns the form into the existing-customer view.
- Calling-code selector also in: the generic master-data forms (Customers, Suppliers, Leads), the edit-customer dialog, the agent order form. The quick lead form drops its second country field (the lead's country follows the calling code). Agent order form: name / mobile, then country / city, then address.

**Addendum — empty numeric inputs and caret**

- `MoneyInput` illustrates `0.00` as a placeholder only. New document lines start with an unset price (`priceBlank`); saved lines (no flag) keep their value, including an explicit 0; typing — even "0" — clears the flag; a required price stays "missing" until a value > 0.
- Master-data money fields (expenses, fixed-asset cost / salvage, accrued / prepaid amount, compensation) start empty with a `0.00` placeholder (`money: true`); payment / receipt / refund amounts and fixed-asset disposal start empty.
- Native caret tinted with `--caret-color` (= the focus-ring blue, contrast-checked ≥ 3:1, light and dark) on every input / textarea; no simulated cursor.

**D — mobile**

- Real-browser audit of every shell route and sample detail pages at 390 and 360 px (company + agent personas, touch emulation): page overflow, elements outside the viewport that are not inside a bounded scroller, create dialogs (fits, footer reachable, one scroller). Result in `evidence.md`.

## 3. Decisions taken (owner can revisit)

- Recognition shows a customer outside the employee's own records **only** as masked, read-only information and never as a link; an out-of-scope order is not listed.
- `KNOWN` is audited in the shared lookup ledger; it is not rate-limited by the lookup budget (the 15 / 10 min budget applies to the explicit lookup tool).
- Delivery destination on the order (not on the customer) is the model for company orders from now on.
- Digital-only detection: only lines whose item type is **Service** hide the address (the catalogue has no "digital" flag on the product row).

## 4. Role grants (needs owner approval before Production)

Migration `20261005090000_r11_lookup_advanced_for_order_staff` grants `customers.lookup_advanced` (user-level — there is no role layer) to every active, unlocked, non-deleted **internal** user who holds `store-orders.create`, `crm.leads.convert`, `customers.lookup_global` or `orders.lookup_global`. Agents never receive it. Additive and idempotent; revocable in the Permission Matrix. Production today: 1 internal user holds it, 6 hold the legacy `customers.lookup_global`.

## 5. Known limitations / not done

- Investor-opportunity funded units / unit cost and other raw `type="number"` fields outside the shared money components still start at 0 (listed, not converted).
- Cost-analytics and shipment filters still attribute an order's country from the customer record, not the new order-level destination.
- Two concurrent creates with different idempotency keys for a customer with no order yet are not serialised (pre-existing check-then-act).
- `account-currency.integration.spec` ("a cancelled receipt is netted…") fails identically on `main` after local midnight (date-sensitive) — unrelated to this round.
- The calling-code flag renders as letters (`SA`) on Windows desktops (no emoji flags there); phones render the flag.
