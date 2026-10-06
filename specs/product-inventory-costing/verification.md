# R13 — Verification (local review stack)

Status of the R13 claims in `spec.md`. Everything below was run on the **local** review stack only — API
`http://localhost:4805` (production build) + web `http://localhost:4801` (production build) on database `oms_r13_demo`
(clone of the pre-R13 verification DB with the R13 migration applied). No remote host, no `oms` database. All business
records were created through the API / UI as real users (Super Admin `demo-r7-admin`, agent admin
`agent-a-admin.demo-agt`); SQL was used read-only for assertions. Records are tagged `[R13-DEMO]`.

| Suite                                                              | Script                                                                           | Result                                           | Evidence                                                                                          |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| API journeys A–F + cross-cutting + integrity                       | `scripts/acceptance/r13/r13-journeys.mjs` (run WBSF76, 2026-10-06T06:58:26.004Z) | **111/111 PASS**                                 | [r13-journeys.md](evidence/journeys/r13-journeys.md), [json](evidence/journeys/r13-journeys.json) |
| Browser (one pass, headless, 1440×900 + 390×844, Arabic + English) | `scripts/acceptance/r13/r13-browser.mjs` (2026-10-06T06:55:52.737Z)              | **176/176 PASS**, 106 screenshots                | [r13-browser.md](evidence/browser/r13-browser.md), [json](evidence/browser/r13-browser.json)      |
| Integrity CLI on the whole DB                                      | `apps/api/scripts/r13/r13-integrity.ts`                                          | I1–I5, I7 PASS · I6 WARN (pre-existing) · exit 0 | [integrity-cli-oms_r13_demo.md](evidence/journeys/integrity-cli-oms_r13_demo.md)                  |

The journeys were executed three times on the same database (exploratory run WB0LIY — its 9 FAILs were wrong Posting Settings field names in the script, fixed — then WB2XKJ 110/110 and the final
WBSF76); the browser pass uses the records of run WB2XKJ (ids in
[r13-browser-context-WB2XKJ.json](evidence/browser/r13-browser-context-WB2XKJ.json)). Re-running is safe: every run creates
its own tagged products, partners and documents.

```bash
API=http://localhost:4805 R13_DB=oms_r13_demo node scripts/acceptance/r13/r13-journeys.mjs   # exit 1 on any FAIL
BASE=http://localhost:4801 node scripts/acceptance/r13/r13-browser.mjs                         # needs the journeys context
```

## Quality gates (run by the Master)

- API unit suite (merged tree, DB `oms_r13`): 179 suites / 2243 tests — 177 suites passed in the parallel run; `leads/sales-flow.hardening` (load timeout) passes alone; `products-r13` exposed a real defect (similar-name candidates cut before ranking) → fixed in a125696d, 30/30 pass.
- Serial (DB) suites: 13 suites / 139 tests — 2 failures found and fixed (kit spec left an owner-flipped fixture → I7; `-0` cents helper in ledger-reconciliation); re-run of the affected suites 38/38 pass.
- Typecheck api + web: clean. ESLint/Prettier: clean on every changed file (per workstream).
- Production builds: `nest build` exit 0; `next build` exit 0 (first attempt failed only on a Google-Fonts network fetch, retried).

## Journeys

Amounts are in the functional currency (SAR on this database). "INV", "COGS", "AP", "AR", "REV" are the Posting Settings
accounts; journal figures are read from the posted journal lines of the document (`GET /journal-entries?sourceType&sourceId`).

### Setup (via the API as Super Admin) — 4/4 PASS

|   # | Step / check                                            | Expected | Observed                             | Result |
| --: | ------------------------------------------------------- | -------- | ------------------------------------ | ------ |
|   1 | functional currency configured                          | set      | a02266c9-3c6b-4da0-a759-b66221d88c1e | PASS   |
|   2 | PostingSettings.assemblyCostAccountId set               | set      | d7624474-c738-4c17-bcd2-c8a968f0eba7 | PASS   |
|   3 | posting window: fiscal year for today is open (or none) | OPEN     | FY2026-Import-Test OPEN              | PASS   |
|   4 | setup: warehouse, unit, category, supplier, customer    | all ids  | WH=bce10b3e                          | PASS   |

### A — Buy and sell the same product — 27/27 PASS

Browser evidence (desktop / Arabic; the same names exist for desktop-en, mobile-ar, mobile-en): [desktop-ar-13-landed-cost](evidence/browser/desktop-ar-13-landed-cost.png), [desktop-ar-13b-landed-cost-bottom](evidence/browser/desktop-ar-13b-landed-cost-bottom.png)

