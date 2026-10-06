# R13 API contract (backend ↔ web ↔ tests)

Conventions: existing envelope/pagination/error shape of the API is reused (`{ code, message }` on `HttpException` bodies).
All new routes sit behind the standard `JwtAuthGuard` + `PermissionsGuard`. Money = decimal strings, quantities = integers
(stock) / decimal strings (recipe quantities). Nothing here changes an existing route's meaning except where marked **CHANGED**.

## 1. Products (`/products`) — owner: Workstream A

- `POST /products`, `PATCH /products/:id` **CHANGED** body: `itemType` (`PRODUCT|SERVICE`, required on create), `isSellable`,
  `isPurchasable`, `isInventoryItem`, `supplyMethod` (`PURCHASED|ASSEMBLED|KIT`), `ownerAgentId`,
  `availableForInvestmentOpportunities`, plus all existing fields. `type` is **deprecated and ignored** (accepted, never
  required); the stored `type` is derived by one function `deriveLegacyProductType()` from itemType/flags/supplyMethod on every write.
  Defaults when a field is omitted (explicit values always win): PRODUCT → sell+buy, tracked, PURCHASED; SERVICE → sell only,
  not tracked, PURCHASED. Hard rules (422 with `code`): SERVICE ⇒ not tracked & PURCHASED (`PRODUCT_SERVICE_RULE`);
  KIT ⇒ `isInventoryItem=false` (`PRODUCT_KIT_NOT_STOCKED`); ASSEMBLED ⇒ `isInventoryItem=true`;
  changing `supplyMethod` to/from KIT while on-hand ≠ 0 or reservations exist ⇒ 409 `PRODUCT_SUPPLY_METHOD_LOCKED`;
  `availableForInvestmentOpportunities=true` only if company-owned, PRODUCT, sellable, ACTIVE ⇒ else 422
  `PRODUCT_INVESTMENT_NOT_ALLOWED` with `reason` ∈ `AGENT_OWNED|SERVICE|NOT_SELLABLE|NOT_ACTIVE`.
  Owner lock now also counts `product_recipes` (as finished product) and `product_recipe_lines` (as component) rows.
- Barcode: duplicate (case/space-insensitive, non-deleted) ⇒ 409 `{ code:'PRODUCT_BARCODE_DUPLICATE', productId, sku, name }`
  on create/update/import/duplicate-product.
- `GET /products/similar-names?name=&excludeId=&categoryId=` (perm `products.view`) →
  `{ items: [{ id, sku, name, displayName, categoryName, status, match: 'EXACT'|'CONTAINS'|'SIMILAR' }] }` (≤5, Arabic-normalized,
  never blocks).
- `GET /products/:id/effective-defaults` (perm `products.view`) → read-only inheritance:
  `{ unit:{id,name,source:'PRODUCT'|'CATEGORY'}, tax:{id,name,source}|null, accounts:{ inventory|cogs|revenue|purchase:
{ id, code, name, source:'CATEGORY'|'SETTINGS' } | null }, commission: { itemType, rate, source:'ITEM_OVERRIDE'|'AGREEMENT'|null } | null }`
  (accounts only with `finance.view`/`accounting.*.view` — omitted otherwise; commission only for agent-owned).
- `GET /products/:id/investment-links` (perm `products.view`) → `{ eligible, blockedReason|null, opportunities: [...]|null }`
  (`opportunities` only when the caller also has `investment-opportunities.view`, else `null`).
- `ProductCategory` gains `defaultUnitId`, `defaultTaxId` (create/update/list/read of categories).
- Responses include `supplyMethod`, `itemType`, derived `type`, `ownerAgent {id,name}|null`.

## 2. Recipes — owner: Workstream B (`src/recipes`)

- `GET /products/:productId/recipes` → versions desc (plain array), each `{ id, version, status, effectiveFrom, outputQuantity, directCostEstimate (null without the cost-visibility right / `inventory.assembly.direct_cost`), notes, lines:[{ id, componentProductId, componentName, componentSku, quantity, unitId, unitName, sortOrder }] }` (perm `products.view`)
- `POST /products/:productId/recipes` `{ outputQuantity?, directCostEstimate?, notes?, copyFromRecipeId?, lines:[{componentProductId, quantity, unitId}] }` → DRAFT, next version. (perm `products.recipes.manage`)
- `PATCH /recipes/:id` (DRAFT only; `lines` replaces all) · `DELETE /recipes/:id` (DRAFT only) · `POST /recipes/:id/activate` · `POST /recipes/:id/retire`.
  Activation retires the previous ACTIVE in the same transaction and validates (422 `code`): `RECIPE_PRODUCT_NOT_ASSEMBLABLE`
  (product not ASSEMBLED/KIT), `RECIPE_EMPTY`, `RECIPE_CYCLE` (full walk, message names the path), `RECIPE_COMPONENT_NOT_STOCKED`
  (component not a tracked PRODUCT), `RECIPE_NESTED_KIT`, `RECIPE_OWNER_MIXED` (company+agent or two agents),
  `RECIPE_UNIT_CONVERSION_MISSING`, `RECIPE_KIT_FRACTIONAL` (kit line does not convert to whole stock units), `RECIPE_KIT_OUTPUT` (kit outputQuantity ≠ 1).
