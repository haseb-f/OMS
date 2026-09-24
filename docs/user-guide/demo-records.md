# سجلات التجربة — DEMO-GUIDE-20260924

بيئة: https://oms.haseb.org · عملة **EGP** · احتفظ بهذه السجلات للشرح والتدريب. المبالغ أدناه هي **المتوقع من فهرس الجولة** وقت التشغيل.

## منتجات ومخزون

| السجل                    | الرابط                                                              | المتوقع                                                      |
| ------------------------ | ------------------------------------------------------------------- | ------------------------------------------------------------ |
| PRD-2026-000017 Book     | https://oms.haseb.org/products/14743ed8-3e40-4063-915c-650ed8fc7612 | افتتاحي 100 @ 40                                             |
| PRD-2026-000018 Book Lab | https://oms.haseb.org/products/c36133d4-3310-4110-ab13-4701f47b4064 | onHand **16**، تكلفة **33**، قيمة 528، COGS لـ 4 وحدات = 132 |

## F1 — متجر مدفوع جاهز للشحن

| السجل           | الرابط                                                                             | المتوقع                                                                      |
| --------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| LD-2026-000073  | https://oms.haseb.org/crm/leads/07b032ef-1e6e-48a9-a238-e343c02f8ce1               | حُوّل إلى STO-2026-000083                                                    |
| STO-2026-000083 | https://oms.haseb.org/store-orders/e5cf5e89-c276-49b4-9f13-ce969fa6cafa            | **900** مدفوع، outstanding 0، `FULLY_PAID_RECONCILED`، جاهز للشحن / لم يُشحن |
| PAY-2026-000040 | (تبويب مدفوعات الطلب أعلاه)                                                        | 900، VERIFIED                                                                |
| CR-2026-000039  | https://oms.haseb.org/sales/payments/9ff8cdf7-71c3-4b7b-bec5-762bb3f9a950          | 900                                                                          |
| JV-2026-000235  | https://oms.haseb.org/finance/journal-entries/cf98525d-774c-419a-a368-522539b30813 | قبض 900/900                                                                  |
| INV-2026-000057 | https://oms.haseb.org/sales/invoices/f7ed0531-f186-4148-b5b3-8a0d1bedf800          | 900، PAID، COGS 80                                                           |
| JV-2026-000236  | https://oms.haseb.org/finance/journal-entries/acbaddfe-78d9-4dbb-bdad-56d9e15b2238 | قيد الفاتورة                                                                 |
| LD-2026-000074  | https://oms.haseb.org/crm/leads/01b6e38f-13c8-4e7c-8948-f2c40a8f755c               | رفض تحويل بمبلغ 0 — يبقى عميلاً محتملاً                                      |

## F2 — تسليم ومرتجع

| السجل                   | الرابط                                                                             | المتوقع                                                       |
| ----------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| STO-2026-000084         | https://oms.haseb.org/store-orders/5fc98c37-6071-429d-818d-606b97d7aa96            | 450 مدفوع، شحن **30**، COGS **40**، DELIVERED                 |
| INV-2026-000058         | https://oms.haseb.org/sales/invoices/506521c0-855c-4b79-b698-9891dc7c6815          | 450، COGS 40                                                  |
| JV-2026-000239          | https://oms.haseb.org/finance/journal-entries/5b3d187b-ac5f-4e20-b715-3615731f919d | تكلفة شحن 30                                                  |
| STO-2026-000085         | https://oms.haseb.org/store-orders/ce8522e5-b246-4175-9292-eb9033bf5fcd            | 450 مدفوع ثم مرتجع 450 → رصيد دائن عميل 450 (قبل الرد النقدي) |
| عميل C · PT-2026-000089 | https://oms.haseb.org/sales/customers/be51a876-64f1-4da0-b609-815ec12a8b27         | DEMO-GUIDE Customer C Return                                  |
| SR-2026-000014          | (مرتجع سابق على الإنتاج)                                                           | أساس CRF-2026-000001                                          |
| SR-2026-000015          | https://oms.haseb.org/sales/returns/fae668c0-7eb5-4ed0-a866-0b19bd09c17d           | 450، مخزون +1، عكس COGS 40؛ ثم رُدّ نقداً عبر CRF-2026-000002 |
| JV-2026-000242          | https://oms.haseb.org/finance/journal-entries/90f40266-017d-41a3-94a7-0eb1956e13b6 | قيد المرتجع                                                   |

## استرداد نقدي عميل (CRF) — إنتاج + DEMO-GUIDE-GAP-20260924