|   # | Step / check                                                                   | Expected                    | Observed                 | Result |
| --: | ------------------------------------------------------------------------------ | --------------------------- | ------------------------ | ------ |
|   1 | one product is both purchasable and sellable, tracked                          | buy+sell+tracked, PURCHASED | true/true/true/PURCHASED | PASS   |
|   2 | PO converts to a draft purchase invoice                                        | DRAFT linked to PO          | DRAFT PI-2026-000037     | PASS   |
|   3 | purchase invoice confirmed, PO closed                                          | CONFIRMED / CLOSED          | CONFIRMED / CLOSED       | PASS   |
|   4 | receipt: on-hand 10                                                            | 10                          | 10                       | PASS   |
|   5 | receipt: moving average 10                                                     | 10                          | 10                       | PASS   |
|   6 | receipt movement PURCHASE_RECEIPT +10                                          | 1 × +10                     | PURCHASE_RECEIPT10       | PASS   |
|   7 | purchase journal Dr Inventory 100 / Cr AP 100, balanced                        | Dr INV 100 · Cr AP 100      | INV 100 AP -100          | PASS   |
|   8 | order confirm reserves 4 (available 6)                                         | 10/4/6                      | 10/4/6                   | PASS   |
|   9 | invoice delivers: on-hand 6, reservation released, available 6                 | 6/0/6                       | 6/0/6                    | PASS   |
|  10 | one SALES_DELIVERY −4 for the invoice                                          | 1 × −4                      | SALES_DELIVERY-4         | PASS   |
|  11 | invoice line unit cost = average 10                                            | 10                          | 10                       | PASS   |
|  12 | COGS = 4 × 10 = 40, Cr Inventory 40, journal balanced                          | COGS 40                     | COGS 40 INV -40          | PASS   |
|  13 | revenue 100 posted                                                             | 100                         | 100                      | PASS   |
|  14 | landed cost split: capitalized = 30 × min(10,6)/10 = 18                        | 18                          | 18                       | PASS   |
|  15 | landed cost split: COGS variance = 12                                          | 12                          | 12                       | PASS   |
|  16 | landed cost document has a frozen exchange rate                                | not null                    | 1                        | PASS   |
|  17 | landed cost journal Dr Inventory 18 / Dr COGS 12 / Cr 30, balanced             | 18 / 12                     | INV 18 COGS 12           | PASS   |
|  18 | average moves only by the capitalized part: (6×10+18)/6 = 13                   | 13                          | 13                       | PASS   |
|  19 | return: on-hand 7                                                              | 7                           | 7                        | PASS   |
|  20 | return restores at snapshot cost 10 (not current 13): Dr INV 10 / Cr COGS 10   | 10 / −10                    | INV 10 COGS -10          | PASS   |
|  21 | average after return blends the snapshot: (78+10)/7 = 12.5714                  | 12.5714                     | 12.5714                  | PASS   |
|  22 | concurrent confirm: at least one succeeds, the other is refused or a no-op     | ≥1 OK                       | 200 / 400                | PASS   |
|  23 | concurrent confirm delivers once (1 movement, −1)                              | 1 × −1                      | -1                       | PASS   |
|  24 | concurrent confirm posts one journal                                           | 1                           | 1                        | PASS   |
|  25 | on-hand after concurrent confirm = 6                                           | 6                           | 6                        | PASS   |
|  26 | no second product record: purchase, sale and return reference the same product | 1 product                   | named=1 referenced=1     | PASS   |
|  27 | integrity I1–I3 PASS for the product                                           | PASS                        | I1=PASS I2=PASS I3=PASS  | PASS   |

### B — Assemble and sell — 21/21 PASS

Browser evidence (desktop / Arabic; the same names exist for desktop-en, mobile-ar, mobile-en): [desktop-ar-07-product-assembled-recipe](evidence/browser/desktop-ar-07-product-assembled-recipe.png), [desktop-ar-07b-product-assembled-recipe-bottom](evidence/browser/desktop-ar-07b-product-assembled-recipe-bottom.png), [desktop-ar-08-assembly-list](evidence/browser/desktop-ar-08-assembly-list.png), [desktop-ar-09-assembly-new-preview-1](evidence/browser/desktop-ar-09-assembly-new-preview-1.png), [desktop-ar-10-assembly-detail](evidence/browser/desktop-ar-10-assembly-detail.png), [desktop-ar-10b-assembly-detail-bottom](evidence/browser/desktop-ar-10b-assembly-detail-bottom.png)

