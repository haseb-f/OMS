# S3 — Compact agent order entry

Entry points to fix: agent portal new order (agent admin and agent sales employee) and company staff
entering an agent order. Reference: the company salesperson's `StoreOrderCreateDialog` (stepped, compact,
centered). R15 D15-19 made a shared `OrderEntryFlow` with company/agent adapters — the agent entry points
must render it in the SAME compact dialog shell (shared max width token, centered card on desktop/tablet,
internal scroll with sticky header/step nav/actions, full width with 16px margins on phones, keyboard-safe:
the action bar stays reachable — `interactive-widget=resizes-content` from S1 + `dvh` sizing).

Country / phone: choosing the customer's country proposes its calling code (existing `Country` data and R12
defaulting); the calling code stays independently editable; a manual choice is never overwritten; an existing
customer's saved phone/country are kept; no second country field (delivery country stays separate per R11).
Preserved: availability, agent ownership/catalog, pricing + shipping-agreement quote, customer matching and
duplicate acknowledgement, permissions, duplicate-submit protection (idempotency key).

Verification: agent admin, agent sales, company staff → open new order (desktop 1440, tablet 820, phone 390,
landscape), screenshots before/after; country change → code proposed; manual code kept after another country
change; existing customer values kept; submit an order end to end on the local build.
