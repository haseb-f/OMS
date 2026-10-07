# W2 — Job-title permission templates and shipping authorization

## A. Job-title defaults with individual overrides

### Current model (2026-10-07)

No roles. `UserPermission` (userId, permissionId) is the only grant table; `JobTitle` is a label;
`EmployeesService.createAccount` copies an HR preset (`hr-role-presets.ts`) into `UserPermission` once.
`PermissionsResolverService` caches per process for 60 s. Permission changes are not audited.

### Target model — one engine, extended (no second authorization engine)

- `JobTitlePermission (jobTitleId, permissionId)` — the title's template.
- `UserPermission` gains `effect` (`GRANT` default | `DENY`). Existing rows are individual GRANTs.
- **Effective(user) = (template(user.jobTitle) ∪ GRANTs) − DENYs**, then the existing resolver steps
  (agent filter, implied permissions, settings-domain grants). Super admin bypass unchanged.
- Templates apply to INTERNAL users only. Agent users keep `AGENT_ROLE_PRESETS` (no job titles).
- A DENY beats an inherited grant AND an implied permission derived from it.

### Behaviour

- Template change → applies **live** to every current holder of the title on save. Before saving, the
  editor shows an impact preview: per affected user, permissions gained / lost, and users whose
  individual overrides make a change ineffective. Save is a second click.
- Title change on a user → the inherited set switches; individual GRANT/DENY rows are kept and the
  user is flagged `permissionsReviewRequired = true` (cleared when an admin saves the user's permission
  panel). The users list shows a "review" badge.
- Migration: all templates start empty and all existing `UserPermission` rows become GRANTs → every
  user's effective set is byte-identical before/after (asserted by a migration test on a clone).
- "Convert to template" helper (optional per title): an admin may seed a template from a chosen
  user's current grants; individual grants that equal the template stay as explicit rows (shown as
  "also inherited") — never silently dropped.

### Authorization of administration

- New permissions: `job-titles.manage_permissions` (edit templates), `users.manage_permissions`
  (grant/deny individual overrides), both granted by migration to current holders of `settings.manage`
  (no broadening: they could already do this).
- Anti-escalation: a non–super-admin cannot add to a template or grant to a user any permission they do
  not hold themselves, and cannot edit their own overrides. Server-enforced (403 `PERMISSION_ESCALATION`).
- Audit: `MasterDataActivityLog` entries for `JOB_TITLE_PERMISSIONS` (added/removed lists), `USER_PERMISSIONS`
  (grant/deny/remove), `USER_JOB_TITLE` (from → to). Also fixes the missing audit on `setPermissions`.
- Cache: `invalidate(userId)` on user changes; template change invalidates every holder; job-title change
  invalidates the user. Cross-instance staleness ≤ 60 s (TTL) — documented.

### UI

User permission panel: each permission row shows a source chip — "موروثة من المسمى الوظيفي" (inherited),
"منحة فردية" (individual grant), "منع فردي" (individual deny) — and tri-state controls (inherit / grant /
deny). Job title editor gets a "الصلاحيات الافتراضية" tab using the same permission matrix component.

## B. Shipping-company and shipment-number protection

### Defect

- Web: store-order detail `canManageShipping = canEdit || hasPermission("shipping.edit")`
  (`store-orders/[id]/page.tsx:183`) → sales staff with `store-orders.edit` get the carrier dialog.
- API: legacy `POST /sales-orders/:id/shipping-company` and `/tracking-number` have no permission
  check; Import Center `SHIPPING_UPDATES` jobs change carrier/tracking with only `import-center.import`.
- `GET /shipping-companies` is `@SkipPermissionCheck` (read-only list; acceptable, kept for pickers).

### Fix

- New permission `shipping.assign_carrier` — assign/change shipping company and tracking/shipment number.
  Migration grants it to every user holding `shipping.edit` or `shipping.manage` (same people as today on
  the store-order endpoint → no broadening, sales staff without shipping rights stay excluded).
- `shipping.view` remains the right to see shipment information (carrier, tracking, status).
- Server: carrier/tracking endpoints (store-order shipments, legacy sales-orders, agent paths if any) require
  `shipping.assign_carrier`; Import Center SHIPPING_UPDATES jobs (manual + sync) require it when a row
  sets carrier or tracking (rows rejected with a per-row reason otherwise); bulk endpoints never touch
  carrier/tracking (verified by test).
- Web: carrier selector + tracking input render only with `shipping.assign_carrier`; status/label actions
  keep `shipping.edit`; users with only `shipping.view` see read-only values.
- Tests: crafted requests by a sales user (store-orders.edit, no shipping rights) to every path → 403 and
  data unchanged; shipping user succeeds; agent boundary unchanged.
