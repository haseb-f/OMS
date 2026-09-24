# ملخص أدلة الجولة — DEMO-GUIDE-20260924

| البند                | القيمة                                                                                          |
| -------------------- | ----------------------------------------------------------------------------------------------- |
| التشغيل              | DEMO-GUIDE-20260924                                                                             |
| الأساس               | https://oms.haseb.org                                                                           |
| API                  | https://oms.haseb.org/api                                                                       |
| المستخدم المنفّذ     | qa-admin@oms.haseb.org                                                                          |
| العملة الوظيفية      | EGP                                                                                             |
| البدء                | 2026-09-24T09:06:18.613Z                                                                        |
| الانتهاء (data-tour) | 2026-09-24T09:09:32.714Z                                                                        |
| browser-tour         | PASS 129 · SKIP 1 · BLOCKED 2                                                                   |
| role-ui-nav          | PASS (shipping / finance / sales-agent)                                                         |
| allowGlobalRuns      | false (ما زال OFF)                                                                              |
| failedChecks         | []                                                                                              |
| blockers (data)      | []                                                                                              |
| إصدار الإنتاج        | **f52828c17696ae9e0e65fe0aa6500b6b5fb58b64** (= HEAD = origin/main؛ نشر Vercel بنفس الـ commit) |

## نتائج التدفقات

| التدفق | الاسم                                                                           | النتيجة          |
| ------ | ------------------------------------------------------------------------------- | ---------------- |
| SETUP  | بيانات أساسية + منتجات/شركاء/افتتاحي                                            | **PASS (3/3)**   |
| F1     | عملاء محتملون → طلبات متجر → Confirm & Post → فاتورة (idempotency، تسوية، تحقق) | **PASS (24/24)** |
| F2     | شحن/تسليم + طلب منفصل مرتجع بعد التسليم                                         | **PASS (18/18)** |
| F3     | B2B: عرض → أمر → فاتورة → قبض جزئي/كامل → كشف                                   | **PASS (13/13)** |
| F4     | مورد: عرض → أمر → فاتورة → دفع جزئي/كامل → مرتجع → كشف                          | **PASS (12/12)** |
| F5     | مخزون: افتتاحي، متوسط متحرك، COGS، تقييم، ربحية                                 | **PASS (11/11)** |
| F6     | فاتورة مكررة، دورة قيد يدوي، حماية قيود نظامية، أصول، مقدمات، تتبع              | **PASS (21/21)** |
| F7     | تسوية تقارير (TB، GL، P&L مقابل BS، تدفق نقدي، كشوف شركاء)                      | **PASS (33/33)** |

## حل تناقض الاسترداد النقدي (Contradiction resolution)

| البند                | التفاصيل                                                                                                                            |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| الادعاء الخاطئ في F2 | «لا API استرداد نقدي للعميل» / `evidence.refund` في data-tour                                                                       |
| السبب الحقيقي        | سكربت قديم `scripts/acceptance/data-tour.mjs` **لم يستدعِ** `/financial-transactions/refunds` — خطأ تحقق، **ليس** انحداراً إنتاجياً |
| الميزة على الإنتاج   | أُضيفت في **acfe68a** وهي على SHA الحالي **f52828c**؛ **db9ae9e** سلف لـ f52828c (ليس فرعاً مختلفاً)                                |
| مسار API             | `/financial-transactions/refunds` (+ `/confirmed`، `/refundable/:id`)                                                               |
| واجهة                | «رد مبلغ» من مرتجع المبيعات؛ قائمة `/sales/payments?view=refunds`؛ تفاصيل `/sales/refunds/:id`                                      |

### أدلة CRF

| المستند         | الحالة    | المبلغ | المرتجع                     | نتيجة بعد الرد                                  |
| --------------- | --------- | ------ | --------------------------- | ----------------------------------------------- |
| CRF-2026-000001 | CONFIRMED | 450    | SR-2026-000014              | موجود على الإنتاج                               |
| CRF-2026-000002 | CONFIRMED | 450    | SR-2026-000015 (Customer C) | `refundableAmount=0`، `customerCreditBalance=0` |
| CRF-2026-000003 | CONFIRMED | 200    | SR-2026-000016 (UI)         | JV-2026-000270 · refundable→0 · كشف closing 0   |
| LD-2026-000081  | NEW       | —      | إنشاء UI                    | DEMO-GUIDE-GAP عميل واجهة Soft                  |

ملف الشرح: [VERSION-REFUND-RESOLUTION.md](./VERSION-REFUND-RESOLUTION.md) · [DEMO-GUIDE-GAP-20260924/GAP-STATUS.json](./DEMO-GUIDE-GAP-20260924/GAP-STATUS.json)

## سلوكيات حرجة ثبتت

1. Confirm & Post يعيد `alreadyPosted` دون مضاعفة القبض/القيد.
2. التحويل بمبلغ 0 مرفوض ويترك العميل المحتمل NEW.
3. المستند المسدَّد يرفض دفعة إضافية (400).
4. القيود النظامية لا تُعدَّل ولا تُعاد لمسودة.
5. المرتجع الزائد مرفوض؛ إعادة تأكيد المرتجع لا تضاعف القيد.
6. تكلفة الشحن تُترحَّل مرة عند التسليم.
7. **استرداد نقدي عميل** على الإنتاج (API + UI CRF-003) — ادعاء «لا API» **مُبطَل**.
8. TB متوازن؛ BS متوازن؛ صافي الدخل يطابق أرباح الميزانية؛ تصدير CSV من الواجهة PASS؛ **طباعة TB FAIL** على f52828c (إصلاح معلّق).
9. إهلاك دفعي / إثبات مقدمات: SKIPPED (`ALLOW_GLOBAL_RUNS` OFF) — لا دفعة عامة بدون موافقة.
10. مستثمرون: investor-tour **82 PASS** (GAP). إنشاء ليد UI: **LD-081 PASS**.

## ملفات الأدلة

- [data-tour-report.json](./DEMO-GUIDE-20260924/data-tour-report.json)
- [demo-record-index.json](./DEMO-GUIDE-20260924/demo-record-index.json)
- [walkthrough.md](./DEMO-GUIDE-20260924/walkthrough.md)
- [browser-tour-report.json](./DEMO-GUIDE-20260924/browser-tour-report.json) — مسح كل مسارات التنقل + سير عمل واجهة
- [browser-pages/](./DEMO-GUIDE-20260924/browser-pages/) — لقطة لكل صفحة
- [role-ui-nav.json](./role-ui-nav.json) — ظهور القائمة حسب الدور
- [role-permission-probe.json](./role-permission-probe.json) — مجسّ API أقدم (مسارات جزئية؛ لا يعتمد وحده)
- [VERSION-REFUND-RESOLUTION.md](./VERSION-REFUND-RESOLUTION.md) — حل تناقض الاسترداد
- [gap-refundable-target.json](./gap-refundable-target.json) — SR-2026-000016 لـ DEMO-GUIDE-GAP

## إصدار المنتج المرجعي للدليل

HEAD = origin/main = **f52828c17696ae9e0e65fe0aa6500b6b5fb58b64**