- `GET /products/:productId/recipe-cost-estimate` → `{ recipeId, version, isEstimate:true, lines:[{componentProductId,name,quantityStock,unitCost,value}], componentsEstimate, directCostEstimate, totalEstimate, perUnitEstimate }` (costs omitted without cost-visibility right, same rule as stock cards).
- `GET /products/:productId/kit-availability?warehouseId=` → `{ productId, available, limiting:{productId,name,available,perKit}|null, components:[{productId,name,perKit,available}] }`.
- **Service API** exported by `RecipesModule` for other modules (C): `RecipeService.getActiveRecipe(tx, productId)`,
  `RecipeService.resolveStockQuantities(tx, recipe, runs)` (unit conversion, whole-number check) and
  `UnitConversionService.convert(qty, fromUnitId, toUnitId)` (direct or inverse, one hop, else throws `UNIT_CONVERSION_MISSING`).

## 3. Stock-line resolution — owner: Workstream B (`src/inventory/stock-lines`), consumed by C

```ts
isStockAffecting(p): boolean   // p.isInventoryItem || p.supplyMethod === 'KIT'
StockLineResolver.resolve(tx, lines: {productId, quantity, warehouseId, lineKey}[]): Promise<{
  stock: { productId, quantity, warehouseId, lineKey, parentProductId?: string, recipeId?: string, recipeVersion?: number }[];
  kitSnapshots: Record<lineKey, { recipeId, version, components: { productId, qtyPerKit, unitCost: string }[] }>;
}>
```

Plain stocked products pass through; KIT lines expand to component stock lines (qtyPerKit × quantity, whole numbers);
SERVICE/non-stock lines are dropped; mixed-owner kit → 422 `KIT_OWNER_MIXED`. `unitCost` = current moving average (for COGS).
`InventoryService.postSalesDelivery / postSalesReturn / postPurchaseReceipt / postPurchaseReturn / reserve / release` accept optional
`idempotencyKey`, `parentProductId`, `recipeId`. Every stock writer takes `SELECT … FOR UPDATE` on affected products (sorted ids)
before reading on-hand. `postSalesDelivery` checks `onHand − reserved ≥ quantity` (after the caller released its own reservation in the same tx).
Duplicate `idempotencyKey` ⇒ 409 `INVENTORY_DUPLICATE_MOVEMENT`.

## 4. Assembly (`/assembly`) — owner: Workstream B (`src/assembly`)

- `GET /assembly/preview?productId&warehouseId&quantity` → `{ canAssemble, blockers:[{code,message}], recipe:{id,version}, lines:[{componentProductId,name,quantity,available,unitCost,value}], componentCost, directCostEstimate, estimatedUnitCost, maximumQuantity }`
- `POST /assembly` `{ productId, warehouseId, quantity, directCost?, notes?, idempotencyKey? }` (header `Idempotency-Key` accepted) →
  AssemblyOrder `{ id, assemblyNumber, status, product, warehouse, recipeVersion, quantity, componentCost, directCost, totalCost, unitCost, lines:[…], outputMovementId, createdAt }`.
  perm `inventory.assembly.create`; `directCost>0` additionally `inventory.assembly.direct_cost` and needs `PostingSettings.assemblyCostAccountId`
  (422 `ASSEMBLY_COST_ACCOUNT_MISSING`). Agent-owned: `directCost` must be 0 (`ASSEMBLY_AGENT_DIRECT_COST`), no GL. Errors:
  `ASSEMBLY_NO_ACTIVE_RECIPE`, `ASSEMBLY_INSUFFICIENT_STOCK` (names component), `ASSEMBLY_FRACTIONAL_CONSUMPTION`, `ASSEMBLY_OWNER_MIXED`, `ASSEMBLY_NOT_ASSEMBLED_PRODUCT`.
- `GET /assembly?productId&status&from&to&page&pageSize` · `GET /assembly/:id` · `POST /assembly/:id/reverse { reason }`
  (perm `inventory.assembly.reverse`; 409 `ASSEMBLY_OUTPUT_CONSUMED` when the finished quantity is no longer on hand; returns components at the recorded unit cost; journal reversed through the Posting Engine).
- Posting document type `ASSEMBLY_ORDER` (provider in `accounting/posting-providers`): Dr finished-item category inventory account (total) ·
  Cr each component's category inventory account (line value) · Cr `assemblyCostAccount` (direct cost). Reversal = engine reversal.

## 5. Inventory reads — owner: Workstream B

- Stock cards / warehouse balances / `getStock` rows add `ownerAgentId`, `ownerAgentName`; new optional query `owner=COMPANY|AGENT|<agentId>`
  (default for company screens: all, with owner shown; valuation totals count COMPANY-owned stock only).
- `GET /inventory/integrity` (perm `inventory.view` + finance) → invariants I1–I7 report (Workstream E).

## 6. Sales/kit/landed cost — owner: Workstream C (no new routes except)

- Existing invoice/return/order/dispatch endpoints behave as described in spec §3–§4; `SalesInvoiceItem.fulfillmentSnapshot` is returned on invoice read.
- `POST /landed-costs/:id/confirm` posts capitalized + variance split; document read includes `exchangeRate`, per-allocation `capitalizedAmount`, `cogsVarianceAmount`.
