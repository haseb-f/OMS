# تغطية الوحدات — DEMO-GUIDE-20260924 + DEMO-GUIDE-GAP-20260924

الحالات: **PASS** · **FAIL** · **BLOCKED** · **NOT TESTED** · **SHELL** · **PAGE LOAD** · **PENDING**.

أدلة: `evidence/DEMO-GUIDE-20260924/*` · `evidence/DEMO-GUIDE-GAP-20260924/*` · `evidence/VERSION-REFUND-RESOLUTION.md` · `evidence/GAP-STATUS.json` (تحت GAP).

إصدار الإنتاج عند بدء الإغلاق: **f52828c**. إصلاح الطباعة + بذر QA يغيّران SHA بعد النشر.

## ملخص التدفقات

| التدفق                                     | الحالة                           | الفحوصات                                                    |
| ------------------------------------------ | -------------------------------- | ----------------------------------------------------------- |
| SETUP … F7 (data-tour)                     | PASS                             | انظر SUMMARY                                                |
| Browser sweep (ar/desktop/light)           | PASS                             | 129 PASS · 1 SKIP · 2 BLOCKED (أصلية؛ رُدّت لاحقاً عبر GAP) |
| صلاحيات قائمة shipping/finance/sales-agent | PASS                             | `role-ui-nav.json`                                          |
| استرداد نقدي API + CRF-001/002             | **PASS**                         | VERSION-REFUND                                              |
| استرداد نقدي UI (مرتجع→رد→JE→كشف)          | **PASS**                         | CRF-2026-000003 · JV-2026-000270 · closing 0                |
| إنشاء عميل محتمل من الواجهة                | **PASS**                         | LD-2026-000081                                              |
| مستثمرون (مساهمة→فرصة→أرباح)               | **PASS (API)**                   | investor-tour 82/82                                         |
| مستثمرون / مشتريات / HR بشخصيات QA         | **BLOCKED**                      | بانتظار نشر بذر المستخدمين                                  |
| تقارير: فلاتر + تصدير CSV + توازن          | **PASS**                         | TB متصفح                                                    |
| تقارير: طباعة قائمة                        | **PASS** بعد b5f60c2             | لقطة 19 — كان FAIL على f52828c                              |
| إعدادات حسابات (عرض)                       | PAGE LOAD                        | لقطة 18                                                     |
| إعدادات ترقيم (عرض)                        | PAGE LOAD                        | يحتاج `numbering.manage` للتعديل                            |
| إعدادات: تغيير قابل للعكس كامل             | **NOT TESTED**                   | تجنّب تغيير حسابات افتراضية حية دون موافقة                  |
| إهلاك دفعي / إثبات مقدمات عالمي            | **NOT TESTED**                   | `ALLOW_GLOBAL_RUNS` OFF — لا تشغيل دفعة عامة بدون موافقة    |
| مشتريات F4 (API)                           | PASS                             | 12/12                                                       |
| HR منطق عميق                               | **NOT TESTED** / صفحات PAGE LOAD | —                                                           |

### استرداد نقدي عميل

| العنصر                          | الحكم                   |
| ------------------------------- | ----------------------- |
| API refunds                     | PASS                    |
| CRF-001 / 002 / **003**         | PASS                    |
| حوار «رد مبلغ» + قائمة + تفاصيل | **PASS** (متصفح)        |
| قيد يومية مرتبط                 | PASS — JV-2026-000270   |
| كشف بعد الرد                    | PASS — closingBalance 0 |

### حسابات QA

| الحساب                                  | الحالة                              |
| --------------------------------------- | ----------------------------------- |
| qa-admin / finance / sales-* / shipping | موجودة على الإنتاج                  |
| qa-purchasing / qa-investors / qa-hr    | **PASS** تسجيل دخول بعد بذر b5f60c2 |
| qa-finance + sales.refunds.*            | **PASS** مُبذورة (sales.refunds.*)  |

## المخزون حسب الوحدة (مختصر محدّث)

| الوحدة                    | الحكم                                    |
| ------------------------- | ---------------------------------------- |
| CRM إنشاء UI              | **PASS** — LD-081                        |
| استرداد نقدي              | **PASS** API+UI                          |
| مستثمرون منطق             | **PASS** API (GAP) · متصفح شخصية BLOCKED |
| مشتريات منطق              | PASS F4 · متصفح شخصية BLOCKED            |
| تقارير مالية فلاتر/تصدير  | PASS                                     |
| تقارير طباعة              | FAIL→fix pending deploy                  |
| HR                        | PAGE LOAD / NOT TESTED منطق عميق         |
| إهلاك/مقدمات دفعية عالمية | NOT TESTED (OFF)                         |
