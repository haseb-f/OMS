import type { PermissionsResolverService } from '../permissions/permissions-resolver.service';
import { INVENTORY_COST_PERMISSIONS } from './inventory-cost-visibility';

/**
 * Whether the caller may see inventory cost / valuation figures (same rule as the
 * stock cards: one of the existing costing permissions, or a super admin — the
 * resolver short-circuits that). Shared by the recipe and assembly controllers so
 * the rule lives in one place next to `INVENTORY_COST_PERMISSIONS`.
 */
export async function canViewInventoryCost(
  permissions: Pick<PermissionsResolverService, 'hasPermission'>,
  userId: string,
): Promise<boolean> {
  for (const name of INVENTORY_COST_PERMISSIONS) {
    if (await permissions.hasPermission(userId, name)) return true;
  }
  return false;
}