|   # | Step / check                                                                     | Expected                                               | Observed                                                                                                                                                                     | Result |
| --: | -------------------------------------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
|   1 | ASSEMBLED product is stock-tracked                                               | tracked ASSEMBLED                                      | true ASSEMBLED                                                                                                                                                               | PASS   |
|   2 | recipe created as DRAFT v1                                                       | DRAFT v1                                               | DRAFT v1                                                                                                                                                                     | PASS   |
|   3 | recipe activated                                                                 | ACTIVE                                                 | ACTIVE                                                                                                                                                                       | PASS   |
|   4 | components received at A=10, B=15                                                | 10 / 15                                                | 10 / 15                                                                                                                                                                      | PASS   |
|   5 | recipe cost estimate = 2×10 + 1×15 + 5 = 40 (labelled estimate)                  | 40                                                     | 40 isEstimate=true                                                                                                                                                           | PASS   |
|   6 | preview: can assemble, max 2                                                     | true / 2                                               | true / 2                                                                                                                                                                     | PASS   |
|   7 | assembly created (201)                                                           | 201                                                    | 201                                                                                                                                                                          | PASS   |
|   8 | idempotent retry returns the same order (200)                                    | 200 ASM-2026-000005                                    | 200 ASM-2026-000005                                                                                                                                                          | PASS   |
|   9 | FG unit cost 40 (component 35 + direct 5)                                        | 40                                                     | unit 40 comp 35 total 40                                                                                                                                                     | PASS   |
|  10 | stock after assembly: A 2 (−2), B 1 (−1), FG 1 (+1) — retry did not double       | 2/1/1                                                  | 2/1/1                                                                                                                                                                        | PASS   |
|  11 | FG moving average 40                                                             | 40                                                     | 40                                                                                                                                                                           | PASS   |
|  12 | consumption + output movements (PRODUCTION_CONSUMPTION ×2, PRODUCTION_OUTPUT ×1) | 2 + 1                                                  | PRODUCTION_OUTPUT1,PRODUCTION_CONSUMPTION-1,PRODUCTION_CONSUMPTION-2                                                                                                         | PASS   |
|  13 | consumption movements trace the recipe (recipeId / parentProductId)              | stamped                                                | 4ff5412b/-,4ff5412b/11360adf,4ff5412b/11360adf                                                                                                                               | PASS   |
|  14 | journal Dr FG 40 / Cr A 20 / Cr B 15 / Cr assembly cost 5, balanced              | 40 / 20 / 15 / 5                                       | Dr INV 40 Cr INV 15,20 Cr ASM 5                                                                                                                                              | PASS   |
|  15 | second assembly reversed                                                         | REVERSED                                               | REVERSED                                                                                                                                                                     | PASS   |
|  16 | reversal restores stock: A 2, B 1, FG 1                                          | 2/1/1                                                  | 2/1/1                                                                                                                                                                        | PASS   |
|  17 | reversed assembly journal nets to zero (original + engine reversal)              | 2 entries, net 0                                       | 2 entries, INV+ASM net 0                                                                                                                                                     | PASS   |
|  18 | insufficient stock refused, message names the component                          | 422 ASSEMBLY_INSUFFICIENT_STOCK naming PRD-2026-001848 | 422 ASSEMBLY_INSUFFICIENT_STOCK Not enough stock in WH-MAIN to assemble 5 × PRD-2026-001850 [R13-DEMO] Assembled FG WBSF76: PRD-2026-001848 [R13-DEMO] Component A WBSF76 ne | PASS   |
|  19 | FG sale COGS = 40                                                                | 40                                                     | 40 / 40                                                                                                                                                                      | PASS   |
|  20 | components NOT costed/moved again on the FG sale                                 | only FG −1                                             | PRD-2026-001850-1                                                                                                                                                            | PASS   |
|  21 | integrity I4 PASS (assembly cost, consumption, journal)                          | PASS                                                   | PASS checked=2                                                                                                                                                               | PASS   |

### C — Sell a kit — 15/15 PASS

Browser evidence (desktop / Arabic; the same names exist for desktop-en, mobile-ar, mobile-en): [desktop-ar-06-product-kit-1](evidence/browser/desktop-ar-06-product-kit-1.png), [desktop-ar-06-product-kit-2](evidence/browser/desktop-ar-06-product-kit-2.png), [desktop-ar-06-product-kit-3](evidence/browser/desktop-ar-06-product-kit-3.png), [desktop-ar-12-sales-invoice-kit](evidence/browser/desktop-ar-12-sales-invoice-kit.png), [desktop-ar-12b-sales-invoice-kit-bottom](evidence/browser/desktop-ar-12b-sales-invoice-kit-bottom.png)

