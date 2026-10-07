import { BadRequestException, Injectable } from '@nestjs/common';
import { EmployeeStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PermissionsResolverService } from '../../permissions/permissions-resolver.service';

/**
 * The ONE permission that means "can handle Leads/Orders". Shared by the
 * automatic distribution, the pending-lead drains, the manual eligible
 * assignees list and `assertEligibleEmployee` (previously two copies).
 */
export const LEAD_HANDLING_PERMISSION = 'crm.leads.edit';

/** Cap on how many excluded users are returned for display. */
const EXCLUDED_LIMIT = 200;

export type LeadExclusionReason =
  /** An external agent's user — agent leads and internal leads never mix. */
  | 'AGENT_USER'
  | 'DELETED'
  | 'INACTIVE'
  | 'LOCKED'
  /** Linked employment record is INACTIVE (e.g. on leave / suspended). */
  | 'ON_LEAVE'
  | 'TERMINATED'
  | 'NO_PERMISSION'
  /** Not designated as a sales employee (`User.salesDistributionEligible`). */
  | 'NOT_SALES_DESIGNATED'
  | 'WRONG_TEAM'
  | 'WRONG_DEPARTMENT';

export interface LeadEligibilityScope {
  teamId?: string | null;
  departmentId?: string | null;
}

export interface EligibleSalesUser {
  id: string;
  fullName: string;
  email: string;
}

export interface ExcludedSalesUser {
  id: string;
  fullName: string;
  email: string;
  /** Highest-priority reason (the one to show first). */
  reason: LeadExclusionReason;
  /** Every failed rule, in priority order. */
  reasons: LeadExclusionReason[];
}

export interface LeadEligibilityResult {
  eligible: EligibleSalesUser[];
  excluded: ExcludedSalesUser[];
  /** More excluded users existed than were returned. */
  excludedTruncated: boolean;
}

/** Reasons in the order they are reported (first = primary). */
const REASON_ORDER: LeadExclusionReason[] = [
  'DELETED',
  'AGENT_USER',
  'INACTIVE',
  'LOCKED',
  'TERMINATED',
  'ON_LEAVE',
  'NOT_SALES_DESIGNATED',
  'NO_PERMISSION',
  'WRONG_TEAM',
  'WRONG_DEPARTMENT',
];

interface EligibilityUserFacts {
  isActive: boolean;
  isLocked: boolean;
  deletedAt: Date | null;
  userType: string;
  salesDistributionEligible: boolean;
  departmentId?: string | null;
  employeeProfile: {
    employmentStatus: EmployeeStatus;
    deletedAt: Date | null;
  } | null;
}

/** Every failed rule for one user, primary reason first (empty = eligible). */
export function exclusionReasons(
  user: EligibilityUserFacts,
  hasPermission: boolean,
  scope: { teamUserIds?: Set<string> | null; departmentId?: string | null },
  userId?: string,
): LeadExclusionReason[] {
  const failed = new Set<LeadExclusionReason>();
  if (user.deletedAt) failed.add('DELETED');
  if (user.userType !== 'INTERNAL') failed.add('AGENT_USER');
  if (!user.isActive) failed.add('INACTIVE');
  if (user.isLocked) failed.add('LOCKED');
  const employment =
    user.employeeProfile && !user.employeeProfile.deletedAt
      ? user.employeeProfile.employmentStatus
      : null;
  if (employment === EmployeeStatus.TERMINATED) failed.add('TERMINATED');
  if (employment === EmployeeStatus.INACTIVE) failed.add('ON_LEAVE');
  if (!user.salesDistributionEligible) failed.add('NOT_SALES_DESIGNATED');
  if (!hasPermission) failed.add('NO_PERMISSION');
  if (scope.teamUserIds && userId && !scope.teamUserIds.has(userId)) {
    failed.add('WRONG_TEAM');
  }
  if (scope.departmentId && user.departmentId !== scope.departmentId) {
    failed.add('WRONG_DEPARTMENT');
  }
  return REASON_ORDER.filter((reason) => failed.has(reason));
}

/**
 * Single source of truth for "who may receive a Lead".
 *
 * A user is eligible only if ALL hold: not deleted, INTERNAL (never an agent
 * user), active, not locked, employment (when an employee record is linked)
 * ACTIVE, holds `crm.leads.edit`, is explicitly designated a sales employee
 * (`User.salesDistributionEligible` — never inferred from a name or title),
 * and sits in the policy's team / department when it is scoped to one.
 * Internal and agent pools stay separate: an agent lead never goes through
 * this (it is assigned inside its own agent), and agent users never qualify.
 */
