# دليل مستخدم OMS (عربي)

دليل عملي للموظفين غير التقنيين. مبني على **أدلة إنتاج موثّقة فقط** — لا يصف ميزات غير مختبرة كأنها تعمل.

| البند           | القيمة                                                                                                          |
| --------------- | --------------------------------------------------------------------------------------------------------------- |
| الإنتاج         | https://oms.haseb.org                                                                                           |
| إصدار الدليل    | عند بدء الإغلاق: **f52828c** (= origin/main). نشر لاحق لإصلاح الطباعة + بذر QA قد يغيّر SHA — راجع git / Vercel |
| جولة التحقق     | **DEMO-GUIDE-20260924** + **DEMO-GUIDE-GAP-20260924**                                                           |
| العملة الوظيفية | **EGP**                                                                                                         |
| واجهة افتراضية  | عربية + RTL                                                                                                     |

## نتيجة جولة البيانات

| التدفق                              | النتيجة    |
| ----------------------------------- | ---------- |
| SETUP                               | PASS 3/3   |
| F1 عملاء متجر / تأكيد ودفع / فاتورة | PASS 24/24 |
| F2 شحن وتسليم ومرتجع                | PASS 18/18 |
| F3 مبيعات B2B                       | PASS 13/13 |
| F4 مشتريات ومورد                    | PASS 12/12 |
| F5 مخزون ومتوسط متحرك               | PASS 11/11 |
| F6 قيود وأصول وحماية القيود         | PASS 21/21 |
| F7 تقارير مالية وتسوية              | PASS 33/33 |

**استرداد نقدي للعميل:** API + واجهة **PASS** (CRF-001/002/003؛ JV-270). ادعاء «لا API» كان خطأ سكربت قديم — [VERSION-REFUND-RESOLUTION.md](./evidence/VERSION-REFUND-RESOLUTION.md).

**طباعة ميزان المراجعة:** **FAIL** على f52828c (مهمة طباعة منتهية فوراً) — إصلاح `print-bridge` (localStorage) في هذا الفرع بانتظار النشر ثم إعادة الاختبار.

مسح الواجهة: **129 PASS** · صلاحيات shipping/finance/sales-agent **PASS**. إنشاء ليد من الواجهة **PASS** (LD-081). مستثمرون API **82 PASS**.

## كيف تستخدم هذا الدليل

1. اختر ملف **دورك** من القائمة أدناه.
2. اتبع الخطوات المرقّمة للمهام الشائعة.
3. راجع [workflows.md](./workflows.md) لفهم المراحل وعلاقة **الدفع ≠ الشحن** ومسار **مرتجع → رد نقدي**.
4. راجع [demo-records.md](./demo-records.md) لفتح سجلات التجربة بروابط وأرقام متوقعة (بما فيها CRF).
5. راجع [coverage.md](./coverage.md) و [issues.md](./issues.md) لمعرفة ما اختُبر وما لم يُختبر.

**كلمة السر غير مذكورة في الدليل.** حسابات QA للتحقق الداخلي فقط.

## حسابات QA (للتحقق)

| الحساب                           | الاستخدام                                           | ملاحظة                                                 |
| -------------------------------- | --------------------------------------------------- | ------------------------------------------------------ |
| `qa-admin@oms.haseb.org`         | مدير نظام (كل الصلاحيات)                            | نشط                                                    |
| `qa-finance@oms.haseb.org`       | مالية / محاسبة (+ `sales.refunds.*` في السكربت)     | صلاحيات الرد تحتاج نشر/بذر                             |
| `qa-sales-manager@oms.haseb.org` | مدير مبيعات (+ إدارة عملاء محتملين وأرشفة واستيراد) | نشط                                                    |
| `qa-sales-agent@oms.haseb.org`   | مندوب مبيعات                                        | نشط                                                    |
| `qa-shipping@oms.haseb.org`      | شحن                                                 | نشط                                                    |
| `qa-purchasing@oms.haseb.org`    | مشتريات                                             | **PENDING** — في `ensure-qa-users.ts`؛ بانتظار نشر/بذر |
| `qa-investors@oms.haseb.org`     | مستثمرون                                            | **PENDING** — كما فوق                                  |
| `qa-hr@oms.haseb.org`            | موارد بشرية                                         | **PENDING** — كما فوق                                  |

