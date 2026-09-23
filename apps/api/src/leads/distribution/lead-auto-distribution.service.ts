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
  /** When true (default for Continuous/24h), drain pending unowned leads. */
  distributePending?: boolean;
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
 *
 * Timing: assignment runs synchronously on Lead create when Continuous/24h
 * is effective, and on Continuous/24h activate (drains pending unowned /
 * held leads). There is no cron — latency is in-request (typically <2s).
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

  /** Unowned leads that Continuous mode should assign (held + orphaned). */
  async countPendingEligible() {
    return this.prisma.lead.count({
      where: {
        deletedAt: null,
        salesEmployeeId: null,
      },
    });
  }

  async getPolicySnapshot(now = new Date()) {
    const policy = await this.getLatestPolicy();
    const status = this.resolveRuntimeStatus(policy, now);
    const eligible = await this.getEligibleEmployees(policy?.teamId);
    const heldBatches = await this.getHeldBatches();
    const heldCount = heldBatches.reduce((sum, batch) => sum + batch.count, 0);
    const pendingEligibleCount = await this.countPendingEligible();
    const state = policy
      ? await this.prisma.leadDistributionState.findUnique({
          where: { policyId: policy.id },
        })
      : null;

    let failureReason: string | null = state?.lastFailureMessage ?? null;
    if (!failureReason && eligible.length === 0 && status !== 'PAUSED') {
      failureReason =
        'No eligible sales employees. Grant crm.leads.edit to active, unlocked users (and ensure they are in the selected team when team-scoped).';
    } else if (
      !failureReason &&
      pendingEligibleCount > 0 &&
      status !== 'CONTINUOUS' &&
      status !== 'TIME_LIMITED'
    ) {
      failureReason =
        'Distribution is paused or manual. Pending unowned leads will not assign until Continuous or 24-hour mode is activated (or a batch is released).';
    }

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
      pendingEligibleCount,
      lastRun: state
        ? {
            at: state.lastRunAt,
            assigned: state.lastRunAssigned,
            failureCode: state.lastFailureCode,
            failureMessage: state.lastFailureMessage,
          }
        : null,
      failureReason,
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
    const shouldDrain =
      input.distributePending !== false && isAutoMode(input.mode);

    const policy = await this.prisma.$transaction(async (tx) => {
      await tx.leadDistributionPolicy.updateMany({
        where: { isActive: true, deletedAt: null },
        data: { isActive: false, updatedBy: input.actorId ?? null },
      });
      const created = await tx.leadDistributionPolicy.create({
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
          data: { policyId: created.id, cursorPosition: 0 },
        });
      }
      return created;
    });

    if (shouldDrain) {
      await this.distributePending({ now, includeHeld: true });
    }

    return policy;
  }

  async pause(actorId?: string) {
    await this.activate({
      mode: LeadDistributionMode.PAUSED,
      actorId,
      distributePending: false,
    });
    return this.getPolicySnapshot();
  }

  async activateManual(actorId?: string) {
    await this.activate({
      mode: LeadDistributionMode.MANUAL,
      actorId,
      distributePending: false,
    });
    return this.getPolicySnapshot();
  }

  /** @deprecated Use pause() — kept as the HTTP deactivate alias. */
  async deactivate(actorId?: string) {
    return this.pause(actorId);
  }

  /**
   * Assign every currently unowned Lead under the effective auto policy.
   * Owned leads are never touched (safe to re-run).
   */
  async distributePending(options?: {
    now?: Date;
    includeHeld?: boolean;
    importBatch?: string | null;
  }): Promise<{
    assigned: number;
    skipped: number;
    failureReason: string | null;
  }> {
    const now = options?.now ?? new Date();
    const policy = await this.getEffectivePolicy(now);
    if (!policy) {
      return {
        assigned: 0,
        skipped: 0,
        failureReason:
          'No effective Continuous or 24-hour distribution policy.',
      };
    }

    const pending = await this.prisma.lead.findMany({
      where: {
        deletedAt: null,
        salesEmployeeId: null,
        ...(options?.includeHeld === false ? { distributionHeld: false } : {}),
        ...(options?.importBatch !== undefined
          ? { importBatch: options.importBatch || null }
          : {}),
      },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });

    if (pending.length === 0) {
      await this.recordRun(policy.id, {
        assigned: 0,
        failureCode: null,
        failureMessage: null,
        now,
      });
      return { assigned: 0, skipped: 0, failureReason: null };
    }

    const eligible = await this.getEligibleEmployeeIds(policy.teamId);
    if (eligible.length === 0) {
      const message =
        'No eligible sales employees. Grant crm.leads.edit to active, unlocked users' +
        (policy.teamId ? ' who belong to the selected team' : '') +
        '.';
      // Park them as held so the UI surfaces the backlog instead of silent orphans.
      await this.prisma.lead.updateMany({
        where: { id: { in: pending.map((p) => p.id) } },
        data: { distributionHeld: true },
      });
      await this.recordRun(policy.id, {
        assigned: 0,
        failureCode: 'NO_ELIGIBLE_EMPLOYEES',
        failureMessage: message,
        now,
      });
      return {
        assigned: 0,
        skipped: pending.length,
        failureReason: message,
      };
    }

    let assigned = 0;
    await this.prisma.$transaction(
      async (tx) => {
        for (const lead of pending) {
          const before = await tx.lead.findFirst({
            where: { id: lead.id, deletedAt: null },
            select: { salesEmployeeId: true },
          });
          if (before?.salesEmployeeId) continue;
          await this.distributeInTx(tx, lead.id, policy, now, {
            includeHeld: true,
          });
          const after = await tx.lead.findFirst({
            where: { id: lead.id },
            select: { salesEmployeeId: true },
          });
          if (after?.salesEmployeeId) assigned += 1;
        }
        await this.recordRunTx(tx, policy.id, {
          assigned,
          failureCode: null,
          failureMessage: null,
          now,
        });
      },
      { timeout: 120_000 },
    );

    return {
      assigned,
      skipped: pending.length - assigned,
      failureReason: null,
    };
  }

  /** Assigns one unowned Lead when an effective automatic policy exists. */
  async distribute(
    leadId: string,
    now = new Date(),
    options?: { includeHeld?: boolean },
  ): Promise<{ assigned: boolean; failureReason: string | null }> {
    const policy = await this.getEffectivePolicy(now);
    if (!policy) return { assigned: false, failureReason: null };

    let assigned = false;
    let failureReason: string | null = null;

    await this.prisma.$transaction(
      async (tx) => {
        const eligible = await this.getEligibleEmployeeIds(policy.teamId);
        if (eligible.length === 0) {
          failureReason =
            'No eligible sales employees. Grant crm.leads.edit to active, unlocked users.';
          await tx.lead.updateMany({
            where: { id: leadId, salesEmployeeId: null, deletedAt: null },
            data: { distributionHeld: true },
          });
          await this.recordRunTx(tx, policy.id, {
            assigned: 0,
            failureCode: 'NO_ELIGIBLE_EMPLOYEES',
            failureMessage: failureReason,
            now,
          });
          return;
        }

        const before = await tx.lead.findFirst({
          where: { id: leadId, deletedAt: null },
          select: { salesEmployeeId: true },
        });
        if (before?.salesEmployeeId) {
          assigned = true;
          return;
        }

        await this.distributeInTx(tx, leadId, policy, now, options);
        const after = await tx.lead.findFirst({
          where: { id: leadId },
          select: { salesEmployeeId: true },
        });
        assigned = Boolean(after?.salesEmployeeId);
        await this.recordRunTx(tx, policy.id, {
          assigned: assigned ? 1 : 0,
          failureCode: null,
          failureMessage: null,
          now,
        });
      },
      { timeout: 20_000 },
    );

    return { assigned, failureReason };
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
      let assigned = 0;
      for (const leadId of leadIds) {
        const before = await tx.lead.findFirst({
          where: { id: leadId, deletedAt: null },
          select: { salesEmployeeId: true },
        });
        if (before?.salesEmployeeId) continue;
        await this.distributeInTx(tx, leadId, policy, now, options);
        const after = await tx.lead.findFirst({
          where: { id: leadId },
          select: { salesEmployeeId: true },
        });
        if (after?.salesEmployeeId) assigned += 1;
      }
      await this.recordRunTx(tx, policy.id, {
        assigned,
        failureCode: null,
        failureMessage: null,
        now,
      });
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
        // releaseHeld already distributes below — avoid double drain.
        distributePending: false,
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

  private async recordRun(
    policyId: string,
    input: {
      assigned: number;
      failureCode: string | null;
      failureMessage: string | null;
      now: Date;
    },
  ) {
    await this.prisma.leadDistributionState.updateMany({
      where: { policyId },
      data: {
        lastRunAt: input.now,
        lastRunAssigned: input.assigned,
        lastFailureCode: input.failureCode,
        lastFailureMessage: input.failureMessage,
      },
    });
  }

  private async recordRunTx(
    tx: Prisma.TransactionClient,
    policyId: string,
    input: {
      assigned: number;
      failureCode: string | null;
      failureMessage: string | null;
      now: Date;
    },
  ) {
    await tx.leadDistributionState.updateMany({
      where: { policyId },
      data: {
        lastRunAt: input.now,
        lastRunAssigned: input.assigned,
        lastFailureCode: input.failureCode,
        lastFailureMessage: input.failureMessage,
      },
    });
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
    if (eligible.length === 0) {
      await tx.lead.update({
        where: { id: leadId },
        data: { distributionHeld: true },
      });
      return;
    }

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
