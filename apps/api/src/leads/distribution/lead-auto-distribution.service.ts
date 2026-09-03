import { BadRequestException, Injectable } from '@nestjs/common';
import {
  LeadAssignmentMethod,
  LeadDistributionMode,
  LeadDistributionScope,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PermissionsResolverService } from '../../permissions/permissions-resolver.service';
import { LeadAssignmentsService } from '../assignments/lead-assignments.service';

const ASSIGNABLE_PERMISSION = 'crm.leads.edit';

export interface ActivatePolicyInput {
  mode: LeadDistributionMode;
  teamId?: string | null;
  departmentId?: string | null;
  actorId?: string;
  now?: Date;
}

/**
 * Authoritative automatic Lead distribution: persistent policy + strict
 * Round Robin with a row-locked cursor. Manual assignment is a separate
 * action on LeadAssignmentsService.
 */
@Injectable()
export class LeadAutoDistributionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resolver: PermissionsResolverService,
    private readonly leadAssignmentsService: LeadAssignmentsService,
  ) {}

  async getEffectivePolicy(now = new Date()) {
    const policies = await this.prisma.leadDistributionPolicy.findMany({
      where: { isActive: true, deletedAt: null },
      orderBy: { startedAt: 'desc' },
    });
    return (
      policies.find((policy) => this.isPolicyEffective(policy, now)) ?? null
    );
  }

  isPolicyEffective(
    policy: {
      isActive: boolean;
      deletedAt: Date | null;
      mode: LeadDistributionMode;
      expiresAt: Date | null;
    },
    now = new Date(),
  ) {
    if (!policy.isActive || policy.deletedAt) return false;
    if (
      policy.mode === LeadDistributionMode.TIME_LIMITED &&
      policy.expiresAt &&
      now >= policy.expiresAt
    ) {
      return false;
    }
    return true;
  }

  async getPolicySnapshot(now = new Date()) {
    const policy = await this.getEffectivePolicy(now);
    const eligible = await this.getEligibleEmployees(policy?.teamId);
    return {
      policy: policy
        ? {
            ...policy,
            remainingMs:
              policy.mode === LeadDistributionMode.TIME_LIMITED &&
              policy.expiresAt
                ? Math.max(0, policy.expiresAt.getTime() - now.getTime())
                : null,
          }
        : null,
      eligible,
    };
  }

  async activate(input: ActivatePolicyInput) {
    const now = input.now ?? new Date();
    const expiresAt =
      input.mode === LeadDistributionMode.TIME_LIMITED
        ? new Date(now.getTime() + 24 * 60 * 60 * 1000)
        : null;

    return this.prisma.$transaction(async (tx) => {
      await tx.leadDistributionPolicy.updateMany({
        where: { isActive: true, deletedAt: null },
        data: { isActive: false, updatedBy: input.actorId ?? null },
      });
      const policy = await tx.leadDistributionPolicy.create({
        data: {
          mode: input.mode,
          isActive: true,
          startedAt: now,
          expiresAt,
          scopeType: input.teamId
            ? LeadDistributionScope.TEAM
            : input.departmentId
              ? LeadDistributionScope.DEPARTMENT
              : LeadDistributionScope.COMPANY,
          teamId: input.teamId ?? null,
          departmentId: input.departmentId ?? null,
          createdBy: input.actorId ?? null,
          updatedBy: input.actorId ?? null,
        },
      });
      await tx.leadDistributionState.create({
        data: { policyId: policy.id, cursorPosition: 0 },
      });
      return policy;
    });
  }

  async deactivate(actorId?: string) {
    await this.prisma.leadDistributionPolicy.updateMany({
      where: { isActive: true, deletedAt: null },
      data: { isActive: false, updatedBy: actorId ?? null },
    });
    return this.getPolicySnapshot();
  }

  /** Assigns one unowned Lead when an effective automatic policy exists. */
  async distribute(leadId: string, now = new Date()): Promise<void> {
    const policy = await this.getEffectivePolicy(now);
    if (!policy) return;
    await this.prisma.$transaction(
      async (tx) => {
        await this.distributeInTx(tx, leadId, policy, now);
      },
      { timeout: 20_000 },
    );
  }

  async distributeMany(leadIds: string[], now = new Date()): Promise<void> {
    if (leadIds.length === 0) return;
    const policy = await this.getEffectivePolicy(now);
    if (!policy) return;
    await this.prisma.$transaction(async (tx) => {
      for (const leadId of leadIds) {
        await this.distributeInTx(tx, leadId, policy, now);
      }
    });
  }

  private async distributeInTx(
    tx: Prisma.TransactionClient,
    leadId: string,
    policy: { id: string; mode: LeadDistributionMode; teamId: string | null },
    now: Date,
  ) {
    const lead = await tx.lead.findFirst({
      where: { id: leadId, deletedAt: null },
      select: { id: true, salesEmployeeId: true },
    });
    if (!lead || lead.salesEmployeeId) return;

    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM lead_distribution_states
      WHERE policy_id = ${policy.id}::uuid
      FOR UPDATE
    `;
    if (locked.length === 0) {
      await tx.leadDistributionState.create({
        data: { policyId: policy.id, cursorPosition: 0 },
      });
      await tx.$queryRaw`
        SELECT id FROM lead_distribution_states
        WHERE policy_id = ${policy.id}::uuid
        FOR UPDATE
      `;
    }

    const state = await tx.leadDistributionState.findUnique({
      where: { policyId: policy.id },
    });
    if (!state) return;

    const eligible = await this.getEligibleEmployeeIds(policy.teamId);
    if (eligible.length === 0) return;

    const next = this.nextRoundRobin(eligible, state.lastAssignedEmployeeId);
    const method =
      policy.mode === LeadDistributionMode.TIME_LIMITED
        ? LeadAssignmentMethod.AUTO_24H
        : LeadAssignmentMethod.AUTO_CONTINUOUS;

    await this.leadAssignmentsService.assign(
      leadId,
      { salesEmployeeId: next, method, actorId: null },
      tx,
    );

    await tx.leadDistributionState.update({
      where: { policyId: policy.id },
      data: {
        lastAssignedEmployeeId: next,
        cursorPosition: (state.cursorPosition + 1) % eligible.length,
        updatedAt: now,
      },
    });
  }

  nextRoundRobin(eligible: string[], lastAssignedEmployeeId: string | null) {
    if (eligible.length === 0) {
      throw new BadRequestException('No eligible sales employees.');
    }
    if (!lastAssignedEmployeeId) return eligible[0];
    const index = eligible.indexOf(lastAssignedEmployeeId);
    if (index < 0) return eligible[0];
    return eligible[(index + 1) % eligible.length];
  }

  async getEligibleEmployees(teamId?: string | null) {
    const ids = await this.getEligibleEmployeeIds(teamId);
    if (ids.length === 0) return [];
    return this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, fullName: true, email: true },
      orderBy: { fullName: 'asc' },
    });
  }

  async getEligibleEmployeeIds(teamId?: string | null): Promise<string[]> {
    const permittedUserIds = await this.resolver.getUsersWithPermission(
      ASSIGNABLE_PERMISSION,
    );
    if (permittedUserIds.length === 0) return [];

    let scopedIds = permittedUserIds;
    if (teamId) {
      const team = await this.prisma.salesTeam.findFirst({
        where: { id: teamId, deletedAt: null, isActive: true },
        select: {
          managerId: true,
          members: { select: { userId: true } },
        },
      });
      if (!team) return [];
      const teamUserIds = new Set([
        team.managerId,
        ...team.members.map((m) => m.userId),
      ]);
      scopedIds = permittedUserIds.filter((id) => teamUserIds.has(id));
    }

    const activeUsers = await this.prisma.user.findMany({
      where: {
        id: { in: scopedIds },
        deletedAt: null,
        isActive: true,
        isLocked: false,
      },
      select: { id: true, fullName: true },
      orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
    });
    return activeUsers.map((u) => u.id);
  }
}
