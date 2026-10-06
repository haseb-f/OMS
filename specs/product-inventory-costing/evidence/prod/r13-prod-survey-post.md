# R13 Production survey — post-deploy (2026-10-06T15:51:32.437Z)

Read-only (login + GET only) as the QA admin.

- PASS API login (QA admin) — qa-admin@oms.haseb.org
- PASS products readable — 41 products
- PASS stock cards readable — 35 cards
- PASS no duplicate barcodes (unique index will be created) — 0 duplicate groups
- PASS products expose supplyMethod
- PASS GET /assembly?pageSize=5 — status 200
- PASS GET /inventory/integrity — status 200
- PASS integrity: no FAIL invariants — I1:PASS I2:PASS I3:PASS I4:PASS I5:PASS I6:PASS I7:PASS
- PASS GET /products/:id/effective-defaults — status 200
- PASS GET /products/:id/investment-links — status 200
- PASS GET /products/similar-names?name=%D9%85%D9%86%D8%AA%D8%AC%20%D8%A7%D8%AE%D8%AA%D8%A8%D8%A7%D8%B1 — status 200

## Review list

```json
{
  "phase": "post",
  "at": "2026-10-06T15:51:30.655Z",
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
      "PURCHASED": 40,
      "ASSEMBLED": 1
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
      "supplyMethod": "ASSEMBLED",
      "route": "/products/6ba85694-5fac-48ae-b501-8de7263d0774/recipes",
      "httpStatus": 200,
      "lines": 0
    }
  ],
  "barcodeDuplicates": [],
  "stockWithoutCost": 0,
  "investmentFlagWouldBeBlocked": [],
  "integrity": [
    {
      "id": "I1",
      "status": "PASS",
      "violations": 0
    },
    {
      "id": "I2",
      "status": "PASS",
      "violations": 0
    },
    {
      "id": "I3",
      "status": "PASS",
      "violations": 0
    },
    {
      "id": "I4",
      "status": "PASS",
      "violations": 0
    },
    {
      "id": "I5",
      "status": "PASS",
      "violations": 0
    },
    {
      "id": "I6",
      "status": "PASS",
      "violations": 0
    },
    {
      "id": "I7",
      "status": "PASS",
      "violations": 0
    }
  ]
}
```
