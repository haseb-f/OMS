# Acceptance walkthrough — DEMO-GUIDE-20260924

Environment: https://oms.haseb.org · currency EGP · generated 2026-09-24T09:09:32.714Z

All records below are fictional demo data tagged with the RUN id. Walk them top to bottom.

| Flow                                                                                              | Status |
| ------------------------------------------------------------------------------------------------- | ------ |
| SETUP Master data lookups + demo products/partners/opening stock                                  | PASS   |
| F1 Leads → store orders → Confirm & Post → invoice (idempotency, settlement, validation)          | PASS   |
| F2 Shipping/delivery + separate delivered-then-returned order                                     | PASS   |
| F3 B2B customer: quotation → order → invoice → partial/full receipt → statement                   | PASS   |
| F4 Supplier: RFQ → PO → invoice → partial/full payment → return → statement                       | PASS   |
| F5 Inventory: opening stock, moving average, COGS, valuation, profitability                       | PASS   |
| F6 Duplicate invoice, manual JE lifecycle, generated-JE protection, assets, prepaid, traceability | PASS   |
| F7 Reports reconciliation (TB, GL, P&L vs BS, cash flow, partner statements)                      | PASS   |

## SETUP Master data lookups + demo products/partners/opening stock

- [Product PRD-2026-000017](https://oms.haseb.org/products/14743ed8-3e40-4063-915c-650ed8fc7612) — expect openingStock=100 @ 40, note=shared demo product for flows 1-4
- [Product PRD-2026-000018](https://oms.haseb.org/products/c36133d4-3310-4110-ab13-4701f47b4064) — expect onHand=16, currentCost=33, stockValue=528, cogsOnSaleOf4=132
- [Customer PT-2026-000085](https://oms.haseb.org/sales/customers/f60fec6e-54a5-4d92-a8c8-c2db28d7feb1)
- [Supplier PT-2026-000086](https://oms.haseb.org/purchasing/suppliers/4147041a-83d7-41c8-860d-02e1f63ad8d3)

## F1 Leads → store orders → Confirm & Post → invoice (idempotency, settlement, validation)

- [Lead LD-2026-000073](https://oms.haseb.org/crm/leads/07b032ef-1e6e-48a9-a238-e343c02f8ce1) — expect convertedToOrder=STO-2026-000083
- [Customer PT-2026-000087](https://oms.haseb.org/sales/customers/eb5456f7-a259-464e-8db0-f6428b349e31)
- [StoreOrder STO-2026-000083](https://oms.haseb.org/store-orders/e5cf5e89-c276-49b4-9f13-ce969fa6cafa) — expect total=900, paid=900, outstanding=0, currency=EGP, paymentStatus=FULLY_PAID_RECONCILED
- [Payment PAY-2026-000040](https://oms.haseb.org/store-orders/e5cf5e89-c276-49b4-9f13-ce969fa6cafa) — expect amount=900, status=VERIFIED _(Store-order payment of STO-2026-000083 (Payments tab of the order; the review queue only lists unconfirmed payments))_
- [CustomerReceipt CR-2026-000039](https://oms.haseb.org/sales/payments/9ff8cdf7-71c3-4b7b-bec5-762bb3f9a950) — expect amount=900
  - JE [JV-2026-000235](https://oms.haseb.org/finance/journal-entries/cf98525d-774c-419a-a368-522539b30813)
- [SalesInvoice INV-2026-000057](https://oms.haseb.org/sales/invoices/f7ed0531-f186-4148-b5b3-8a0d1bedf800) — expect grandTotal=900, cogs=80, paymentStatus=PAID
  - JE [JV-2026-000236](https://oms.haseb.org/finance/journal-entries/acbaddfe-78d9-4dbb-bdad-56d9e15b2238)
- [JournalEntry JV-2026-000235](https://oms.haseb.org/finance/journal-entries/cf98525d-774c-419a-a368-522539b30813) — expect debit=900, credit=900 _(Customer receipt JE (Confirm & Post))_
- [JournalEntry JV-2026-000236](https://oms.haseb.org/finance/journal-entries/acbaddfe-78d9-4dbb-bdad-56d9e15b2238) — expect debit=980 _(Store-order invoice JE)_
- [Lead LD-2026-000074](https://oms.haseb.org/crm/leads/01b6e38f-13c8-4e7c-8948-f2c40a8f755c) _(Validation probe — conversion with 0.00 must be refused; stays a lead)_

## F2 Shipping/delivery + separate delivered-then-returned order

- [Lead LD-2026-000075](https://oms.haseb.org/crm/leads/8220d5ea-da6c-482a-9cbd-d2585b3a99bb) — expect convertedToOrder=STO-2026-000084
- [Customer PT-2026-000088](https://oms.haseb.org/sales/customers/514b1ee3-669d-4cf8-85e5-29e8c1e34638)
- [StoreOrder STO-2026-000084](https://oms.haseb.org/store-orders/5fc98c37-6071-429d-818d-606b97d7aa96) — expect total=450, paid=450, shippingCost=30, cogs=40, shipment=DELIVERED
  - JE [JV-2026-000238](https://oms.haseb.org/finance/journal-entries/0769e417-cc2e-43c8-ba85-85f28845d589)
  - JE [JV-2026-000239](https://oms.haseb.org/finance/journal-entries/5b3d187b-ac5f-4e20-b715-3615731f919d)
- [SalesInvoice INV-2026-000058](https://oms.haseb.org/sales/invoices/506521c0-855c-4b79-b698-9891dc7c6815) — expect grandTotal=450, cogs=40
  - JE [JV-2026-000238](https://oms.haseb.org/finance/journal-entries/0769e417-cc2e-43c8-ba85-85f28845d589)
- [Shipment Shipment #1 of STO-2026-000084](https://oms.haseb.org/store-orders/5fc98c37-6071-429d-818d-606b97d7aa96) — expect status=DELIVERED, shippingCost=30
  - JE [JV-2026-000239](https://oms.haseb.org/finance/journal-entries/5b3d187b-ac5f-4e20-b715-3615731f919d)
- [Lead LD-2026-000076](https://oms.haseb.org/crm/leads/2d158a5a-cfd1-4201-946f-8ae4af4f524b) — expect convertedToOrder=STO-2026-000085
- [Customer PT-2026-000089](https://oms.haseb.org/sales/customers/be51a876-64f1-4da0-b609-815ec12a8b27)
- [StoreOrder STO-2026-000085](https://oms.haseb.org/store-orders/ce8522e5-b246-4175-9292-eb9033bf5fcd) — expect total=450, paid=450, returned=450, customerCreditAfterReturn=450
- [SalesInvoice INV-2026-000059](https://oms.haseb.org/sales/invoices/f3ad97b4-9858-44c1-a080-53033e2350c1) — expect grandTotal=450
- [SalesReturn SR-2026-000015](https://oms.haseb.org/sales/returns/fae668c0-7eb5-4ed0-a866-0b19bd09c17d) — expect total=450, stockBack=1, cogsReversed=40, refund=not supported by API — customer holds 450 credit
  - JE [JV-2026-000242](https://oms.haseb.org/finance/journal-entries/90f40266-017d-41a3-94a7-0eb1956e13b6)
- [JournalEntry JV-2026-000242](https://oms.haseb.org/finance/journal-entries/90f40266-017d-41a3-94a7-0eb1956e13b6) _(Sales return reversal JE)_

## F3 B2B customer: quotation → order → invoice → partial/full receipt → statement

- [CustomerReceipt CR-2026-000042](https://oms.haseb.org/sales/payments/75491670-310c-4679-a0d6-4dc1be6dde41) — expect amount=600, allocatedTo=INV-2026-000060
  - JE [JV-2026-000244](https://oms.haseb.org/finance/journal-entries/f57d1884-9bb2-459e-b4e0-15f2f4c1e1e1)
- [CustomerReceipt CR-2026-000043](https://oms.haseb.org/sales/payments/0b40440b-ebfe-44bc-9371-76c8b1ee3cac) — expect amount=900, allocatedTo=INV-2026-000060
  - JE [JV-2026-000245](https://oms.haseb.org/finance/journal-entries/16348788-de1a-456f-a8c4-d0bf686d063d)
- [SalesQuotation QT-2026-000014](https://oms.haseb.org/sales/quotations/877deb70-7729-4373-bd5e-5a0db32be8fb) — expect total=1500, status=APPROVED
- [SalesOrder SO-2026-000012](https://oms.haseb.org/sales/orders/be3c74b6-b902-4379-8600-c428169258ab) — expect total=1500
- [SalesInvoice INV-2026-000060](https://oms.haseb.org/sales/invoices/d2f60051-6ccd-4b71-87fe-33d2e0e4da89) — expect grandTotal=1500, paymentStatus=PAID, cogs=120
  - JE [JV-2026-000243](https://oms.haseb.org/finance/journal-entries/d3bcc930-2184-4c2d-a7e4-a7783fa95699)
- [PartnerStatement PT-2026-000085](https://oms.haseb.org/reports/finance?report=customerStatement&partner=f60fec6e-54a5-4d92-a8c8-c2db28d7feb1) — expect opening=0, closing=0

## F4 Supplier: RFQ → PO → invoice → partial/full payment → return → statement

- [SupplierPayment SP-2026-000023](https://oms.haseb.org/purchasing/payments/22ea5f78-5246-4553-b6a7-760d079622c8) — expect amount=200
  - JE [JV-2026-000247](https://oms.haseb.org/finance/journal-entries/2b1b6f15-eeea-4459-91da-a9d7416673aa)
- [SupplierPayment SP-2026-000024](https://oms.haseb.org/purchasing/payments/21bba09e-d1aa-4e1c-97a0-83276cbc07d9) — expect amount=150
  - JE [JV-2026-000248](https://oms.haseb.org/finance/journal-entries/9d425a35-c403-43ab-afed-fd859c536be6)
- [PurchaseQuotation PQ-2026-000003](https://oms.haseb.org/purchasing/purchase-quotations/e294e7fe-dc49-40d3-97df-670328a93d6b) — expect total=350
- [PurchaseOrder PO-2026-000004](https://oms.haseb.org/purchasing/purchase-orders/f98d36f9-01cb-4653-94d2-ee3a26d75256) — expect total=350, status=APPROVED
- [PurchaseInvoice PI-2026-000032](https://oms.haseb.org/purchasing/purchase-invoices/9b454c23-67af-44df-aca6-aa2d6332609e) — expect grandTotal=350, paymentStatus=PAID
  - JE [JV-2026-000246](https://oms.haseb.org/finance/journal-entries/2a0482bb-e763-49a7-8595-d325f62069d7)
- [PurchaseReturn PR-2026-000008](https://oms.haseb.org/purchasing/purchase-returns/56ef4bfd-8db5-45db-b987-edf791d0a691) — expect total=70
  - JE [JV-2026-000249](https://oms.haseb.org/finance/journal-entries/f41a23a8-d358-41a5-a685-6f6f1025f9dc)
- [PartnerStatement PT-2026-000086](https://oms.haseb.org/reports/finance?report=supplierStatement&partner=4147041a-83d7-41c8-860d-02e1f63ad8d3) — expect closing=70, closingMeaning=supplier owes 70 (return after full payment)

## F5 Inventory: opening stock, moving average, COGS, valuation, profitability

- [PurchaseInvoice PI-2026-000033](https://oms.haseb.org/purchasing/purchase-invoices/299cc744-379c-4794-8482-4a403ea1ed7f) — expect grandTotal=360, layer=10 @ 36
- [SalesInvoice INV-2026-000061](https://oms.haseb.org/sales/invoices/9ee7b23f-4e3c-49bb-a24d-35bfd99fde7b) — expect grandTotal=240, cogs=132
  - JE [JV-2026-000251](https://oms.haseb.org/finance/journal-entries/04ae5e5d-445b-4014-a8a4-9dfcc9594a29)
- [InventoryMovements DEMO-GUIDE-20260924 Book Lab movements](https://oms.haseb.org/inventory/movements) — expect onHand=16

## F6 Duplicate invoice, manual JE lifecycle, generated-JE protection, assets, prepaid, traceability

- [SalesInvoice INV-2026-000062](https://oms.haseb.org/sales/invoices/842d44d3-d4ff-446a-bde5-51ed0ed61631) — expect status=DRAFT, grandTotal=1500 _(Duplicated draft — never posted)_
- [JournalEntry JV-2026-000252](https://oms.haseb.org/finance/journal-entries/31d9f015-e7e9-4a9e-9275-73f8e35a59e5) — expect debit=20, credit=20, status=POSTED _(Manual JE: draft → edit → post → reset → repost)_
- [FixedAsset FA-2026-000013](https://oms.haseb.org/finance/fixed-assets) — expect cost=1200, monthlyDepreciation=100, usefulLifeMonths=12
  - JE [JV-2026-000253](https://oms.haseb.org/finance/journal-entries/4171ca21-d0f3-4795-8b58-3fb1ce571519)
- [PrepaidExpense PE-2026-000018](https://oms.haseb.org/finance/prepaid-expenses) — expect amount=300, periods=3, perPeriod=100
  - JE [JV-2026-000254](https://oms.haseb.org/finance/journal-entries/0f808600-3da6-4a7b-bbd8-ae945c52f186)

## F7 Reports reconciliation (TB, GL, P&L vs BS, cash flow, partner statements)

- [Report Trial Balance (RUN range)](https://oms.haseb.org/reports/finance?report=trialBalance) — expect balanced=true, debit=8922
- [Report General Ledger](https://oms.haseb.org/reports/finance?report=generalLedger) — expect glEqualsTb=true
- [Report Balance Sheet](https://oms.haseb.org/reports/finance?report=balanceSheet) — expect balanced=true
- [Report Income Statement](https://oms.haseb.org/reports/finance?report=incomeStatement)
- [Report Cash Flow](https://oms.haseb.org/reports/finance?report=cashFlow)
