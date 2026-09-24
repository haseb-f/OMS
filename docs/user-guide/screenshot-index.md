# فهرس لقطات الشاشة

اللغة الظاهرة في اللقطات المرقّمة: **عربية (RTL)**.  
المجلد الرسمي للدليل: `docs/user-guide/screenshots/`  
لقطات مسح إضافية: `evidence/DEMO-GUIDE-20260924/browser-pages/`

## اللقطات المرقّمة (موجودة)

| الرقم | الملف                                       | الدور / المهمة   | الخطوة    | التسمية التوضيحية                                 | URL                                     | مرجع DEMO                      |
| ----- | ------------------------------------------- | ---------------- | --------- | ------------------------------------------------- | --------------------------------------- | ------------------------------ |
| 01    | `01-dashboard-ar.png`                       | الكل             | دخول      | لوحة التحكم + القائمة الجانبية                    | `/`                                     | —                              |
| 02    | `02-crm-leads-list-ar.png`                  | مبيعات           | قائمة     | العملاء المحتملون                                 | `/crm/leads`                            | —                              |
| 03    | `03-lead-create-dialog-ar.png`              | مبيعات           | إنشاء     | حوار إضافة عميل محتمل (حد أدنى)                   | `/crm/leads`                            | —                              |
| 04    | `04-store-order-detail-ar.png`              | مبيعات/مالية/شحن | نتيجة     | طلب مسدَّد وجاهز للشحن (دفع ≠ شحن)                | `/store-orders/e5cf5e89-…`              | STO-2026-000083 · 900 EGP      |
| 05    | `05-finance-trial-balance-ar.png`           | مالية            | تقرير     | ميزان مراجعة متوازن                               | `/reports/finance`                      | مدين=دائن                      |
| 06    | `06-lead-create-filled-ar.png`              | مبيعات           | إنشاء UI  | حوار معبّأ قبل الحفظ                              | `/crm/leads`                            | DEMO-GUIDE-GAP عميل واجهة Soft |
| 07    | `07-lead-detail-LD081-ar.png`               | مبيعات           | بعد الحفظ | تفاصيل **LD-2026-000081**                         | `/crm/leads/2f3339af-…`                 | PASS إنشاء من الواجهة          |
| 08    | `08-customer-refund-detail-ar.png`          | مالية            | استرداد   | تفاصيل استرداد (جولة سابقة)                       | `/sales/refunds/:id`                    | CRF                            |
| 09    | `09-customer-refund-dialog-ar.png`          | مالية            | حوار      | **«رد مبلغ»** من مرتجع                            | SR-2026-000016                          | refundable 200                 |
| 10    | `10-customer-refund-after-confirm-ar.png`   | مالية            | تأكيد     | بعد تأكيد الرد من الواجهة                         | CRF-003                                 | —                              |
| 11    | `11-customer-refunds-list-ar.png`           | مالية            | قائمة     | قائمة المبالغ المردودة                            | `/sales/payments?view=refunds`          | CRF-001/002/003                |
| 12    | `12-customer-refund-detail-CRF003-ar.png`   | مالية            | تفاصيل    | **CRF-2026-000003** + SR-016 + **JV-2026-000270** | `/sales/refunds/f0411870-…`             | PASS UI                        |
| 12b   | `12-trial-balance-export-print-ar.png`      | مالية            | تقرير     | ميزان + أدوات                                     | `/reports/finance?report=trialBalance`  | —                              |
| 13    | `13-general-ledger-ar.png`                  | مالية            | تقرير     | أستاذ عام                                         | `/reports/finance?report=generalLedger` | —                              |
| 14    | `14-customer-statement-after-refund-ar.png` | مالية            | كشف       | كشف بعد رد (إغلاق 0)                              | partner statement                       | Customer C / GAP               |
| 14b   | `14-trial-balance-export-menu-ar.png`       | مالية            | تصدير     | قائمة Excel / CSV مفتوحة؛ الميزان **متوازن**      | TB                                      | PASS تصدير                     |
| 15    | `15-settings-document-numbering-ar.png`     | إعدادات          | ترقيم     | ترقيم المستندات                                   | `/settings/document-numbering`          | عرض                            |
| 16    | `16-settings-general-ar.png`                | إعدادات          | عام       | إعدادات عامة                                      | `/settings/general`                     | قشرة محتملة                    |
| 17    | `17-trial-balance-print-preview-ar.png`     | مالية            | طباعة     | فشل قبل الإصلاح على f52828c                       | `/print/list?job=…`                     | FAIL تاريخي                    |
| 18    | `18-accounting-settings-ar.png`             | مالية            | إعدادات   | إعدادات الحسابات + حفظ                            | `/finance/accounting-settings`          | PAGE                           |
| 19    | `19-trial-balance-print-after-fix-ar.png`   | مالية            | طباعة     | معاينة ميزان بعد إصلاح print-bridge               | `/print/list?job=…`                     | **PASS** بعد b5f60c2           |
| R1    | `role-qa-shipping-nav-ar.png`               | شحن              | صلاحيات   | القائمة تظهر الشحن                                | `/`                                     | qa-shipping                    |
| R2    | `role-qa-finance-nav-ar.png`                | مالية            | صلاحيات   | القائمة تظهر المالية                              | `/`                                     | qa-finance                     |
| R3    | `role-qa-sales-agent-nav-ar.png`            | مندوب            | صلاحيات   | المبيعات + CRM                                    | `/`                                     | qa-sales-agent                 |

## لقطات مسح الصفحات (قبول)

كل مسار تنقل له PNG تحت `evidence/DEMO-GUIDE-20260924/browser-pages/`.  
تثبت **ظهور الصفحة** وقت المسح؛ المنطق في `data-tour-report.json` وأدلة CRF/GAP في [VERSION-REFUND-RESOLUTION.md](./evidence/VERSION-REFUND-RESOLUTION.md) و [GAP-STATUS.json](./evidence/DEMO-GUIDE-GAP-20260924/GAP-STATUS.json).
