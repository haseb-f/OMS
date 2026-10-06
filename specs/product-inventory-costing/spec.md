# R13 — Product, Inventory & Costing Restructure — Specification

Branch `feat/r13-product-model` (canonical repo, no copies). Local-first; **not released** until the owner approves the
local review (see `plan.md` §Approval gates). Status of every claim below is tracked in `verification.md`.

Odoo concepts referenced (adapted, not cloned) — official docs, Odoo 18:
[Product type](https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/inventory/product_management/configure/type.html)
(Goods / Service / Combo; separate Sales and Purchase checkboxes; "Track Inventory" only for goods),
[Kits](https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/manufacturing/advanced_configuration/kit_shipping.html)
(one sale line, components listed on delivery, stock is managed per component, a kit is not sellable when a component is short),
[Bill of Materials](https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/manufacturing/basic_setup/bill_configuration.html)
("Manufacture this product" vs "Kit"), and
[Landed costs](https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/inventory/product_management/inventory_valuation/landed_costs.html)
(split by quantity/cost/…; with AVCO the cost reaches only the quantity still in stock).
OMS deliberately differs where its own approved rules apply (moving average only, perpetual, no negative stock, single
company, owner-based agent stock, investor module) — differences are called out as **OMS adaptation**.

## 1. Findings (current state, verified in code during discovery)

