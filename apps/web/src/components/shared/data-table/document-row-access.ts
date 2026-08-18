/**
 * UI-only capability flags for operational document row menus.
 * Backend authorization stays authoritative; this only hides actions the
 * current user cannot execute.
 */
export function documentRowAccess(hasPermission: (permission: string) => boolean, module: string) {
  return {
    canView: hasPermission(`${module}.view`),
    canEdit: hasPermission(`${module}.edit`),
    canCreate: hasPermission(`${module}.create`),
    canPrint: hasPermission(`${module}.print`),
    canCancel: hasPermission(`${module}.cancel`),
    canArchive: hasPermission(`${module}.archive`),
    canConfirm: hasPermission(`${module}.confirm`),
    canPost: hasPermission(`${module}.post`),
    canReverse: hasPermission(`${module}.reverse`),
  };
}