|   # | Step / check                                                          | Expected      | Observed                            | Result |
| --: | --------------------------------------------------------------------- | ------------- | ----------------------------------- | ------ |
|   1 | KIT holds no stock (isInventoryItem=false)                            | false / KIT   | false / KIT                         | PASS   |
|   2 | KIT with track stock refused (PRODUCT_KIT_NOT_STOCKED)                | 422           | 422 PRODUCT_KIT_NOT_STOCKED         | PASS   |
|   3 | kit availability = min(5/1, 6/2) = 3, limited by part 2               | 3 (part 2)    | 3 ([R13-DEMO] Kit Part 2 WBSF76)    | PASS   |
|   4 | order confirm reserves components: part1 2, part2 4                   | 2 / 4         | 2 / 4                               | PASS   |
|   5 | reservations traced to the kit (parentProductId + recipeId)           | 2 stamped     | PRD-2026-001852:4,PRD-2026-001851:2 | PASS   |
|   6 | kit availability after reservation = 1                                | 1             | 1                                   | PASS   |
|   7 | invoice delivers components only: part1 −2, part2 −4                  | −2 / −4       | PRD-2026-001852-4,PRD-2026-001851-2 | PASS   |
|   8 | deliveries stamped parentProductId=kit and recipeId                   | stamped       |                                     | PASS   |
|   9 | no movement and no stock for the kit itself                           | 0 / 0         | 0 / 0                               | PASS   |
|  10 | components after delivery: part1 3 (0 reserved), part2 2 (0 reserved) | 3/0 · 2/0     | 3/0 · 2/0                           | PASS   |
|  11 | kit line unit cost = Σ components = 1×8 + 2×3 = 14, snapshot stored   | 14 + snapshot | 14 snapshot=true                    | PASS   |
|  12 | COGS once = 2 × 14 = 28, Cr Inventory 28, balanced                    | 28            | COGS 28 INV -28                     | PASS   |
|  13 | kit return returns components: part1 +1, part2 +2                     | +1 / +2       | PRD-2026-001852+2,PRD-2026-001851+1 | PASS   |
|  14 | kit return at snapshot cost 14: Dr INV 14 / Cr COGS 14                | 14            | INV 14 COGS -14                     | PASS   |
|  15 | integrity I5 PASS (kit deliveries + COGS once)                        | PASS          | PASS checked=1                      | PASS   |

### D — Sell a service / course — 5/5 PASS

Browser evidence (desktop / Arabic; the same names exist for desktop-en, mobile-ar, mobile-en): [desktop-ar-05-product-service-1](evidence/browser/desktop-ar-05-product-service-1.png), [desktop-ar-05-product-service-2](evidence/browser/desktop-ar-05-product-service-2.png), [desktop-ar-05-product-service-3](evidence/browser/desktop-ar-05-product-service-3.png)

|   # | Step / check                                              | Expected         | Observed                   | Result |
| --: | --------------------------------------------------------- | ---------------- | -------------------------- | ------ |
|   1 | SERVICE: not tracked, sell-only, PURCHASED                | false/true/false | false/true/false/PURCHASED | PASS   |
|   2 | tracking a SERVICE refused (PRODUCT_SERVICE_RULE)         | 422              | 422 PRODUCT_SERVICE_RULE   | PASS   |
|   3 | zero inventory movements                                  | 0                | 0                          | PASS   |
|   4 | zero COGS / inventory lines                               | 0                | COGS 0                     | PASS   |
|   5 | revenue 500 posted (Dr AR 500 / Cr revenue 500), balanced | 500              | REV 500 AR 500             | PASS   |

### E — Agent-owned product — 18/18 PASS

Browser evidence (desktop / Arabic; the same names exist for desktop-en, mobile-ar, mobile-en): [desktop-ar-11-stock-owner](evidence/browser/desktop-ar-11-stock-owner.png)

|   # | Step / check                                                                    | Expected                             | Observed                                                    | Result |
| --: | ------------------------------------------------------------------------------- | ------------------------------------ | ----------------------------------------------------------- | ------ |
|   1 | demo agent A has an active agreement with a shipping rate                       | agreement + rate                     | AGR-2026-0086 EG 100                                        | PASS   |
|   2 | product created owned by the agent                                              | a87c4fb4-3f3d-475f-ad3e-4b7cc961862d | a87c4fb4-3f3d-475f-ad3e-4b7cc961862d                        | PASS   |
|   3 | agent stock received (movement owner = agent)                                   | owner agent, +5                      | a87c4fb4 +5                                                 | PASS   |
|   4 | no company journal for the agent stock receipt                                  | 0                                    | 0                                                           | PASS   |
|   5 | company valuation (owner=COMPANY) excludes the agent item; owner=AGENT shows it | excluded / included                  | false / true                                                | PASS   |
|   6 | agent portal product list shows the item without any cost field                 | listed, no cost                      | listed=true                                                 | PASS   |
|   7 | agent order created through the agent API                                       | created                              | STO-2026-027280                                             | PASS   |
|   8 | agent order response exposes no cost                                            | no cost                              |                                                             | PASS   |
|   9 | internal fulfillment dispatches the agent order (ship)                          | 200                                  | 200                                                         | PASS   |
|  10 | agent order delivered                                                           | 200                                  | 200/200                                                     | PASS   |
|  11 | agent stock issued on dispatch: 5 → 4                                           | 4                                    | 4                                                           | PASS   |
|  12 | delivery movement carries the agent as owner                                    | 1, owner agent                       | -1:a87c4fb4                                                 | PASS   |
|  13 | commission line per policy (12% of 200)                                         | 24                                   | 24 [CUSTOMER_SHIPPING_RETAINED,COMMISSION,SHIPPING_FEE]     | PASS   |
|  14 | shipping fee line per policy (flat fee per shipment)                            | SHIPPING_FEE                         | CUSTOMER_SHIPPING_RETAINED,COMMISSION,SHIPPING_FEE          | PASS   |
|  15 | agent statement (portal) shows the order's lines                                | ≥1                                   | 3 lines: SHIPPING_FEE,COMMISSION,CUSTOMER_SHIPPING_RETAINED | PASS   |
|  16 | agent statement never exposes cost                                              | no cost                              |                                                             | PASS   |
|  17 | NO company GL inventory/COGS posting and no company invoice for the agent goods | 0 / 0                                | 0 / 0                                                       | PASS   |
|  18 | integrity I7 PASS (agent stock outside company books)                           | PASS                                 | PASS                                                        | PASS   |