@Injectable()
export class LeadEligibilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resolver: PermissionsResolverService,
  ) {}

  /** Eligible recipients (stable order) AND the considered-but-excluded users with reasons. */
  async evaluate(
    scope: LeadEligibilityScope = {},
  ): Promise<LeadEligibilityResult> {
    const teamUserIds = await this.resolveTeamUserIds(scope.teamId);

    // R14 — holders through an individual GRANT or the job-title template,
    // never a user with an individual DENY (one resolver rule).
    const permittedIds = new Set(
      await this.resolver.getUsersWithPermission(LEAD_HANDLING_PERMISSION),
    );

    // Considered = anyone who could plausibly be a recipient: holds the
    // handling permission, is flagged Sales, or is on the selected team.
    const users = await this.prisma.user.findMany({
      where: {
        OR: [
          { id: { in: [...permittedIds] } },
          { salesDistributionEligible: true },
          ...(teamUserIds ? [{ id: { in: [...teamUserIds] } }] : []),
        ],
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        isActive: true,
        isLocked: true,
        deletedAt: true,
        userType: true,
        salesDistributionEligible: true,
        departmentId: true,
        employeeProfile: {
          select: { employmentStatus: true, deletedAt: true },
        },
      },
      orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
    });

    const eligible: EligibleSalesUser[] = [];
    const excluded: ExcludedSalesUser[] = [];
    for (const user of users) {
      const reasons = exclusionReasons(
        user,
        permittedIds.has(user.id),
        { teamUserIds, departmentId: scope.departmentId },
        user.id,
      );
      if (reasons.length === 0) {
        eligible.push({
          id: user.id,
          fullName: user.fullName,
          email: user.email,
        });
        continue;
      }
      excluded.push({
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        reason: reasons[0],
        reasons,
      });
    }

    return {
      eligible,
      excluded: excluded.slice(0, EXCLUDED_LIMIT),
      excludedTruncated: excluded.length > EXCLUDED_LIMIT,
    };
  }

  /** Ids only, in the stable order Round Robin relies on (name, then id). */
  async getEligibleIds(scope: LeadEligibilityScope = {}): Promise<string[]> {
    const { eligible } = await this.evaluate(scope);
    return eligible.map((user) => user.id);
  }

  /**
   * Manual assignment / import-explicit owner gate: throws unless this one
   * user passes the SAME rules as the automatic pool. The team/department of
   * a distribution policy does not apply to a deliberate manual assignment.
   */
  async assertEligible(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
    });
    if (!user || !user.isActive || user.isLocked) {
      throw new BadRequestException(
        'Sales employee not found or is not active.',
      );
    }
    const { eligible, excluded } = await this.evaluateOne(userId);
    if (eligible) return user;
    const reason = excluded?.reason;
    if (reason === 'NOT_SALES_DESIGNATED') {
      throw new BadRequestException({
        code: 'NOT_SALES_DESIGNATED',
        message:
          'This employee is not designated as a sales employee, so leads cannot be assigned to them.',
      });
    }
    if (reason === 'NO_PERMISSION') {
      throw new BadRequestException(
        'This employee does not have permission to handle Leads/Orders.',
      );
    }
    throw new BadRequestException(
      'This employee is not eligible to receive leads (' +
        (reason ?? 'unknown') +
        ').',
    );
  }

  private async evaluateOne(userId: string) {
    const [permission, user] = await Promise.all([
      this.resolver
        .getUsersWithPermission(LEAD_HANDLING_PERMISSION, [userId])
        .then((holders) => (holders.length > 0 ? holders[0] : null)),
      this.prisma.user.findFirst({
        where: { id: userId },
        select: {
          id: true,
          fullName: true,
          email: true,
          isActive: true,
          isLocked: true,
          deletedAt: true,
          userType: true,
          salesDistributionEligible: true,
          employeeProfile: {
            select: { employmentStatus: true, deletedAt: true },
          },
        },
      }),
    ]);
    if (!user) return { eligible: false as const, excluded: null };
    const reasons = exclusionReasons(user, permission !== null, {});
    if (reasons.length === 0)
      return { eligible: true as const, excluded: null };
    return {
      eligible: false as const,
      excluded: { reason: reasons[0], reasons },
    };
  }

  private async resolveTeamUserIds(
    teamId?: string | null,
  ): Promise<Set<string> | null> {
    if (!teamId) return null;
    const team = await this.prisma.salesTeam.findFirst({
      where: { id: teamId, deletedAt: null, isActive: true },
      select: { managerId: true, members: { select: { userId: true } } },
    });
    // A missing / inactive team has no recipients (never "everyone").
    if (!team) return new Set();
    return new Set([team.managerId, ...team.members.map((m) => m.userId)]);
  }
}