مصدر الصلاحيات: `apps/api/prisma/scripts/ensure-qa-users.ts`  
مصدر القائمة الجانبية: `apps/web/src/navigation/navigation.config.ts`

## فهرس الملفات

| الملف                                                                            | المحتوى                                          |
| -------------------------------------------------------------------------------- | ------------------------------------------------ |
| [roles/super-admin.md](./roles/super-admin.md)                                   | مدير النظام                                      |
| [roles/sales-agent.md](./roles/sales-agent.md)                                   | مندوب مبيعات                                     |
| [roles/sales-manager.md](./roles/sales-manager.md)                               | مدير مبيعات                                      |
| [roles/finance.md](./roles/finance.md)                                           | المالية (بما فيها رد المبلغ)                     |
| [roles/purchasing.md](./roles/purchasing.md)                                     | المشتريات                                        |
| [roles/shipping.md](./roles/shipping.md)                                         | الشحن                                            |
| [roles/investors.md](./roles/investors.md)                                       | المستثمرون                                       |
| [roles/hr.md](./roles/hr.md)                                                     | الموارد البشرية                                  |
| [workflows.md](./workflows.md)                                                   | المسارات والمراحل والمصطلحات                     |
| [reports.md](./reports.md)                                                       | التقارير (العامل منها والقشرة)                   |
| [coverage.md](./coverage.md)                                                     | تغطية الوحدات PASS / FAIL / BLOCKED / NOT TESTED |
| [issues.md](./issues.md)                                                         | ملاحظات وفجوات موثّقة (+ حل تناقض الاسترداد)     |
| [demo-records.md](./demo-records.md)                                             | سجلات DEMO بروابط ومبالغ                         |
| [screenshot-index.md](./screenshot-index.md)                                     | فهرس لقطات الشاشة                                |
| [evidence/SUMMARY.md](./evidence/SUMMARY.md)                                     | ملخص جولة التحقق                                 |
| [evidence/VERSION-REFUND-RESOLUTION.md](./evidence/VERSION-REFUND-RESOLUTION.md) | حل تناقض الاسترداد (عربي + إنجليزي)              |

## قواعد ذهبية موثّقة

1. **حالة الدفع ≠ حالة الشحن** — الطلب قد يكون مدفوعاً بالكامل وجاهزاً للشحن دون أن يُشحن.
2. **تأكيد وترحيل (Confirm & Post)** آمن للتكرار (`alreadyPosted`) — لا يُنشئ قيداً مزدوجاً.
3. تحويل عميل محتمل بمبلغ متفق عليه **صفر** مرفوض.
4. طلب مسدَّد بالكامل يرفض دفعة إضافية.
5. القيود **النظامية** لا تُعدَّل ولا تُعاد لمسودة — صحّح مستند المصدر.
6. المرتجع الزائد عن الكمية القابلة للإرجاع مرفوض.
7. بعد المرتجع يمكن **رد مبلغ نقدي** (CRF) لإغلاق الرصيد الدائن — موجود على الإنتاج.
8. واجهة عربية افتراضية واتجاه RTL.

## أدلة الجولة

- `evidence/DEMO-GUIDE-20260924/data-tour-report.json`
- `evidence/DEMO-GUIDE-20260924/demo-record-index.json`
- `evidence/DEMO-GUIDE-20260924/walkthrough.md`
- `evidence/VERSION-REFUND-RESOLUTION.md`
- `evidence/gap-refundable-target.json`
- مسح الصفحات: `evidence/browser-tour-console.log` (تحميل HTTP 200، ليس إثبات منطق أعمال كامل)
