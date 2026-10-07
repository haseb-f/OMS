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
  - copy-from now need `users.manage_permissions`, keep DENY rows, escalation-checked and audited.
- Shipping: `shipping.assign_carrier` on store-order `shipping-company` / `tracking-number`, legacy
  `sales-orders/:id/shipping-company|tracking-number` (PermissionsGuard before the scope guard), and per-row
  rejection in the SHIPPING_UPDATES import handler (manual + Sheets sync) when a row changes carrier/tracking.
- Tests: `effective-permissions.spec` (9), resolver spec (+4), `permission-administration.integration.spec`
  (11, HTTP), `shipping-carrier-authorization.integration.spec` (13, HTTP + import rows + bulk DTOs).
- Mutation proof: (1) store-order routes back to `shipping.edit`, legacy decorators removed, import row check
  disabled → 8/13 carrier tests fail; (2) DENY not removed from the base → 2 resolver/formula tests fail.
  Both restored with `git checkout`.