| #   | Finding                                                                                                                                                                                                                                                | Evidence                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| F1  | `Product.type` (6 values) mixes four concepts (can-buy, can-sell, stocked, assembled); `itemType`, `isInventoryItem/isSellable/isPurchasable` overlap it; flags are derived from `type` only at create and never re-derived.                           | `schema.prisma` Product; `products.service.ts` DEFAULT_FLAGS_BY_TYPE |
| F2  | No barcode uniqueness; no similar-name warning.                                                                                                                                                                                                        | products.service.ts                                                  |
| F3  | Kit/BOM is `ProductComponent` CRUD only: no explosion, no cycle check (only self-reference), BOM and variants controllers have **no permission guard**.                                                                                                | products/components                                                  |
| F4  | No assembly/production writer exists; ASSEMBLY/PRODUCTION* movement types are vocabulary.                                                                                                                                                              | inventory.service.ts                                                 |
| F5  | All stock quantities are `Int`; `UnitConversion` is CRUD only and never consumed.                                                                                                                                                                      | schema, unit-conversions                                             |
| F6  | Stock writers read on-hand then write with no row lock → concurrent decrements can both pass the `>= 0` check; no idempotency key on movements.                                                                                                        | inventory.service.ts createMovement                                  |
| F7  | `postSalesDelivery` checks on-hand only (ignores reservations). Company StoreOrders never reserve.                                                                                                                                                     | inventory.service.ts:440                                             |
| F8  | Moving average: single writer `InventoryValuationService.blendIntoAverage`; cost columns are `Decimal(12,2)` (ADR-0017's integer-minor-unit promise is not implemented); same product on two lines of one document distorts the blend.                 | inventory-valuation.service.ts                                       |
| F9  | Landed cost capitalizes the whole amount into the _remaining_ units; units already sold get no catch-up; on-hand ≤ 0 throws a plain `Error` (500). Foreign-currency landed cost posts at rate 1 (no frozen rate). No reversal of a posted landed cost. | landed-cost-posting.provider.ts, inventory-valuation.service.ts:161  |
| F10 | Purchase receipt and supplier bill are one document (`PurchaseInvoice`); no GRN/GRNI, no partial receipts. Purchase return does not touch the average.                                                                                                 | purchase-invoices.service.ts                                         |
| F11 | Damage / expired / physical-count / opening-balance movements post nothing to the GL; adjustment posts at current average.                                                                                                                             | inventory.service.ts, physical-count.service.ts                      |
| F12 | Sales/Purchase **return** `confirm` has no `isInventoryItem` guard (service lines fail).                                                                                                                                                               | sales-returns / purchase-returns services                            |
| F13 | Agent-owned products are blocked from investment opportunities only in the UI, not the API; the ownership lock ignores BOM rows.                                                                                                                       | investment-opportunities.service.ts, products.service.ts             |
| F14 | Company stock cards / warehouse balances do not distinguish owner (agent stock mixes into company reports).                                                                                                                                            | inventory.service.ts:886,999                                         |
| F15 | No inventory-valuation ↔ GL reconciliation exists.                                                                                                                                                                                                     | —                                                                    |
| F16 | Three parallel sales flows (B2B document pipeline, StoreOrder, legacy `/sales-orders`); legacy one is unused by the web app and does not touch stock.                                                                                                  | store-orders, sales, sales-orders                                    |

## 2. Product model — independent attributes (decision)

One `Product` row per sellable/purchasable thing. Six **independent** attributes (no attribute implies another except where
a hard business rule below says so):

| Attribute                  | Column                                | Values                                                                       | Rule                                                                                                                              |
| -------------------------- | ------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| A. Item type               | `itemType`                            | `PRODUCT` \| `SERVICE` (required on write; legacy nulls only until reviewed) | Services never have stock.                                                                                                        |
| B. Inventory behavior      | `isInventoryItem` ("Track stock")     | bool                                                                         | Only `PRODUCT`. Forced `false` for `SERVICE` and for `KIT` (a kit owns no stock balance). Forced `true` for `ASSEMBLED`.          |
| C. Commercial availability | `isSellable`, `isPurchasable`         | bool, **both may be true**                                                   | Defaults: PRODUCT sell+buy; SERVICE sell only.                                                                                    |
| D. Supply method           | `supplyMethod` (new)                  | `PURCHASED` \| `ASSEMBLED` \| `KIT`                                          | `SERVICE` ⇒ `PURCHASED` (n/a). Changing to/from `KIT` is blocked while the product has stock or open reservations.                |
| E. Ownership               | `ownerAgentId`                        | null = company                                                               | Existing immutability once referenced; **now also counts recipe lines and recipe headers.**                                       |
| F. Investor eligibility    | `availableForInvestmentOpportunities` | bool                                                                         | Allowed only for `PRODUCT`, company-owned, sellable, ACTIVE (API-enforced, not only UI). Never creates funding/allocation/profit. |

`Product.type` is **kept as a derived legacy column** (computed by one function from A–D on every write; never user input,
removed from the DTO and the form) so the ~6 legacy readers (list filter, import, tests) keep working; scheduled for removal
in a later release. Category, stock tracking, ownership, and commercial availability remain independent.

Identity: auto-generated unique SKU (Numbering Engine — UX policy: never typed); **barcode unique among non-deleted products**
(partial unique index on `lower(btrim(barcode))` + application check with a clear 409 naming the other product); **similar-name
warning** (non-blocking `GET /products/similar-names`). Variants: reuse existing `ProductVariant`; no new variant engine.

Defaults with visible inheritance: `ProductCategory` gains `defaultUnitId`, `defaultTaxId`; accounts already resolve
product → category → Posting Settings (`AccountMappingService`, single resolver) and the form shows the _effective_ account
and where it comes from, read-only, with a link to the category — accounts are **never** re-entered per product.

Estimated vs actual cost: `purchasePrice` = catalog/expected price (label "Expected purchase price — estimate");
`currentCost` = actual moving-average cost; recipe cost on the product page = _estimate_ (components' current cost ×
quantity + recipe direct-cost estimate), clearly labelled; every transaction stores the actual cost snapshot it used.

## 3. Recipes: stocked assembly vs kit

One canonical component relationship: `ProductRecipe` (versioned header) + `ProductRecipeLine`. The old `ProductComponent`
table is migrated (copied as **DRAFT** v1 recipes for review) and then **deprecated, unread**; its drop needs explicit approval
(destructive).

- **Recipe**: `version`, `status` DRAFT → ACTIVE → RETIRED, `effectiveFrom`, `outputQuantity` (batch output, ≥1 for ASSEMBLED,
  exactly 1 for KIT), `directCostEstimate`. At most one ACTIVE per product (partial unique index). ACTIVE/RETIRED recipes are
  immutable; edits = new version. Activation validates: product is ASSEMBLED/KIT; ≥1 line; no cycle (full walk through the
  components' active recipes); components are stock-tracked PRODUCT items and not KITs (no nested kits); **one owner** across
  product and all components (see §7); unit conversion exists and, for KIT, converts to a **whole** number of stock units.
- **Units**: stock quantities stay integers in the component's stock unit (`product.unitId`). A recipe line carries its own unit;
  `UnitConversionService` converts via a _direct_ `UnitConversion` (either direction, one hop). No conversion → error, never
  silently mixed. Consumption `lineQty × (producedQty / outputQuantity)` must be a whole number or the operation is rejected
  (**OMS adaptation**: no fractional stock; documented limitation until quantity columns move to decimal).
- **A. Stocked assembly** — new `AssemblyOrder` (+ lines): performed immediately (no scheduling/work orders). Snapshots the
  recipe (id, version, resolved lines) on the order. Consumes components (`PRODUCTION_CONSUMPTION` movements at the component's
  moving-average cost, recorded per line) and receives the finished item (`PRODUCTION_OUTPUT`) in one transaction. Reversal
  allowed only while the finished quantity is still on hand (otherwise blocked with a clear message → use scrap/return flows).
  Scrap = existing DAMAGE/EXPIRED movement, now posted to the GL (F11 fix, forward only).
- **B. Kit** — the kit product has **no stock** (`isInventoryItem=false`). A sale line of a kit is _fulfilled from components_:
  availability = `min(floor(available_c / qty_c))`; B2B order confirm **reserves components**; invoice / StoreOrder
  invoice / agent dispatch **delivers components** (`SALES_DELIVERY`, `parentProductId` + `recipeId` stamped); COGS is the sum
  of component costs, recognised **once** (the finished-item line carries no stock cost of its own). The sale line snapshots
  the recipe (`SalesInvoiceItem.fulfillmentSnapshot`). Kit return returns components at the snapshot cost.

## 4. Costing and valuation (decision)

**Method: moving average, perpetual** — unchanged. Rationale: owner/guardian decision (`erp-decisions.md`), only method
implemented end-to-end (`Product.costingMethod` FIFO/STANDARD and `InventorySettings.valuationMethod=FIFO` are inert and
stay inert; the UI shows "Moving average" as fixed). No historical valuation is re-computed or switched.

- **Precision**: cost columns widen `Decimal(12,2)` → `Decimal(14,4)` (lossless — existing values preserved byte-for-byte);
  GL amounts are `round2(qty × unitCost)` per line; the residual between sub-ledger value and GL is reported, never hidden.
- **Purchase**: unchanged (net of discount, frozen FX rate). Fix F8 double-line distortion (blend uses on-hand _before the
  whole document_).
- **Landed cost (later cost / supplier charges after receipt or sale)** — OMS adaptation of the Odoo AVCO behaviour:
  for each allocated invoice line with allocated quantity `Q`, amount `A`, and current on-hand `O` (all warehouses):
  `capitalized = A × min(Q, O) / Q` → Dr Inventory and moves the average; `variance = A − capitalized` → Dr COGS
  (landed-cost variance, already-sold units). Never throws on `O ≤ 0`. Respects period locks via the Posting Engine
  (posting date = document date inside an open period, never backdated into a closed/locked one). Audit: allocation stores
  `capitalizedAmount`/`cogsVarianceAmount`; `ProductCostHistory` row per product. FX: landed-cost document gets a frozen
  `exchangeRate` (existing snapshot rule).
- **Supplier invoice vs receipt**: OMS records receipt and supplier bill in one document (existing, retained). A later price
  difference is corrected by purchase return + re-bill (existing), later extra charges by Landed Cost (above). A separate
  GRN/GRNI + three-way match is an **owner decision (O1)**, recommended default: not now.
- **Assembly cost**: Σ(component qty × component moving-average at consumption, 2-dp per line) + approved direct cost
  = total; finished unit cost = total ÷ quantity (4 dp); moving average blends the _total_ so value is exact. Journal:
  Dr Inventory(finished category account) total · Cr Inventory(each component's category account) consumed value ·
  Cr Assembly Cost account (new `PostingSettings.assemblyCostAccountId`; required when direct cost > 0 — fail closed).
  **Fixture**: A 2×10 + B 1×15 + direct 5 = 40 → Dr FG 40 / Cr A 20 / Cr B 15 / Cr Assembly cost 5; stock: A −2, B −1, FG +1 @40.
  Finished-item COGS later uses 40 (components are _not_ costed again).
- **Kit COGS**: `unitCost = Σ qty_c × avg_c` snapshotted per line; Dr COGS / Cr Inventory per component account. No stock
  posting for the kit itself.
- **Outbound delivery and payment-fee costs are not capitalized** (existing FULFILLMENT/TRANSACTION classes unchanged;
  `LandedCostLine` creation additionally rejects any component whose `accountingClass` is FULFILLMENT/TRANSACTION —
  enforcing by class, not only the `capitalizable` flag).
- Returns: sales return replays the original snapshot cost (existing; kit: per component); purchase return unchanged.

## 5. Inventory integrity

- One stock truth: `InventoryMovement` (append-only). Dimensions: product, warehouse, owner (snapshot), (lot/serial and bin
  location: **not implemented anywhere today and not introduced here**, documented gap).
- **Concurrency**: every stock writer first takes `SELECT … FOR UPDATE` on the affected `products` rows **in sorted id order**
  (deadlock-free), then reads on-hand, then writes. **Idempotency**: `InventoryMovement.idempotencyKey` (unique) for
  document-driven writers (`<ref>:<lineId>:<type>`); a duplicate is a 409, not a silent double post.
- **Negative stock**: forbidden (guardian). **Delivery checks availability** (`onHand − reserved ≥ qty`) after releasing the
  order's own reservation in the same transaction (fixes F7).
- On-hand / reserved / available stay derived sums; owner shown on stock cards; **company valuation excludes agent-owned stock**.
- Config changes never rewrite history: recipes are versioned and snapshotted; movements/valuations immutable.

## 6. Ownership (agents)

Physical location ≠ financial ownership. One owner per SKU (existing). **Assembly/kit supported combinations**: all
components and the finished product share the _same_ owner — all company, or all the same agent. Mixed company/agent or
multi-agent combinations are **blocked** (recipe activation and again at transaction time) until an agreement process exists
(**O2**). Agent-owned assembly: physical movements + cost snapshot only, **no company GL**, direct cost must be 0. Agent
kit sales follow the existing agent dispatch (no company invoice, no company COGS). Commission/shipping economics unchanged
(item-type rate, override, predetermined shipping) — the product form shows the applied rate and its source.

## 7. Investor eligibility

Reuse the investor module untouched. Eligibility = may _appear in the opportunity product picker_. API now rejects
agent-owned / service / inactive / non-sellable products (F13). Product page shows eligibility + active linked opportunities
(permission `investment-opportunities.view`) + the existing allocation rule. Turning eligibility off affects new
assignment only (existing behaviour); historical allocations/ProfitCalculations are never rewritten. Profit formula is the
existing one (allocation FIFO; COGS = funded unit cost snapshot) — **no competing formula**; the product page links to it.

## 8. Reconciliation & invariants (what "correct" means)

`InventoryIntegrityService` (+ script + report page), run on demand and in CI integration tests:

- I1 per product+warehouse: movement chain consistent (`before_n = after_{n−1}`, `after = before + qty`).
- I2 no negative on-hand; reserved ≤ on-hand.
- I3 no duplicate idempotency keys / duplicate document-line movements.
- I4 assembly: Σ line values + direct = total = finished value; journal balanced and = total; consumption movements = recipe snapshot × qty.
- I5 kit delivery: component movements = snapshot × qty and COGS posted once per invoice line.
- I6 sub-ledger valuation (Σ onHand × avg, company-owned stock products) vs GL inventory accounts: difference reported with
  known causes (unposted OPENING_BALANCE/transfers, 4-dp rounding bound) — not forced to zero.
- I7 agent-owned stock never in company valuation; movement owner = product owner.

## 9. Workflows delivered (browser journeys A–F in `plan.md`)

A buy+sell same product · B assemble then sell · C sell a kit · D sell a service/course (no movements) · E agent-owned
product · F investor-eligible product. Evidence in `verification.md`.

## 10. Owner decisions (recommended default applied, nothing blocks)

- **O1** GRN/GRNI + three-way match — default: not now (documented adjustment mechanisms in §4).
- **O2** Mixed-owner assembly/kit agreement process — default: blocked.
- **O3** Dropping the deprecated `product_components` table and the `Product.type` column — default: later release, needs approval.
- **O4** Posting landed-cost reversal — default: not in scope (cancel before posting only).
- **O5** Service-only company orders still enter the shipping queue (existing behaviour) — default: unchanged.
- **O6** Production rollout of: widened cost columns, barcode unique index, new permissions grants — default: after local approval.
- **O7** A line sold while the product was a plain stocked item, after the product was later switched to KIT (allowed only at
  zero stock): the invoice re-posts as a plain line, but a _return_ of it is refused (`SALES_RETURN_PRODUCT_NOT_STOCKED`) because a
  kit holds no stock — default: refuse; owner to decide whether such returns go to a component or a write-off.
- **O8** Physical count confirm applies the counted − snapshot difference to the locked current on-hand (sales made after the
  count was opened are preserved) — default kept from the existing behaviour.
- **O9 (accounting decision, NOT taken)** Purchase return valuation (pre-existing, unchanged by R13): the GL credits Inventory
  at the return's net price while the sub-ledger removes the units at the moving average, so each return leaves a
  qty × (return price − average) gap that the integrity report shows under I6. Options: (a) relieve inventory at average and
  post the difference to a price-difference / COGS account (Odoo-style AVCO), or (b) remove the units at the return price from
  the average pool. Needs the owner/accountant to choose; until then the purchase return + re-bill correction path named in
  §4 carries this known gap (visible in I6), and additional later charges use Landed Cost, which reconciles exactly.

### Decisions taken during implementation (recorded)

- Assembly reversal removes the finished goods at **current** average (average unchanged); the GL mirror is completed by an
  `ASSEMBLY_REVERSAL_VARIANCE` entry (Dr/Cr FG inventory vs FG COGS by recorded total − qty × average), so GL = sub-ledger.
- Assembly refuses a component with **no recorded cost** (`ASSEMBLY_COMPONENT_COST_MISSING`); a recorded cost of 0 is allowed.
- Every decreasing writer except the physical count (damage, expired, negative adjustment, purchase return, **transfer out**)
  needs available = on-hand − reserved.
- Landed-cost posting locks the allocated products; its capitalized/variance split is stored in functional currency.
- Cost redaction: `currentCost`/`lastCostUpdate`, invoice `unitCost`, kit snapshot costs, recipe/assembly direct-cost estimates and
  assembly costs are returned only with the existing cost-visibility right; `purchasePrice` (catalog/expected price) is not cost.
- Assembly idempotency keys are scoped to the user who created the order.
- Turning stock tracking off (or making the item a SERVICE) is refused while the product has stock or reservations
  (`PRODUCT_TRACKING_LOCKED`), like the KIT switch — a configuration change can never strand stock or open reservations.
- Recipe versions take effect when activated (`effectiveFrom` = activation time); future-dated versions are not supported.
- Investor eligibility is allowed for company-owned, sellable, ACTIVE **PRODUCT** items of any supply method (purchased,
  assembled or kit); allocation follows the product sold, so a kit's funded units are its kit sales, not its components.
- Duplicate protection by idempotency key covers document-driven movements (invoices, returns, orders, assembly, store-order
  invoices, agent dispatch/returns, physical count). Manual inventory forms (adjustment, transfer, damage, expired, opening
  balance) are single user actions without a key: a double submit is prevented by the form, not by the ledger (limitation).

## 11. Out of scope (stated, not hidden)

Manufacturing scheduling/work orders/routings, lot/serial/expiry, bin-level stock, FIFO/standard costing, fractional
stock quantities, alternate document units, GRN/three-way match, nested kits, multi-company.