### F — Investor-eligible product — 8/8 PASS

Browser evidence (desktop / Arabic; the same names exist for desktop-en, mobile-ar, mobile-en): [desktop-ar-15-product-investment](evidence/browser/desktop-ar-15-product-investment.png)

|   # | Step / check                                                                       | Expected                    | Observed                                                                                                                                                            | Result |
| --: | ---------------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
|   1 | company PRODUCT, sellable, ACTIVE → eligibility enabled                            | 200 true                    | 200 true                                                                                                                                                            | PASS   |
|   2 | agent-owned product refused: 422 PRODUCT_INVESTMENT_NOT_ALLOWED reason AGENT_OWNED | 422 AGENT_OWNED             | 422 PRODUCT_INVESTMENT_NOT_ALLOWED AGENT_OWNED                                                                                                                      | PASS   |
|   3 | service product refused: reason SERVICE                                            | 422 SERVICE                 | 422 PRODUCT_INVESTMENT_NOT_ALLOWED SERVICE                                                                                                                          | PASS   |
|   4 | opportunity created with the eligible product                                      | created                     | IOP-2026-000573                                                                                                                                                     | PASS   |
|   5 | product investment-links shows the opportunity                                     | eligible + linked           | true IOP-2026-000573                                                                                                                                                | PASS   |
|   6 | lifecycle open → fund → activate → delivered sale → allocation                     | all steps, 1 unit allocated | open✓ subscribe✓ contribute✓ confirm-funding✓ activate✓ store-order✓ payment✓ payment-confirm✓ generate-invoice✓ ship✓ out-for-delivery✓ deliver✓ allocate✓ units=1 | PASS   |
|   7 | disabling eligibility: allowed, product no longer eligible, link kept              | 200, eligible=false, linked | 200 eligible=false                                                                                                                                                  | PASS   |
|   8 | enabling/disabling eligibility creates or rewrites no allocation                   | identical                   | 1 row(s); global 3/3 → 3/3                                                                                                                                          | PASS   |

### Cross-cutting rules (similar name, barcode, recipe cycle, mixed owner) — 5/5 PASS

Browser evidence (desktop / Arabic; the same names exist for desktop-en, mobile-ar, mobile-en): [desktop-ar-02-product-new-similar-warning](evidence/browser/desktop-ar-02-product-new-similar-warning.png), [desktop-ar-04-product-barcode-duplicate](evidence/browser/desktop-ar-04-product-barcode-duplicate.png)

|   # | Step / check                                                              | Expected               | Observed                                                                                                                                 | Result |
| --: | ------------------------------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------ |
|   1 | similar-name warning lists the near-duplicate                             | listed                 | PRD-2026-001857 SIMILAR                                                                                                                  | PASS   |
|   2 | near-duplicate name is non-blocking (created)                             | 201                    | 201                                                                                                                                      | PASS   |
|   3 | barcode duplicate (case/space-insensitive) → 409 naming the other product | 409 → PRD-2026-001857  | 409 PRODUCT_BARCODE_DUPLICATE PRD-2026-001857                                                                                            | PASS   |
|   4 | recipe cycle refused (RECIPE_CYCLE, names the path)                       | 422 RECIPE_CYCLE       | 422 RECIPE_CYCLE This recipe would make a product part of itself: PRD-2026-001860 [R13-DEMO] Cycle Y WBSF76 → PRD-2026-001859 [R13-DEMO] | PASS   |
|   5 | mixed-owner recipe refused (RECIPE_OWNER_MIXED)                           | 422 RECIPE_OWNER_MIXED | 422 RECIPE_OWNER_MIXED                                                                                                                   | PASS   |

### Integrity on the whole database (API + CLI) — 8/8 PASS

Browser evidence (desktop / Arabic; the same names exist for desktop-en, mobile-ar, mobile-en): [integrity-api](evidence/journeys/integrity-api-oms_r13_demo.json), [integrity-cli.md](evidence/journeys/integrity-cli-oms_r13_demo.md), [desktop-ar-14-integrity](evidence/browser/desktop-ar-14-integrity.png)

