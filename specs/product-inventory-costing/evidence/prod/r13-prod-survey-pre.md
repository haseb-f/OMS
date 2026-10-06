# R13 Production survey — pre-deploy (2026-10-06T08:39:58.994Z)

Read-only (login + GET only) as the QA admin.

- PASS API login (QA admin) — qa-admin@oms.haseb.org
- PASS products readable — 41 products
- PASS stock cards readable — 35 cards
- PASS no duplicate barcodes (unique index will be created) — 0 duplicate groups

## Review list

```json
{
  "phase": "pre",
  "at": "2026-10-06T08:39:58.992Z",
  "totals": {
    "products": 41,
    "byLegacyType": {
      "PURCHASE_AND_SALE": 29,
      "SALES_ONLY": 3,
      "SERVICE": 6,
      "PURCHASE_ONLY": 2,
      "MANUFACTURED": 1
    },
    "byItemType": {
      "PRODUCT": 35,
      "SERVICE": 6
    },
    "bySupplyMethod": {
      "(pre-R13)": 41
    },
    "agentOwned": 5,
    "stockCards": 35
  },
  "unclassifiedItemType": 0,
  "serviceButStockTracked": [],
  "manufacturedWithBom": [
    {
      "id": "6ba85694-5fac-48ae-b501-8de7263d0774",
      "sku": "PRD-2026-000041",
      "name": "كومبو بوكس اهم 5000 كلمة",
      "type": "MANUFACTURED",
      "itemType": "PRODUCT",
      "status": "ACTIVE",
      "supplyMethod": null,
      "route": "/products/6ba85694-5fac-48ae-b501-8de7263d0774/components",
      "httpStatus": 200,
      "lines": 0
    }
  ],
  "barcodeDuplicates": [],
  "stockWithoutCost": 0,
  "investmentFlagWouldBeBlocked": []
}
```
