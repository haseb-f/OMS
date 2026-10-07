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