|   # | Step / check                                                                                   | Expected      | Observed                                                                                                                                                                                                                     | Result |
| --: | ---------------------------------------------------------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
|   1 | GET /inventory/integrity (whole DB): I1 Movement chain per product and warehouse PASS          | PASS          | PASS checked=722 violations=0                                                                                                                                                                                                | PASS   |
|   2 | GET /inventory/integrity (whole DB): I2 No negative stock; reserved within on-hand PASS        | PASS          | PASS checked=204 violations=0                                                                                                                                                                                                | PASS   |
|   3 | GET /inventory/integrity (whole DB): I3 No duplicate document-line movements PASS              | PASS          | PASS checked=507 violations=0                                                                                                                                                                                                | PASS   |
|   4 | GET /inventory/integrity (whole DB): I4 Assembly orders: cost, consumption and journal PASS    | PASS          | PASS checked=6 violations=0                                                                                                                                                                                                  | PASS   |
|   5 | GET /inventory/integrity (whole DB): I5 Kit sales: component deliveries and COGS once PASS     | PASS          | PASS checked=3 violations=0                                                                                                                                                                                                  | PASS   |
|   6 | GET /inventory/integrity (whole DB): I7 Agent-owned stock stays outside company books PASS     | PASS          | PASS checked=722 violations=0                                                                                                                                                                                                | PASS   |
|   7 | GET /inventory/integrity (whole DB): I6 valuation vs GL is WARN only (pre-existing difference) | WARN          | WARN {"subledgerValue":"397523.85","glBalance":"375612.65","difference":"21911.20","roundingBound":"0.64","inventoryAccounts":1,"openingBalanceMovements":54,"openingBalanceMovementValue":"20231.00","openingBalanceGlOnInv | PASS   |
|   8 | CLI r13-integrity.ts (whole DB): I1–I5, I7 PASS, I6 WARN, exit 0                               | PASS×6 + WARN | exit 0 I1=PASS I2=PASS I3=PASS I4=PASS I5=PASS I6=WARN I7=PASS                                                                                                                                                               | PASS   |

## Browser checks

One headless pass over the affected pages only. Each step asserts `html dir` (rtl in Arabic, ltr in English), no console
errors / uncaught exceptions (the deliberate 409 of the barcode step is the only filtered message) and, at 390 px,
`document.scrollingElement.scrollWidth <= innerWidth + 1`. English is reached with the app's language control (top bar,
desktop and mobile). Cells = passed / total checks of that step.

| Page / step                                          | desktop ar | desktop en | mobile ar | mobile en |
| ---------------------------------------------------- | :--------: | :--------: | :-------: | :-------: |
| product form (new) + similar-name warning            |    2/2     |    2/2     |    3/3    |    3/3    |
| product form: barcode duplicate inline error         |    2/2     |    2/2     |    3/3    |    3/3    |
| product form: service shows no stock fields          |    2/2     |    2/2     |    3/3    |    3/3    |
| product form: kit forces track stock off with reason |    2/2     |    2/2     |    3/3    |    3/3    |
| product detail: assembled item recipe panel          |    2/2     |    2/2     |    3/3    |    3/3    |
| assembly list                                        |    2/2     |    2/2     |    3/3    |    3/3    |
| new-assembly dialog with preview                     |    2/2     |    2/2     |    3/3    |    3/3    |
| assembly detail                                      |    2/2     |    2/2     |    3/3    |    3/3    |
| stock page with owner column                         |    2/2     |    2/2     |    3/3    |    3/3    |
| sales invoice: kit line with delivered components    |    2/2     |    2/2     |    3/3    |    3/3    |
| landed cost detail: capitalized vs variance          |    2/2     |    2/2     |    3/3    |    3/3    |
| integrity report page                                |    2/2     |    2/2     |    3/3    |    3/3    |
| product form: investment section                     |    2/2     |    2/2     |    3/3    |    3/3    |

| Content assertion                                        | desktop ar | desktop en | mobile ar | mobile en |
| -------------------------------------------------------- | :--------: | :--------: | :-------: | :-------: |
| similar-name warning visible (non-blocking)              |    1/1     |    1/1     |    1/1    |    1/1    |
| barcode duplicate shown inline, naming the other product |    1/1     |    1/1     |    1/1    |    1/1    |
| service: 'no stock' note, no track-stock switch          |    1/1     |    1/1     |    1/1    |    1/1    |
| kit: track stock off + locked, reason shown              |    1/1     |    1/1     |    1/1    |    1/1    |
| recipe panel lists the components and an estimate of 40  |    1/1     |    1/1     |    1/1    |    1/1    |
| preview lists component lines and the 40.0000 estimate   |    1/1     |    1/1     |    1/1    |    1/1    |
| owner shown on the stock page                            |    1/1     |    1/1     |    1/1    |    1/1    |
| kit components listed on the invoice                     |    1/1     |    1/1     |    1/1    |    1/1    |
| capitalized 18 and variance 12 shown                     |    1/1     |    1/1     |    1/1    |    1/1    |
| all seven invariants rendered                            |    1/1     |    1/1     |    1/1    |    1/1    |
| investment section shows the linked opportunity          |    1/1     |    1/1     |    1/1    |    1/1    |

