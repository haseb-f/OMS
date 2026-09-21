import { ForbiddenException } from '@nestjs/common';
import { PermissionsResolverService } from '../../permissions/permissions-resolver.service';

/**
 * One-click transitions (Draft → Confirmed/Posted) may skip the separate
 * Submit/Approve clicks only for a user who holds the approval permission
 * themselves — the approval control is exercised, not bypassed, and the
 * activity log still records the implicit approval.
 */
export async function assertApprovalAuthority(
  resolver: PermissionsResolverService,
  userId: string | undefined,
  permissionName: string,
  documentLabel: string,
): Promise<void> {
  if (userId && (await resolver.hasPermission(userId, permissionName))) {
    return;
  }
  throw new ForbiddenException(
    `${documentLabel} has not been approved yet — submit it for approval, or ask a user with "${permissionName}" to approve it.`,
  );
}
