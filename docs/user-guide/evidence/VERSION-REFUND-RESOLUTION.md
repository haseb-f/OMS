# حل تناقض الاسترداد النقدي / Customer Refund Contradiction Resolution

**Production SHA** = HEAD = `origin/main` = **f52828c17696ae9e0e65fe0aa6500b6b5fb58b64** at audit start.  
Print-bridge fix + QA personas may advance Production SHA after deploy of this guide commit.

---

## العربية (مختصر)

ادعاء جولة DEMO-GUIDE-20260924 بأن «**لا يوجد API استرداد نقدي للعميل**» كان **خاطئاً**.

- **السبب:** سكربت التحقق القديم `scripts/acceptance/data-tour.mjs` لم يستدعِ مسار `/financial-transactions/refunds` — فجوة في أداة القبول، وليست انحداراً في الإنتاج.
- **الحقيقة:** استرداد العميل أُضيف في commit **acfe68a** وهو موجود على الإنتاج (f52828c). Commit **db9ae9e** سلف لـ f52828c وليس فرعاً مختلفاً.
- **المسار:** API `/financial-transactions/refunds` (+ `/confirmed`، `/refundable/:id`) · واجهة: إجراء **«رد مبلغ»** على مرتجع المبيعات · قائمة `/sales/payments?view=refunds` · تفاصيل `/sales/refunds/:id`.
- **أدلة سجلات:**
  - CRF-2026-000001 (CONFIRMED، 450، ضد SR-2026-000014)
  - CRF-2026-000002 (CONFIRMED، 450، ضد SR-2026-000015) → `refundableAmount=0` و`customerCreditBalance=0`
  - **CRF-2026-000003** (CONFIRMED، 200، ضد SR-2026-000016) عبر واجهة «رد مبلغ» + قيد **JV-2026-000270** مُرحَّل؛ بعد الرد `refundableAmount=0` وكشف العميل `closingBalance=0`
- **ما بقي معلّقاً:** بذر شخصيات QA (`qa-purchasing` / `qa-investors` / `qa-hr`) بعد النشر · إصلاح طباعة التقارير (localStorage) بعد النشر · `ALLOW_GLOBAL_RUNS` ما زال OFF.

---

## English (short)

The DEMO-GUIDE-20260924 claim that **“no customer-refund API exists”** was **wrong**.

- **Cause:** An outdated acceptance script (`scripts/acceptance/data-tour.mjs`) never called `/financial-transactions/refunds`. That was a verification gap, **not** a production regression.
- **Fact:** Customer refunds shipped in **acfe68a** and **are on Production** at SHA **f52828c**. **db9ae9e** is an **ancestor** of f52828c, not a different branch.
- **Surface:** API `/financial-transactions/refunds` (+ `/confirmed`, `/refundable/:id`) · UI action **«رد مبلغ»** on Sales Return · list `/sales/payments?view=refunds` · detail `/sales/refunds/:id`.
- **Record evidence:** CRF-001 / CRF-002 as above · **CRF-2026-000003** UI browser PASS (200 vs SR-016) with **JV-2026-000270** · refundable→0 · AR statement closing 0.
- **Still open:** deploy/seed new QA personas · retest report print after print-bridge fix · `ALLOW_GLOBAL_RUNS` still OFF.

---

## Related guide pages

- [issues.md](../issues.md) · [coverage.md](../coverage.md) · [demo-records.md](../demo-records.md) · [workflows.md](../workflows.md) · [SUMMARY.md](./SUMMARY.md) · [DEMO-GUIDE-GAP-20260924/GAP-STATUS.json](./DEMO-GUIDE-GAP-20260924/GAP-STATUS.json)
