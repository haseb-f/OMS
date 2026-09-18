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

export type LeadDistributionRuntimeStatus =
  'CONTINUOUS' | 'TIME_LIMITED' | 'MANUAL' | 'PAUSED';

export interface ActivatePolicyInput {
  mode: LeadDistributionMode;
  teamId?: string | null;
  departmentId?: string | null;
  actorId?: string;
  now?: Date;
}

function isAutoMode(mode: LeadDistributionMode) {
  return (
    mode === LeadDistributionMode.CONTINUOUS ||
    mode === LeadDistributionMode.TIME_LIMITED
  );
}

/**
 * Authoritative automatic Lead distribution: persistent policy + strict
 * Round Robin with a row-locked cursor. Manual assignment is a separate
 * action on LeadAssignmentsService. PAUSED / MANUAL are first-class
 * runtime states — not the absence of a policy.
 */
@Injectable()
export class LeadAutoDistributionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resolver: PermissionsResolverService,
    private readonly leadAssignmentsService: LeadAssignmentsService,
  ) {}

  async getLatestPolicy() {
    return this.prisma.leadDistributionPolicy.findFirst({
      where: { isActive: true, deletedAt: null },
      orderBy: { startedAt: 'desc' },
    });
  }

  async getEffectivePolicy(now = new Date()) {
    const policy = await this.getLatestPolicy();
    if (!policy || !this.isPolicyEffective(policy, now)) return null;
    return policy;
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
    if (!isAutoMode(policy.mode)) return false;
    if (
      policy.mode === LeadDistributionMode.TIME_LIMITED &&
      policy.expiresAt &&
      now >= policy.expiresAt
    ) {
      return false;
    }
    return true;
  }

  resolveRuntimeStatus(
    policy: {
      isActive: boolean;
      deletedAt: Date | null;
      mode: LeadDistributionMode;
      expiresAt: Date | null;
    } | null,
    now = new Date(),
  ): LeadDistributionRuntimeStatus {
    if (!policy || !policy.isActive || policy.deletedAt) return 'PAUSED';
    if (policy.mode === LeadDistributionMode.PAUSED) return 'PAUSED';
    if (policy.mode === LeadDistributionMode.MANUAL) return 'MANUAL';
    if (
      policy.mode === LeadDistributionMode.TIME_LIMITED &&
      policy.expiresAt &&
      now >= policy.expiresAt
    ) {
      return 'PAUSED';
    }
    if (policy.mode === LeadDistributionMode.TIME_LIMITED)
      return 'TIME_LIMITED';
    if (policy.mode === LeadDistributionMode.CONTINUOUS) return 'CONTINUOUS';
    return 'PAUSED';
  }

  async getHeldBatches() {
    const grouped = await this.prisma.lead.groupBy({
      by: ['importBatch'],
      where: {
        distributionHeld: true,
        deletedAt: null,
        salesEmployeeId: null,
      },
      _count: { _all: true },
      _min: { createdAt: true },
    });
    return grouped
      .map((row) => ({
        importBatch: row.importBatch,
        count: row._count._all,
        createdAt: row._min.createdAt,
      }))
      .sort(
        (a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0),
      );
  }

  async getPolicySnapshot(now = new Date()) {
    const policy = await this.getLatestPolicy();
    const status = this.resolveRuntimeStatus(policy, now);
    const eligible = await this.getEligibleEmployees(policy?.teamId);
    const heldBatches = await this.getHeldBatches();
    const heldCount = heldBatches.reduce((sum, batch) => sum + batch.count, 0);
    return {
      status,
      isRunning: status === 'CONTINUOUS' || status === 'TIME_LIMITED',
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
      held: {
        count: heldCount,
        batches: heldBatches,
      },
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
      if (isAutoMode(input.mode)) {
        await tx.leadDistributionState.create({
          data: { policyId: policy.id, cursorPosition: 0 },
        });
      }
      return policy;
    });
  }

  async pause(actorId?: string) {
    await this.activate({
      mode: LeadDistributionMode.PAUSED,
      actorId,
    });
    return this.getPolicySnapshot();
  }

  async activateManual(actorId?: string) {
    await this.activate({
      mode: LeadDistributionMode.MANUAL,
      actorId,
    });
    return this.getPolicySnapshot();
  }

  /** @deprecated Use pause() — kept as the HTTP deactivate alias. */
  async deactivate(actorId?: string) {
    return this.pause(actorId);
  }

  /** Assigns one unowned Lead when an effective automatic policy exists. */
  async distribute(
    leadId: string,
    now = new Date(),
    options?: { includeHeld?: boolean },
  ): Promise<void> {
    const policy = await this.getEffectivePolicy(now);
    if (!policy) return;
    await this.prisma.$transaction(
      async (tx) => {
        await this.distributeInTx(tx, leadId, policy, now, options);
      },
      { timeout: 20_000 },
    );
  }

  async distributeMany(
    leadIds: string[],
    now = new Date(),
    options?: { includeHeld?: boolean },
  ): Promise<void> {
    if (leadIds.length === 0) return;
    const policy = await this.getEffectivePolicy(now);
    if (!policy) return;
    await this.prisma.$transaction(async (tx) => {
      for (const leadId of leadIds) {
        await this.distributeInTx(tx, leadId, policy, now, options);
      }
    });
  }

  async releaseHeld(input: {
    importBatch?: string | null;
    mode?: LeadDistributionMode;
    salesEmployeeId?: string;
    actorId?: string;
  }) {
    if (
      input.mode === LeadDistributionMode.CONTINUOUS ||
      input.mode === LeadDistributionMode.TIME_LIMITED ||
      input.mode === LeadDistributionMode.MANUAL
    ) {
      const current = await this.getLatestPolicy();
      await this.activate({
        mode: input.mode,
        actorId: input.actorId,
        teamId: current?.teamId,
        departmentId: current?.departmentId,
      });
    }

    const heldWhere: Prisma.LeadWhereInput = {
      distributionHeld: true,
      deletedAt: null,
      salesEmployeeId: null,
      ...(input.importBatch !== undefined
        ? { importBatch: input.importBatch || null }
        : {}),
    };
    const held = await this.prisma.lead.findMany({
      where: heldWhere,
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    if (held.length === 0) {
      return { released: 0, ids: [] as string[] };
    }

    if (input.salesEmployeeId) {
      for (const lead of held) {
        await this.leadAssignmentsService.assign(lead.id, {
          salesEmployeeId: input.salesEmployeeId,
          method: LeadAssignmentMethod.MANUAL,
          actorId: input.actorId ?? null,
        });
      }
      return { released: held.length, ids: held.map((row) => row.id) };
    }

    const policy = await this.getEffectivePolicy();
    if (!policy) {
      throw new BadRequestException(
        'Choose Continuous or 24-hour distribution, or assign the batch manually.',
      );
    }
    await this.distributeMany(
      held.map((row) => row.id),
      new Date(),
      { includeHeld: true },
    );
    return { released: held.length, ids: held.map((row) => row.id) };
  }

  private async distributeInTx(
    tx: Prisma.TransactionClient,
    leadId: string,
    policy: { id: string; mode: LeadDistributionMode; teamId: string | null },
    now: Date,
    options?: { includeHeld?: boolean },
  ) {
    const lead = await tx.lead.findFirst({
      where: { id: leadId, deletedAt: null },
      select: { id: true, salesEmployeeId: true, distributionHeld: true },
    });
    if (!lead || lead.salesEmployeeId) return;
    if (lead.distributionHeld && !options?.includeHeld) return;

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
