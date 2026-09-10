/** Mirrors `apps/api/src/employees/hr-role-presets.ts`'s `HR_ROLE_PRESET_KEYS` — the Employee wizard's Step 4 "Role" options. The actual permission bundle each key expands to is resolved server-side; the frontend only needs the key list + labels. */
export const HR_ROLE_PRESET_KEYS = [
  "EMPLOYEE",
  "MANAGER",
  "HR",
  "SALES_MANAGER",
  "FINANCE",
] as const;

export type HrRolePresetKey = (typeof HR_ROLE_PRESET_KEYS)[number];
