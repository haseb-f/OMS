# W3 — Agent shipping agreements — progress log

Spec: [spec-w3-shipping-agreements.md](spec-w3-shipping-agreements.md) · Decision D15-13 · Test DB `oms_r15_w3`.

## Status

| Step | What                                                              | State |
| ---- | ----------------------------------------------------------------- | ----- |
| 1    | API compiles again (AgentShippingRate removed from the 6 files)   | done  |
| 2    | Pure resolver (service × destination, city > country > all)       | done  |
| 3    | Shipping agreements service + controller                          | done  |
| 4    | Order submission / confirmation / amendments on the new agreement | done  |
| 5    | Commission agreement: rates endpoints removed, activation warning | done  |
| 6    | Portal `/me` shipping agreement block                             | done  |
| 7    | Web: Agent → Settings → Shipping agreement; tariff UI removed     | done  |
| 8    | Tests + worked example (3.11)                                     | done  |

## Log

- 2026-10-07 — started; read README, decisions D15-13, survey S3, spec, migration 20261009100200.
- API compiles again for every agents / store-orders file (tsc, only other streams' WIP errors remain). Spec
  fixtures of the suites that used the removed rates API migrated to the new shipping agreement
  (`shipping-agreements/shipping-agreement.fixture.ts`): agent-commission serial, agent-orders, agent-portal,
  agent-shipping-pricing, store-order-amendments, shipping-handoff; `prisma/scripts/ensure-agents-demo.ts`.
- Pure resolver rewritten (`pricing/agent-shipping-tariff.ts`): `serviceOf`, `resolveTariff(rows, dest, service)`
  city > country > all, `resolveSubmissionTariff` (unchanged freeze semantics), `shippingAgreementCoverage`,
  `destinationKeyOf`. Spec `agent-shipping-tariff.spec.ts` 15/15.
- 2026-10-07 (session 2, recovery) — the first session had already written steps 3–6 but not logged them:
  `shipping-agreements/` service + controller + module + DTOs + `shipping-agreement-resolution.ts` (in-force
  query, overlap where, bilingual missing messages, `/me` terms); `agent-orders.service.ts` prices from the
  agreement in force on the order date (snapshot carries `shippingAgreementId/Number`, `service`, `byChannel[].service`);
  `agent-shipping-pricing.service.ts` confirms from the frozen `byChannel` with the agreement-named message;
  commission agreement rates endpoints / DTO removed + `SHIPPING_AGREEMENT_NOT_IN_FORCE` activation warning;
  portal `/me` → `shippingAgreement`. API tsc: no error in W3 files. `agent-shipping-agreements.integration.spec.ts`
  7/7 after giving its payment method an ASSET clearing account (W5b's posting rule, not a W3 change).
- Web (session 2): Agent detail → new «الإعدادات / Settings» tab → `ShippingAgreementSection`
  (`components/agents/shipping-agreements/`): the agreement shown (in force today by default) with number, status,
  phase (in force / starts later / period ended), period, currency, who / when, replaces / replaced by, the
  service × destination matrix (`ShippingCoverageTable`: own / inherited / missing per cell), actions New /
  Duplicate / Edit draft / Activate (coverage + overlap + «replace from» checkbox) / Deactivate (reason) / Discard
  draft, history table and the audit trail. Editor dialog: period + notes (Create draft → number generated), then
  the charges (service, country or all destinations, city, amount ≥ 0). Commission agreement: Rates action and
  `shipping-rates-dialog.tsx` removed, `config/agents/shipping-tariffs*` removed (the API now returns the matrix),
  activation shows the `SHIPPING_AGREEMENT_NOT_IN_FORCE` warning toast. `agents-service.ts` /
  `agent-portal-service.ts`: tariff types removed, `AgentShippingService`, `PortalMe.shippingAgreement`.
- Verification: API tsc / web tsc — no error in W3 files; eslint clean on every W3 file; prettier applied to W3-owned
  files. Jest (oms_r15_w3): shipping-agreements 7/7, pricing suites, agent-orders, agent-commission serial pass.
  Vitest: `components/agents/shipping-agreements` 4 files / 10 tests.
- Mutation proof (each restored afterwards): (1) pricing at `new Date()` instead of the order date → "submission
  uses the agreement in force on the order date" fails (expected 50, received 80); (2) `canReplaceFrom` without
  "started earlier" → the overlap test fails (expected 409, received 201); (3) web `canConfirmActivation` always
  true → view spec + section spec fail (2 tests).

## Worked example 3.11 (integration test «worked example 3.11», passing)

الوكيل AG — اتفاقية شحن ASA (مفعّلة من 2020-01-01، مفتوحة):

| الخدمة                                            | الوجهة        | الرسم |
| ------------------------------------------------- | ------------- | ----- |
| شركة شحن · عند الاستلام (COD_CARRIER)             | مصر           | 60    |
| مندوب داخلي · عند الاستلام (COD_INTERNAL_COURIER) | مصر / القاهرة | 40    |
| شركة شحن · مدفوع مسبقًا (PREPAID_CARRIER)         | كل الوجهات    | 70    |

اتفاقية العمولة: 35 % على المنتجات، سياسة الشحن «رسم شحن محدد مسبقًا».

1. **الإرسال:** طلب إلى القاهرة، الدفع عند الاستلام، منتج 1 000 + شحن العميل. طريقة التوصيل غير معروفة بعد:
   شركة الشحن 60 / المندوب 40 → الحالة `PENDING_METHOD`، الرسم المبدئي 60 (تقدير شركة الشحن)، الإجمالي 1 060.
   اللقطة: `byChannel = { CARRIER: 60 COD_CARRIER, INTERNAL_COURIER: 40 COD_INTERNAL_COURIER }` + رقم الاتفاقية.
2. **قسم الشحن يختار شركة الشحن:** الخدمة = COD_CARRIER → `CONFIRMED` 60 (من اللقطة المجمّدة، المصدر TARIFF).
3. **التسليم + تحصيل 1 060:** الاستحقاق — عمولة 350 (35 % × 1 000)، شحن عميل محتجز 60 (الرسم المتفق 60، الفرق 0).
4. **كشف الحساب:** المبيعات 1 000 + رسوم العميل 60 = 1 060؛ العمولة 350؛ الشحن المحتجز 60؛
   **صافي الوكيل 650** (1 060 − 350 − 60)، ورصيد الوكيل 650.
5. **إصدار جديد:** نسخ ASA → تعديل COD_CARRIER مصر إلى 75 → تفعيل مع «الاستبدال من اليوم» (تُغلق ASA أمس).
   الطلب السابق لم يتغير (60، رقم ASA). طلب جديد إلى القاهرة يُسعَّر 75 من الإصدار الجديد.
6. **إيقاف الإصدار الجديد (بسبب):** الطلب التالي يُرفض `AGENT_SHIPPING_AGREEMENT_MISSING` («لا توجد اتفاقية شحن
   سارية … تفعّلها الشركة من الوكيل ← الإعدادات ← اتفاقية الشحن»)؛ الطلب المُسعَّر بـ 75 يحتفظ برسمه ويُؤكَّد عند
   اختيار شركة الشحن (75، TARIFF). بوابة الوكيل `/me` تعرض الاتفاقية السارية اليوم (رسوم فقط، `leakedKeys` نظيف).

## Integration requests (lead)

1. **Import path (W5a, `import-center/handlers/shipping-updates-import.handler.ts`)** — inside the row transaction,
   right after the shipment's company is set and before `onShipmentProgress(...)`:

   ```ts
   if (shippingCompanyId) {
     updated = await tx.shipment.update({ where: { id: updated.id }, data: { shippingCompanyId } });
     // R15 D15-13 — a carrier set by import confirms the agent's agreed shipping
     // charge exactly like the manual assignment (no-op for company orders;
     // idempotent; AGENT_SHIPPING_TARIFF_MISSING fails the row).
     await this.agentFulfillment.onShippingCompanyAssigned(tx, order.id, userId);
   }
   ```

   `AgentFulfillmentService.onShippingCompanyAssigned` is the manual path's call: it confirms the fee from the frozen
   `byChannel`, then earns an order held while the fee was provisional.

2. **Amendments message (`store-order-amendments.service.ts` ~1140, W5a file):** the impact text still says "add it
   to the agreement". Suggested: build it with `missingTariffMessage(after.shippingAgreementNumber,
[serviceOf(channel, quote.paymentType)], await describeDestination(tx, destination))` from
   `agents/shipping-agreements/shipping-agreement-resolution.ts`; web text
   `orderAmendments.impact.AGENT_SHIPPING_TARIFF_MISSING` → "…add it to the agent's shipping agreement in a new
   version (Duplicate → edit → Activate with «replace from») or ask Shipping to choose another method first."
3. **i18n cleanup (`agents.*`, `agent-pricing.*`, `order-amendments.*` — not W3 files):** now unused:
   `agents.agreements.actions.rates`, `agents.agreements.toasts.rateSaved|rateRemoved`, `agents.agreements.rates.*`,
   `agentPricing.tariffs.*` except `channels` / `paymentTypes` (still used by `shipping-pricing-panel.tsx`),
   `orderAmendments.pricingIssue.SHIPPING_RATE_REQUIRED|AGENT_SHIPPING_CHARGE_NOT_CONFIGURED` (codes no longer
   emitted; the new codes fall back to the server's bilingual text). Reword
   `agents.agreements.shippingPolicy.PREDETERMINED_CHARGE` "(from the shipping rates)" → "(from the shipping
   agreement)" and its hint → "…the charge of the agent's shipping agreement (Settings) for the order's service and
   destination…".
4. **Quote `rateScope` (W1 order entry):** `/agent-portal/orders/quote` and `POST /agent-orders/quote` now return
   `shipping.rateScope` `CITY | COUNTRY | ALL` (ALL = an all-destinations row). Extend `OrderQuote.shipping.rateScope`
   (`services/agent-portal-service.ts`) and `components/agent-portal/order-breakdown.tsx` (a label for ALL, e.g.
   `agentShippingAgreements.allDestinations`); today ALL renders the "country rate" label.
5. `agents/common/agent-terms.ts` (not in the W3 row) carries the snapshot fields `shippingAgreementId / Number`,
   `service` and `byChannel[].service` — required by D15-13; please keep on merge.