Screenshots: `evidence/browser/<viewport>-<lang>-<nn>-<page>[-k].png` (dialogs with expanded sections are captured at
successive scroll positions `-1…-4`).

## Invariants (spec §8)

| Invariant                                         | Pre-R13 clone `oms_r13_mig` | After journeys `oms_r13_demo` (CLI) | Checked | Violations |
| ------------------------------------------------- | --------------------------- | ----------------------------------- | ------: | ---------: |
| I1 Movement chain per product and warehouse       | PASS                        | **PASS**                            |     722 |          0 |
| I2 No negative stock; reserved within on-hand     | PASS                        | **PASS**                            |     204 |          0 |
| I3 No duplicate document-line movements           | PASS                        | **PASS**                            |     507 |          0 |
| I4 Assembly orders: cost, consumption and journal | PASS                        | **PASS**                            |       6 |          0 |
| I5 Kit sales: component deliveries and COGS once  | PASS                        | **PASS**                            |       3 |          0 |
| I6 Inventory valuation vs GL inventory accounts   | WARN                        | **WARN**                            |      75 |          1 |
| I7 Agent-owned stock stays outside company books  | PASS                        | **PASS**                            |     722 |          0 |

**I6** is the only non-PASS invariant and its difference is **unchanged by every R13 flow exercised**: sub-ledger
396820.56 → 397523.85, GL 374909.36 → 375612.65, difference **21911.20 → 21911.20**
(known causes 25182.61, remainder -3271.41, as documented in `migration.md` §5). That is,
purchases, landed cost (capitalized part), assembly, reversal, kit and plain sales, and returns moved the sub-ledger and the
GL inventory account by exactly the same amount, to the cent, across the three runs.

## Defects found

No functional defect was found in journeys A–F, the cross-cutting rules or the affected pages. Observations (none blocking):

| #   | Severity                      | Observation                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Where                                                                                                                                                                 |
| --- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| O-1 | Low (informational)           | Concurrent double `POST /sales/invoices/:id/confirm`: one call returns 200, the other **400 VALIDATION_ERROR** "was changed by someone else — reload and try again" (not an idempotent 200). Stock and GL are correct (one delivery, one journal). The web editor routes confirm through its transition runner (`fx.run`, `apps/web/src/app/(shell)/sales/invoices/invoice-editor-page.tsx:308`); whether a UI double-click can reach the API twice was not tested. | `apps/api/src/sales/invoices/sales-invoices.service.ts:468`                                                                                                           |
| O-2 | Low (pre-existing convention) | Activity-log descriptions are English server text in the Arabic UI, including the new landed-cost split line ("… posted — 18 capitalized into inventory, 12 to cost of goods sold …").                                                                                                                                                                                                                                                                              | `apps/api/src/landed-cost/landed-cost-documents.service.ts:439`; screenshot [mobile-ar-13b-landed-cost-bottom](evidence/browser/mobile-ar-13b-landed-cost-bottom.png) |
| O-3 | Info (demo data)              | Setup on `oms_r13_demo`: `PostingSettings.assemblyCostAccountId` was empty and is now the new postable EXPENSE account **549 "[R13-DEMO] Applied assembly cost"** (created through the API). The first exploratory run (WB0LIY) had temporarily used **521 Shipping / Carrier**: its two assembly orders credited 5.00 each to 521 (one reversed → net 5.00 on 521 in demo data).                                                                                   | demo database only                                                                                                                                                    |

## Covered by DB integration specs instead of the journeys

Several items below the journeys did not exercise are covered by the serial integration specs run in the gates:
agent-owned assembly and mixed-owner refusal (`assembly/assembly.integration.serial.spec.ts`), agent kit dispatch/return,
store-order kit invoice, purchase kit refusal, foreign-currency landed cost, landed cost vs purchase race (H1)
(`sales/kit-fulfillment.integration.serial.spec.ts`), unit conversion / fractional refusals and recipe codes (assembly spec),
damage/expired/count postings, transfers and reservation guards, concurrent last-unit delivery
(`inventory/inventory-hardening.integration.serial.spec.ts`), injected-fault detection of every invariant
(`inventory/integrity/inventory-integrity.integration.serial.spec.ts`). Production data was surveyed read-only through the
API (`evidence/prod/r13-prod-survey-pre.md`, migration.md §4).

## Not verified (scope of this acceptance)

