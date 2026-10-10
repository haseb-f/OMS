# R16 S3 — compact agent order entry: progress

Branch `feat/r16-agent-order-entry` (worktree `OMS-r16-w3`). API untouched.

## Before

- Agent admin and agent sales "طلب جديد" navigated to `/agent/orders/new`, which rendered `OrderEntryFlow`
  with `container="page"`: a full-width card inside the page workspace.
- Lead conversion (`/agent/orders/new?leadId=`) — same full page.
- Company staff entering an agent order (`AgentOrderEntryButton`) and the company reference
  (`StoreOrderCreateDialog`) already used the dialog, at the generic `lg` width (`sm:max-w-3xl`, 768 px).

## Done

- **One shell:** `OrderEntryFlow` has no page container any more — it always renders `EnterpriseModal`
  (centered on desktop / tablet, near-full-width bottom sheet on phones, `100dvh` bounded, actions lifted
  above the keyboard via `--keyboard-inset`, header / step navigation / footer fixed while the body
  scrolls, unsaved-changes guard on close). Width = new token `--order-entry-width: 48rem`
  (`app/globals.css`, the reference's 768 px) via `ORDER_ENTRY_DIALOG_CLASS`, used by the company dialog
  and every agent entry point.
- **Agent entry points** (`components/order-entry/agent/agent-order-entry-dialog.tsx`):
  `AgentPortalOrderEntryDialog` (loads the portal profile + lead inside the same shell) and the staff
  `AgentOrderEntryButton` share one `AgentOrderEntryFlowDialog`.
  - `/agent/orders` "New order" → opens the dialog in place (agent admin and agent sales).
  - `/agent/leads` row "Convert" and `/agent/leads/[id]` "Convert" → open the dialog in place.
  - `/agent/orders/new[?leadId=&method=]` stays as a deep link (Home tile, dashboard, toast links): it
    opens the same dialog; close = back (or `/agent`), created = replace with the order detail.
- **Country / phone:** unchanged shared rules (`useEntryCountry`, R11/R12): the customer's country proposes
  the calling code; the code is editable in the phone field; a manual code, or a number already typed,
  is never reset by a later country change; a lead's saved phone/country are shown as saved; delivery
  country stays separate.
- Preserved: agent catalog / availability, pricing + shipping-agreement quote, duplicate acknowledgement,
  permissions, one idempotency key per form + single in-flight submit.

## Tests

- `components/order-entry/use-entry-country.spec.tsx` — 15 (proposal / override / typed number / saved
  phone, each under the agent and the company wiring; currency only for company).
- `components/order-entry/agent/agent-order-entry-dialog.spec.tsx` — 5 (token = 48rem; portal new order,
  lead conversion, `/agent/orders/new` route and staff entry all render the compact dialog shell, no
  page card).
- Gates: web `tsc` clean, eslint clean on changed files, full web vitest 168 files / 1196 tests passed,
  `next build` passed (compiled CSS has `sm:max-w-(--order-entry-width)`).

## Open

- Visual pass (desktop 1440 / tablet 820 / phone 390 / landscape) and before/after screenshots not taken
  here (no browser pass in this workstream) — owner review on the local build.
- `interactive-widget=resizes-content` viewport meta comes from S1 (`feat/r16-login`).