| السجل           | الرابط / المسار                                                                         | المتوقع                                                                                                                 |
| --------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| CRF-2026-000001 | قائمة: https://oms.haseb.org/sales/payments?view=refunds · تفاصيل: `/sales/refunds/:id` | **CONFIRMED**، **450**، ضد **SR-2026-000014**                                                                           |
| CRF-2026-000002 | كما فوق                                                                                 | **CONFIRMED**، **450**، ضد **SR-2026-000015** (Customer C)؛ بعد التأكيد `refundableAmount=0`، `customerCreditBalance=0` |
| SR-2026-000016  | https://oms.haseb.org/sales/returns/0100c156-884a-4812-8108-0cad35db1fae                | أساس حوار UI؛ بعد CRF-003: `refundableAmount=0`                                                                         |
| CRF-2026-000003 | https://oms.haseb.org/sales/refunds/f0411870-1db0-4a13-8e24-2697568cb22e                | **CONFIRMED**، **200**، ضد SR-016 عبر واجهة «رد مبلغ»                                                                   |
| JV-2026-000270  | https://oms.haseb.org/finance/journal-entries/52f745b3-6bb2-4f31-902e-50d918f1d18e      | قيد رد العميل — **POSTED** 200/200                                                                                      |
| LD-2026-000081  | https://oms.haseb.org/crm/leads/2f3339af-a80f-41c9-9d55-9e9dcbc9016b                    | إنشاء من الواجهة — DEMO-GUIDE-GAP عميل واجهة Soft                                                                       |

API: `GET/POST /financial-transactions/refunds` · `POST .../confirmed` · `GET .../refundable/:id`  
مرجع التصحيح: [evidence/VERSION-REFUND-RESOLUTION.md](./evidence/VERSION-REFUND-RESOLUTION.md) · [GAP-STATUS.json](./evidence/DEMO-GUIDE-GAP-20260924/GAP-STATUS.json)

## F3 — B2B

| السجل                   | الرابط                                                                      | المتوقع                          |
| ----------------------- | --------------------------------------------------------------------------- | -------------------------------- |
| عميل B2B PT-2026-000085 | https://oms.haseb.org/sales/customers/f60fec6e-54a5-4d92-a8c8-c2db28d7feb1  | —                                |
| QT-2026-000014          | https://oms.haseb.org/sales/quotations/877deb70-7729-4373-bd5e-5a0db32be8fb | 1500 APPROVED                    |
| SO-2026-000012          | https://oms.haseb.org/sales/orders/be3c74b6-b902-4379-8600-c428169258ab     | 1500                             |
| INV-2026-000060         | https://oms.haseb.org/sales/invoices/d2f60051-6ccd-4b71-87fe-33d2e0e4da89   | 1500، PAID بعد القبضين، COGS 120 |
| CR-2026-000042          | https://oms.haseb.org/sales/payments/75491670-310c-4679-a0d6-4dc1be6dde41   | 600 جزئي                         |
| CR-2026-000043          | https://oms.haseb.org/sales/payments/0b40440b-ebfe-44bc-9371-76c8b1ee3cac   | 900 مكمل                         |

> بعد F5 قد يظهر على كشف B2B رصيد مفتوح 240 من فاتورة مختبر لاحقة — راجع F7 لا لقطة F3 وحدها.

## F4 — مشتريات

| السجل                | الرابط                                                                                    | المتوقع      |
| -------------------- | ----------------------------------------------------------------------------------------- | ------------ |
| مورد PT-2026-000086  | https://oms.haseb.org/purchasing/suppliers/4147041a-83d7-41c8-860d-02e1f63ad8d3           | —            |
| PQ-2026-000003       | https://oms.haseb.org/purchasing/purchase-quotations/e294e7fe-dc49-40d3-97df-670328a93d6b | 350          |
| PO-2026-000004       | https://oms.haseb.org/purchasing/purchase-orders/f98d36f9-01cb-4653-94d2-ee3a26d75256     | APPROVED 350 |
| PI-2026-000032       | https://oms.haseb.org/purchasing/purchase-invoices/9b454c23-67af-44df-aca6-aa2d6332609e   | 350 ثم PAID  |
| SP-2026-000023 / 024 | مدفوعات 200 ثم 150                                                                        | —            |
| PR-2026-000008       | https://oms.haseb.org/purchasing/purchase-returns/56ef4bfd-8db5-45db-b987-edf791d0a691    | 70           |

## F5 / F6 مختارات

| السجل           | المتوقع                                  |
| --------------- | ---------------------------------------- |
| PI-2026-000033  | 360 = 10 @ 36                            |
| INV-2026-000061 | 240، COGS 132                            |
| INV-2026-000062 | DRAFT مكرر 1500 — لا يُرحَّل             |
| JV-2026-000252  | قيد يدوي 20/20 POSTED                    |
| FA-2026-000013  | تكلفة 1200، عمر 12 شهراً، إهلاك شهري 100 |
| PE-2026-000018  | 300 على 3 فترات (100 للفترة)             |

## F7 — تقارير

| التقرير      | رابط                                                         | ملاحظة                   |
| ------------ | ------------------------------------------------------------ | ------------------------ |
| ميزان مراجعة | https://oms.haseb.org/reports/finance?report=trialBalance    | متوازن؛ نطاق الجولة 8922 |
| أستاذ عام    | https://oms.haseb.org/reports/finance?report=generalLedger   | يطابق الميزان            |
| ميزانية      | https://oms.haseb.org/reports/finance?report=balanceSheet    | A = L + E                |
| قائمة دخل    | https://oms.haseb.org/reports/finance?report=incomeStatement | NI يطابق أرباح الميزانية |
| تدفق نقدي    | https://oms.haseb.org/reports/finance?report=cashFlow        | يعمل                     |

دليل ممشى كامل: [evidence/DEMO-GUIDE-20260924/walkthrough.md](./evidence/DEMO-GUIDE-20260924/walkthrough.md)
