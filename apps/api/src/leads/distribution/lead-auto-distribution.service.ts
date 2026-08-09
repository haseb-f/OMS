import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PermissionsResolverService } from '../../permissions/permissions-resolver.service';
import { LeadAssignmentsService } from '../assignments/lead-assignments.service';

const ASSIGNABLE_PERMISSION = 'crm.leads.edit';
const LOOKBACK_HOURS = 24;

/**
 * TASK-061 §5 — "distribute new leads equally between active Customer
 * Service employees who have permission to handle Leads/Orders." Eligible =
 * an active (`isActive`, not locked, not soft-deleted) User granted
 * `crm.leads.edit`. Balance is computed from each eligible employee's own
 * `LeadAssignment` count over the trailing 24 hours (the rule this service's
 * doc comment originally specified) — the employee with the fewest recent
 * assignments receives the next one. Every actual assignment still goes
 * through `LeadAssignmentsService.assign()` (the one append-only assignment
 * write path — never a second one), so auto-assigned and manually-assigned
 * Leads share identical history/activity-log behavior.
 */
@Injectable()
export class LeadAutoDistributionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resolver: PermissionsResolverService,
    private readonly leadAssignmentsService: LeadAssignmentsService,
  ) {}

  /** Assigns one Lead to the least-loaded eligible employee. No-op (leaves it unassigned) if no eligible employee exists — never fails the Lead creation itself. */
  async distribute(leadId: string): Promise<void> {
    const eligible = await this.getEligibleEmployeeIds();
    if (eligible.length === 0) return;
    const counts = await this.getRecentAssignmentCounts(eligible);
    const employeeId = this.leastLoaded(eligible, counts);
    await this.leadAssignmentsService.assign(leadId, {
      salesEmployeeId: employeeId,
    });
  }

  /**
   * Manual/Bulk Assignment (§6) "balanced distribution among eligible
   * employees" — distributes a batch of Leads, keeping the running count
   * balanced within the batch itself rather than re-querying the trailing
   * 24h window after every single assignment.
   */
  async distributeMany(leadIds: string[]): Promise<void> {
    if (leadIds.length === 0) return;
    const eligible = await this.getEligibleEmployeeIds();
    if (eligible.length === 0) return;
    const counts = await this.getRecentAssignmentCounts(eligible);
    for (const leadId of leadIds) {
      const employeeId = this.leastLoaded(eligible, counts);
      await this.leadAssignmentsService.assign(leadId, {
        salesEmployeeId: employeeId,
      });
      counts.set(employeeId, (counts.get(employeeId) ?? 0) + 1);
    }
  }

  /** Powers the Assign dialog's employee picker — "who is even eligible to receive this?" (§6). */
  async getEligibleEmployees() {
    const permittedUserIds = await this.resolver.getUsersWithPermission(
      ASSIGNABLE_PERMISSION,
    );
    if (permittedUserIds.length === 0) return [];
    return this.prisma.user.findMany({
      where: {
        id: { in: permittedUserIds },
        deletedAt: null,
        isActive: true,
        isLocked: false,
      },
      select: { id: true, fullName: true, email: true },
      orderBy: { fullName: 'asc' },
    });
  }

  private leastLoaded(eligible: string[], counts: Map<string, number>): string {
    let best = eligible[0];
    let bestCount = counts.get(best) ?? 0;
    for (const id of eligible.slice(1)) {
      const count = counts.get(id) ?? 0;
      if (count < bestCount) {
        best = id;
        bestCount = count;
      }
    }
    return best;
  }

  private async getEligibleEmployeeIds(): Promise<string[]> {
    const permittedUserIds = await this.resolver.getUsersWithPermission(
      ASSIGNABLE_PERMISSION,
    );
    if (permittedUserIds.length === 0) return [];
    const activeUsers = await this.prisma.user.findMany({
      where: {
        id: { in: permittedUserIds },
        deletedAt: null,
        isActive: true,
        isLocked: false,
      },
      select: { id: true },
    });
    return activeUsers.map((u) => u.id);
  }

  private async getRecentAssignmentCounts(
    employeeIds: string[],
  ): Promise<Map<string, number>> {
    const since = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000);
    const rows = await this.prisma.leadAssignment.groupBy({
      by: ['assignedToId'],
      where: {
        assignedToId: { in: employeeIds },
        assignedAt: { gte: since },
        deletedAt: null,
      },
      _count: { _all: true },
    });
    const counts = new Map<string, number>(employeeIds.map((id) => [id, 0]));
    for (const row of rows) {
      counts.set(row.assignedToId, row._count._all);
    }
    return counts;
  }
}
