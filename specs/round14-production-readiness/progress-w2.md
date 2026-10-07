# W2 progress — job-title permission templates + shipping carrier authorization

Branch `feat/r14-permissions`, worktree `D:/Systems/OMS-r14-w2`, database `oms_r14_w2`.

## Log

- 2026-10-07 — Schema: `JobTitlePermission`, `UserPermission.effect` (GRANT|DENY, default GRANT),
  `User.permissionsReviewRequired`. Migrations `20261008110000_r14_job_title_permissions` (schema +
  `job-titles.manage_permissions` / `users.manage_permissions` → INTERNAL `settings.manage` holders) and
  `20261008110100_r14_shipping_assign_carrier` (`shipping.assign_carrier` → INTERNAL `shipping.edit` /
  `shipping.manage` holders). Applied with `prisma migrate deploy` on `oms_r14_w2`.
- Migration parity (`scripts/r14/w2-permission-parity.ts`, before = inline copy of the pre-R14 resolver
  formula, after = `computeEffectivePermissions`): 1133 users; 1125 identical; 8 changed only by the new
  grants (`shipping.assign_carrier` 8, `job-titles.manage_permissions` 2, `users.manage_permissions` 2);
  0 lost permissions; 0 failures.
- API: resolver uses `computeEffectivePermissions` (template ∪ GRANT − DENY, DENY also beats implied keys);
  `getUsersWithPermission` (and lead eligibility, which now uses it) counts template holders and excludes
  DENY. `PermissionAdministrationService`: user panel GET/PUT `/users/:id/permission-overrides`
  (tri-state, clears review flag), job-title `GET/PUT /job-titles/:id/permissions` + `POST …/preview`,
  anti-escalation 403 `PERMISSION_ESCALATION` (gained-effective ⊄ actor's set, self-edit), audit
  `USER_PERMISSIONS` / `JOB_TITLE_PERMISSIONS` / `USER_JOB_TITLE`. Legacy `POST /users/:id/permissions`
  and copy-from now need `users.manage_permissions`, keep DENY rows, escalation-checked and audited.
- Shipping: `shipping.assign_carrier` on store-order `shipping-company` / `tracking-number`, legacy
  `sales-orders/:id/shipping-company|tracking-number` (PermissionsGuard before the scope guard), and per-row
  rejection in the SHIPPING_UPDATES import handler (manual + Sheets sync) when a row changes carrier/tracking.
- Tests: `effective-permissions.spec` (9), resolver spec (+4), `permission-administration.integration.spec`
  (11, HTTP), `shipping-carrier-authorization.integration.spec` (13, HTTP + import rows + bulk DTOs).
- Mutation proof: (1) store-order routes back to `shipping.edit`, legacy decorators removed, import row check
  disabled → 8/13 carrier tests fail; (2) DENY not removed from the base → 2 resolver/formula tests fail.
  Both restored with `git checkout`.
- Web: shared `PermissionMatrix` gains an override mode (source chips موروثة من المسمى الوظيفي / منحة فردية /
  منع فردي + Inherit/Grant/Deny `ToggleGroup`); `UserPermissionPanel` mounted in the user editor (agent users keep
  the legacy matrix; read-only for self-edit or without `users.manage_permissions`); job-title row action
  "الصلاحيات الافتراضية" opens `JobTitlePermissionsModal` (matrix → Review impact → Save and apply, seed from a
  user); review badge in the users list status cell; carrier select / tracking input only with
  `shipping.assign_carrier` (manage dialog read-only otherwise, quick-edit cells plain text); store-order
  `canManageShipping` no longer includes `store-orders.edit`. i18n namespace `permissionTemplates` (en + ar).
- Quality (final): api `tsc` + `nest build` OK, eslint clean on every changed API file; jest api/agents,
  import-center, permissions, users, job-titles, store-orders/shipments, sales-orders, leads → 52 suites /
  920 tests pass; serial suites 14 / 147 pass. Web `tsc`, eslint (changed files), `next build` OK; vitest
  config/shared/i18n/navigation 70 files / 560 tests + new `shipment-carrier-gate.spec` (5) pass.
- Parity re-run after the full change set: same 1133 users identical except the 8 new-grant holders, 0 failures
  (27 users created since by other test suites are counted separately, not compared).

## Deviations / open

- Job-title "tab": the generic Master Data editor has no tabs, so "الصلاحيات الافتراضية" is a row action
  opening its own modal (same matrix component, two-click impact confirmation).
- Import / sync rows without an actor (internal calls, tests) are trusted; every HTTP job passes the actor.
- Cross-instance cache staleness after a template change is bounded by the resolver TTL (60 s).
