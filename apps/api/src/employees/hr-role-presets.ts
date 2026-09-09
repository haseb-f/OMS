/**
 * HR Milestone 1, Part D/AG — the wizard's "Role" selector. This codebase
 * has no `Role` entity (confirmed by audit: permissions are granted
 * directly to a User via `UserPermission`, resolved from
 * `PERMISSION_CATALOG` — see `permissions-resolver.service.ts`). Rather
 * than invent a parallel Role table (forbidden — "never duplicate
 * architecture"), a "Role" chosen in the Employee wizard is a UI-level
 * convenience that expands to a concrete permission-name bundle, applied
 * through the exact same `UsersService.setPermissions()` the Settings >
 * Users Permission Matrix already uses. HR always sees/can edit the actual
 * checked permissions afterward — this is a starting point, not a second
 * source of truth. "Scope" (Part D) is not a separate stored field: Sales
 * visibility scope is already derived automatically from Department/Sales
 * Team management (`SalesScopeService`), so no additional input is needed
 * here beyond the Employee's own Department/Team placement (Step 2).
 */
export const HR_ROLE_PRESET_KEYS = [
  'EMPLOYEE',
  'MANAGER',
  'HR',
  'SALES_MANAGER',
  'FINANCE',
] as const;

export type HrRolePresetKey = (typeof HR_ROLE_PRESET_KEYS)[number];

export const HR_ROLE_PRESETS: Record<HrRolePresetKey, string[]> = {
  // Base/self-service only — no extra grants beyond the unguarded "My
  // Profile" self-view every authenticated user already has.
  EMPLOYEE: [],
  MANAGER: [
    'hr.kpi-evaluations.view',
    'hr.kpi-evaluations.edit',
    'hr.kpi-evaluations.submit',
  ],
  HR: [
    'hr.employees.view',
    'hr.employees.create',
    'hr.employees.edit',
    'hr.employees.archive',
    'hr.employees.export',
    'hr.compensation.view',
    'hr.compensation.create',
    'hr.compensation.edit',
    'hr.payroll-components.view',
    'hr.payroll-components.create',
    'hr.payroll-components.edit',
    'hr.payroll-components.archive',
    'hr.kpi-templates.view',
    'hr.kpi-templates.create',
    'hr.kpi-templates.edit',
    'hr.kpi-templates.archive',
    'hr.kpi-evaluations.view',
    'hr.kpi-evaluations.approve',
    'hr.kpi-evaluations.reopen',
    'hr.payroll.view',
    'hr.payroll.create',
    'hr.payroll.edit',
    'hr.payroll.hr-review',
  ],
  SALES_MANAGER: [
    'hr.sales-targets.view',
    'hr.sales-targets.create',
    'hr.sales-targets.edit',
    'hr.sales-targets.delete',
    'hr.commission-plans.view',
    'hr.commissions.view',
    'hr.commissions.approve',
    'hr.commissions.adjust',
    'hr.kpi-evaluations.view',
    'hr.kpi-evaluations.edit',
    'hr.kpi-evaluations.submit',
  ],
  FINANCE: [
    'hr.payroll.view',
    'hr.payroll.finance-approve',
    'hr.payroll.post',
    'hr.payroll.pay',
    'hr.payroll.print',
    'hr.payroll.export',
  ],
};