- Production / Supabase, the production migration path and any non-local host (owner gate O6).
- Foreign-currency landed cost and purchase (only the functional currency, frozen rate 1, was exercised).
- Recipe unit conversions, `RECIPE_KIT_FRACTIONAL`, `ASSEMBLY_FRACTIONAL_CONSUMPTION`, batch recipes with `outputQuantity` > 1, nested-kit refusal.
- Agent-owned **assembly** and agent **kit** sales; kits sold through a company StoreOrder `generate-invoice`; service sold through a StoreOrder (D used a B2B sales invoice).
- Purchase returns, damage / expired / physical-count postings (F11), stock transfers, opening-balance wizard.
- Concurrency beyond a two-request race on invoice confirm (parallel deliveries across documents, assembly races, landed cost vs sale).
- Non-admin permission matrix and cost redaction for users without cost visibility (journeys ran as Super Admin; only the agent portal ran as an agent user, where no cost field was found).
- Investor lifecycle after allocation (profit calculation, settlement, distribution, payments).
- Print layouts; dark theme; tablet width; pages outside the affected list; landed-cost reversal (O4, out of scope).
- Integration of these flows with the CI database tests (`*.integration.serial.spec.ts`) — run by the Master, not here.

## UI-driven browser pass (Workstream E3)

`scripts/acceptance/r13/r13-browser-ui.mjs` (headless Playwright, Arabic UI, desktop 1440×900; steps 1 and 5 also at
390×844) against the local production builds (web :4801, API :4805, DB `oms_r13_demo`). Unlike the view-only pass above,
**every record was created and acted on through the UI**; the API was used only for read-only assertions (GET).
Records are tagged `[R13-UI]` (run GZRKP). Result **83/84 PASS** — the one FAIL is defect **D1** below.
Evidence: [r13-browser-ui.md](evidence/browser-ui/r13-browser-ui.md) / [.json](evidence/browser-ui/r13-browser-ui.json), 40 screenshots in `evidence/browser-ui/`.

| Step | What was done through the UI                                                                                                                                                                                                                                                      | Result                                        |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| 0    | Product form category selector searched for the existing category with a default unit; a category with a default unit created in Master data → Categories                                                                                                                         | **FAIL (D1)** / PASS                          |
| 1    | Products → Add product: component X and Y (PURCHASED, tracked), SERVICE (stock fields hidden), KIT (track stock forced off + reason), ASSEMBLED (forced on + reason); unit prefilled with the "from category" hint, success toast + post-create dialog; stored attributes checked | PASS (desktop + mobile, no horizontal scroll) |
| 2    | Near-duplicate name typed → similar-name warning names component X; save still enabled and the product saved                                                                                                                                                                      | PASS                                          |
| 3    | Recipe tab → Create recipe → X×2 + Y×1 → Activate (ASSEMBLED); Y×1 (KIT) → status ACTIVE                                                                                                                                                                                          | PASS                                          |
| 4    | Inventory → Movements → New movement → Opening inventory: X 10 @ 10, Y 5 @ 15; stock page shows 10 / 5                                                                                                                                                                            | PASS                                          |
| 5    | Inventory → Assembly → New assembly: preview (components, needed/available, estimate 35.0000) → ASM- number in the toast → detail (POSTED) → reverse with reason → REVERSED → assemble again from the product page (POSTED); X 8 / Y 4; mobile assembly → X 6 / Y 3               | PASS (desktop + mobile, no horizontal scroll) |
| 6    | Edit component X (has stock), turn Track stock off, save → 409 with the Arabic PRODUCT_TRACKING_LOCKED message in the form; product still tracked                                                                                                                                 | PASS                                          |
| 7    | KIT recipe tab shows "المجموعات المتاحة الآن: 4" = API kit availability                                                                                                                                                                                                           | PASS                                          |
| 8    | Inventory → Integrity: I1–I5, I7 PASS, I6 WARN (known, see above), no FAIL card                                                                                                                                                                                                   | PASS                                          |
| 9    | Agent persona (agent-a-admin.demo-agt): `/agent/stock`, `/agent/orders` render, no cost columns, no console errors                                                                                                                                                                | PASS                                          |
| 10   | Language switched to English on the product list and the assembly list → `dir=ltr`, no console errors                                                                                                                                                                             | PASS                                          |

### Defects found (UI pass)

| #   | Severity                 | Defect                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Where                                                                                                                                                                                                          |
| --- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Medium (grows with data) | The product form's **category** selector (and every `useReference*` select: units, brands, taxes, cost centers) loads only the **first 200 rows** by name (`pageSize: 200`) and then filters on the client, with no server search. With 421 categories / 422 units in `oms_r13_demo`, later-sorting names — including every Arabic-named category (كتب، دورات، اشتراكات) and unit (قطعة) and the `[R13-DEMO]` category with a default unit — **cannot be found or chosen**; the search shows "لا توجد خيارات". Steps: Products → إضافة منتج → الفئة → type `[R13-DEMO] Category WBSF76` → no option. Expected: the category is offered. Screenshot [00a-category-selector-cap](evidence/browser-ui/00a-category-selector-cap.png). The journey continued with a category created in Master data. Fix direction: server-side search (`EntityCombobox` `onSearch`) or loading all pages for reference lists. | `apps/web/src/hooks/use-reference-data.ts:133-143` (categories/units, `pageSize: 200`); used by `components/products/product-form-basics.tsx` and `app/(shell)/master-data/categories/page.tsx` (default unit) |
