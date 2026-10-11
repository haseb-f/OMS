# R17 stream A — progress log (versioned agreements + COD collection fee)

Branch `feat/r17-agreements` (worktree `OMS-r17-a`, demo DB `oms_r17_a`). Spec: `README.md` §2, §3, "Numeric example".

## Model / migration

`20261011100000_r17_versioned_agreements_cod_fee` (hand-written, idempotent; applied on `oms_r17_a`, `prisma generate`):

- `agent_agreements` + `agent_shipping_agreements`: `active_from` / `active_to` (instant bounds inside the day range),
  `version_number`; commission agreements also get `supersedes_id` (unique, FK) — shipping already had it.
- `agent_shipping_agreements.cod_collection_fee` (nullable = no fee); `agent_shipping_agreement_rates.cod_fee`
  `AgentShippingCodFeeMode` ADDED | INCLUDED; `AgentShippingService` gains `ANY` (default row).
- Backfill: activated agreements get `active_from` = first instant of `effective_from` in the day convention each kind
  already resolves by (commission UTC day, shipping Cairo day) — every existing order date resolves exactly as before
  (`activated_at` deliberately not used: it would orphan back-dated orders). `active_to` stays null. R15 replacement
  chains get version numbers 1, 2, …. Existing COD-service rows → INCLUDED (no fee was ever added), all others ADDED.
  No existing agreement has a fee → no charge changes. Demo DB before: 1 commission + 2 shipping agreements, 9 rates
  (5 COD rows → INCLUDED, 4 prepaid → ADDED). Re-run verified (no-op); `migrate diff` shows no R17 drift.

## Rules implemented

- **Resolution at instant t**: day range AND `activeFrom ≤ t < activeTo` (null bound = day bound alone); shared
  `activeAtInstantWhere` used by `activeAgreementWhere` (commission) and `inForceAtWhere` (shipping).
- **Edit (new version)** — `POST /agents/:id/agreements/:agreementId/versions`, `POST /agents/:agentId/shipping-agreements/:id/versions`,
  permission `agents.agreements.manage` (agents: deny-by-default 403). Under the agent row lock at save instant t:
  only the version in force at t; new version `activeFrom = t`, effective from the day of t to the old end date,
  `versionNumber + 1`, `supersedes` = old; old closes at t (`activeTo = t`, last day = day of t; commission → ENDED).
  Exactly one version in force at t before and after (validated, else rollback). No-change edits → 422
  `AGREEMENT_NO_CHANGES`. Audited on both versions (`VERSION_CLOSED` / `VERSION_CREATED`, bilingual text +
  `metadata.changes` field diff). A planned "replace from" successor is re-linked to the new version.
- **Assessment = submission**: new orders resolve at the submission instant (agent users always; internal orders dated
  today → now; back-dated earlier days → that date, as before). Snapshot gains `assessedAt`, `agreementVersion`,
  `shippingAgreementVersion`. Amendments (payment type / destination / method) re-assess against the snapshot's own
  agreement versions (`AssessmentPin`), never a later version; audited by the existing amendment flow.
- **Tariff**: destination specificity first (city → country → all), then service row over `ANY`; duplicates
  (service × destination) rejected; no match → `AGENT_SHIPPING_TARIFF_MISSING`. COD + ADDED → base + fee; INCLUDED →
  base; prepaid never pays the fee. Per-channel snapshot `{ base, codFee, codFeeMode ADDED|INCLUDED|NONE, amount }`;
  `amount` is what ledger / retention / deductions use (unchanged flows). Portal `/me` and the portal order view
  show base, COD fee and mode (agent tariff only — leak check green).

## UI

- Shipping: one compact form for new / draft / version — default rate first, «إضافة سعر» rows, COD fee field with
  currency, explicit "amount includes the COD fee" checkbox per COD-capable row, live preview
  («مدفوع مسبقًا … — الدفع عند الاستلام: 25 + 10 = 35»); Edit on the version in force; history with version + instants;
  coverage cells show default-row / COD-fee make-up.
- Commission: Edit on the version in force (same form, period hidden), Version column + "in force now", view dialog
  shows the version's audit trail.
- Both editors show the spec notice (ar + en) via one shared `AgreementVersionNotice`.

## Verification

- API: `tsc` ✓, `nest build` ✓, eslint changed files ✓.
- Jest: `src/agents` + `store-orders/amendments` 211/212 (the 1 = R15 W3 worked example, environmental: demo DB has no
  agent posting accounts; with accounts configured temporarily W3 is 7/7, then restored); agent serial suites 33/33
  incl. new `agreement-versions.integration.serial.spec.ts` 4/4; new unit `agent-shipping-tariff-cod.spec.ts` 10/10.
- Mutation proof: (1) INCLUDED ignored → 2 unit tests fail; (2) instant bounds removed → 3/4 integration tests fail.
- Web: `tsc` ✓, eslint ✓, full vitest 174 files / 1236 tests ✓ (new: terms form, editor dialog, commission version
  form, section Edit), `next build` ✓.
- Journey `scripts/acceptance/r17/r17-agreements-journey.mjs` (local API on :4605, demo personas): 12/12 PASS —
  O1 COD 35 (25 + 10), after edit still 35; O2 COD 42; O3 prepaid 30; agent / agent2 → 403; portal tariff ANY 30 /
  COD 42, no leak. Each run adds two shipping versions to the demo agent (AG-0001).

## Open questions

- Commission agreements keep their UTC day convention (shipping uses Cairo days) — unchanged from R15.
- A future-dated (not yet in force) ACTIVE version cannot be edited (409 `*_NOT_IN_FORCE`); change it by deactivating /
  ending and creating a new one.
- New version numbers come from the Numbering Engine (new document number per version, chained by `supersedes`).
