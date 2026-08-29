import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  StatusChangeSource,
  WorkflowApprovalStatus,
  WorkflowBusinessAction,
  WorkflowType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionsResolverService } from '../permissions/permissions-resolver.service';
import { NumberingEngineService } from '../numbering/numbering-engine.service';
import { StatusDefinitionsService } from '../status-definitions/status-definitions.service';
import {
  type WorkflowEntityType,
  isWorkflowEntityType,
} from './workflow.catalog';

export interface WorkflowActionDto {
  transitionId: string;
  label: string;
  labelEn: string | null;
  toStatusCode: string;
  toStatusName: string;
  color: string;
  requiresReason: boolean;
  requiresApproval: boolean;
  isPrimary: boolean;
  businessAction: WorkflowBusinessAction;
}

export interface WorkflowTransitionContext {
  reason?: string;
  convertPayload?: LeadConvertPayload;
}

export interface LeadConvertPayload {
  productId: string;
  quantity: number;
  unitPrice: number;
  paymentType?: 'PREPAID' | 'CASH_ON_DELIVERY';
  paymentSourceId?: string;
  notes?: string;
}

/**
 * Authoritative workflow transition service — every status change for
 * workflow-enabled entities must pass through here. Validates current
 * state, allowed transitions, permissions, approval requirements, and
 * executes protected business actions atomically.
 */
@Injectable()
export class WorkflowEngineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsResolverService,
    private readonly statusDefinitions: StatusDefinitionsService,
    private readonly numberingEngine: NumberingEngineService,
  ) {}

  async getAvailableActions(
    entityType: string,
    entityId: string,
    userId: string,
    isSuperAdmin = false,
  ): Promise<WorkflowActionDto[]> {
    if (!isWorkflowEntityType(entityType)) {
      throw new BadRequestException(
        `Unsupported workflow entity: ${entityType}`,
      );
    }
    const currentStatusId = await this.getCurrentStatusId(entityType, entityId);
    if (!currentStatusId) {
      throw new NotFoundException(`${entityType} ${entityId} not found`);
    }

    const pending = await this.prisma.workflowApproval.findFirst({
      where: {
        entityType,
        entityId,
        status: WorkflowApprovalStatus.PENDING,
      },
    });
    if (pending) return [];

    const transitions = await this.prisma.workflowTransition.findMany({
      where: {
        fromStatusId: currentStatusId,
        isActive: true,
        deletedAt: null,
        toStatus: { deletedAt: null },
      },
      include: { toStatus: true },
      orderBy: [{ sortOrder: 'asc' }, { labelAr: 'asc' }],
    });

    const resolvedSuperAdmin =
      isSuperAdmin || (await this.permissions.isSuperAdmin(userId));
    const userPermissions = resolvedSuperAdmin
      ? null
      : await this.permissions.getPermissions(userId);

    const actions: WorkflowActionDto[] = [];
    for (const t of transitions) {
      if (
        t.requiredPermission &&
        !resolvedSuperAdmin &&
        !userPermissions?.has(t.requiredPermission)
      ) {
        continue;
      }
      actions.push({
        transitionId: t.id,
        label: t.labelAr,
        labelEn: t.labelEn,
        toStatusCode: t.toStatus.code,
        toStatusName: t.toStatus.name,
        color: t.toStatus.color,
        requiresReason: t.requiresReason,
        requiresApproval: t.requiresApproval,
        isPrimary: t.sortOrder === 0,
        businessAction: t.businessAction,
      });
    }
    return actions;
  }

  async executeTransition(
    entityType: string,
    entityId: string,
    transitionId: string,
    userId: string,
    context: WorkflowTransitionContext = {},
    isSuperAdmin = false,
  ) {
    if (!isWorkflowEntityType(entityType)) {
      throw new BadRequestException(
        `Unsupported workflow entity: ${entityType}`,
      );
    }

    const transition = await this.prisma.workflowTransition.findFirst({
      where: { id: transitionId, deletedAt: null, isActive: true },
      include: { fromStatus: true, toStatus: true },
    });
    if (!transition) {
      throw new NotFoundException('Workflow transition not found.');
    }

    const currentStatusId = await this.getCurrentStatusId(entityType, entityId);
    if (!currentStatusId) {
      throw new NotFoundException(`${entityType} ${entityId} not found`);
    }
    if (currentStatusId !== transition.fromStatusId) {
      throw new BadRequestException(
        'Transition is not allowed from the current status.',
      );
    }

    if (transition.requiresReason && !context.reason?.trim()) {
      throw new BadRequestException('This transition requires a reason.');
    }

    if (
      transition.requiredPermission &&
      !isSuperAdmin &&
      !(await this.permissions.hasPermission(
        userId,
        transition.requiredPermission,
      ))
    ) {
      throw new ForbiddenException(
        'Permission denied for this workflow action.',
      );
    }

    if (transition.requiresApproval) {
      return this.requestApproval(
        entityType,
        entityId,
        transition,
        userId,
        context.reason,
      );
    }

    return this.applyTransition(
      entityType,
      entityId,
      transition,
      userId,
      context,
    );
  }

  async approveTransition(approvalId: string, approverId: string) {
    const approval = await this.prisma.workflowApproval.findUnique({
      where: { id: approvalId },
      include: {
        transition: { include: { toStatus: true, fromStatus: true } },
      },
    });
    if (!approval || approval.status !== WorkflowApprovalStatus.PENDING) {
      throw new BadRequestException(
        'Approval request not found or already resolved.',
      );
    }

    if (!isWorkflowEntityType(approval.entityType)) {
      throw new BadRequestException(
        `Unsupported workflow entity: ${approval.entityType}`,
      );
    }

    const currentStatusId = await this.getCurrentStatusId(
      approval.entityType,
      approval.entityId,
    );
    if (currentStatusId !== approval.fromStatusId) {
      throw new BadRequestException(
        'Entity status changed since approval was requested.',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.workflowApproval.update({
        where: { id: approvalId },
        data: {
          status: WorkflowApprovalStatus.APPROVED,
          approvedById: approverId,
          approvedAt: new Date(),
        },
      });
      return this.applyTransition(
        approval.entityType as WorkflowEntityType,
        approval.entityId,
        approval.transition,
        approverId,
        { reason: approval.reason ?? undefined },
        tx,
      );
    });
  }

  async rejectTransition(
    approvalId: string,
    rejectorId: string,
    rejectionReason?: string,
  ) {
    const approval = await this.prisma.workflowApproval.findUnique({
      where: { id: approvalId },
    });
    if (!approval || approval.status !== WorkflowApprovalStatus.PENDING) {
      throw new BadRequestException(
        'Approval request not found or already resolved.',
      );
    }
    return this.prisma.workflowApproval.update({
      where: { id: approvalId },
      data: {
        status: WorkflowApprovalStatus.REJECTED,
        rejectedById: rejectorId,
        rejectedAt: new Date(),
        rejectionReason,
      },
    });
  }

  private async requestApproval(
    entityType: string,
    entityId: string,
    transition: {
      id: string;
      fromStatusId: string;
      toStatusId: string;
    },
    userId: string,
    reason?: string,
  ) {
    const existing = await this.prisma.workflowApproval.findFirst({
      where: {
        entityType,
        entityId,
        status: WorkflowApprovalStatus.PENDING,
      },
    });
    if (existing) {
      throw new BadRequestException(
        'A pending approval already exists for this record.',
      );
    }
    return this.prisma.workflowApproval.create({
      data: {
        entityType,
        entityId,
        transitionId: transition.id,
        fromStatusId: transition.fromStatusId,
        toStatusId: transition.toStatusId,
        requestedById: userId,
        reason,
      },
    });
  }

  private async applyTransition(
    entityType: WorkflowEntityType,
    entityId: string,
    transition: {
      id: string;
      fromStatusId: string;
      toStatusId: string;
      businessAction: WorkflowBusinessAction;
      toStatus: { code: string; name: string };
    },
    actorId: string,
    context: WorkflowTransitionContext,
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx ?? this.prisma;
    const fromStatusId = await this.getCurrentStatusId(
      entityType,
      entityId,
      client,
    );
    if (!fromStatusId || fromStatusId !== transition.fromStatusId) {
      throw new BadRequestException('Invalid current status for transition.');
    }

    const run = async (innerTx: Prisma.TransactionClient) => {
      if (transition.businessAction === WorkflowBusinessAction.LEAD_CONVERT) {
        await this.executeLeadConvert(
          entityId,
          context.convertPayload,
          actorId,
          innerTx,
        );
      }

      await this.setEntityStatus(
        entityType,
        entityId,
        transition.toStatusId,
        innerTx,
      );

      await innerTx.statusHistory.create({
        data: {
          entityType,
          entityId,
          fromStatusId,
          toStatusId: transition.toStatusId,
          transitionId: transition.id,
          changedById: actorId,
          reason: context.reason,
          source: StatusChangeSource.WORKFLOW_ENGINE,
        },
      });

      return this.getEntityWithStatus(entityType, entityId, innerTx);
    };

    if (tx) return run(tx);
    return this.prisma.$transaction(run);
  }

  private async getCurrentStatusId(
    entityType: WorkflowEntityType,
    entityId: string,
    client?: Prisma.TransactionClient,
  ): Promise<string | null> {
    const db = client ?? this.prisma;
    if (entityType === 'LEAD') {
      const lead = await db.lead.findFirst({
        where: { id: entityId, deletedAt: null },
        select: { statusId: true },
      });
      return lead?.statusId ?? null;
    }
    return null;
  }

  private async setEntityStatus(
    entityType: WorkflowEntityType,
    entityId: string,
    statusId: string,
    tx: Prisma.TransactionClient,
  ) {
    if (entityType === 'LEAD') {
      await tx.lead.update({
        where: { id: entityId },
        data: { statusId },
      });
    }
  }

  private async getEntityWithStatus(
    entityType: WorkflowEntityType,
    entityId: string,
    tx: Prisma.TransactionClient,
  ) {
    if (entityType === 'LEAD') {
      return tx.lead.findFirst({
        where: { id: entityId },
        include: { status: true },
      });
    }
    return null;
  }

  /** Atomic Lead → Partner → StoreOrder conversion business action. */
  private async executeLeadConvert(
    leadId: string,
    payload: LeadConvertPayload | undefined,
    userId: string,
    tx: Prisma.TransactionClient,
  ) {
    const lead = await tx.lead.findFirst({
      where: { id: leadId, deletedAt: null },
      include: { storeOrder: { select: { id: true, internalOrderId: true } } },
    });
    if (!lead) throw new NotFoundException('Lead not found');

    // Idempotent: already converted — leave existing StoreOrder in place.
    if (lead.storeOrder) {
      await tx.leadActivity.create({
        data: {
          leadId,
          type: 'LEAD_CONVERT_IDEMPOTENT',
          description: `Conversion retry — existing Store Order ${lead.storeOrder.internalOrderId}`,
          metadata: { storeOrderId: lead.storeOrder.id },
        },
      });
      return;
    }

    const productId = payload?.productId ?? lead.productId;
    if (!productId) {
      throw new BadRequestException(
        'Conversion requires a product on the Lead or in the conversion payload.',
      );
    }

    let unitPrice = payload?.unitPrice;
    if (unitPrice === undefined || unitPrice === null) {
      const product = await tx.product.findFirst({
        where: { id: productId, deletedAt: null },
        select: { salesPrice: true },
      });
      unitPrice = product?.salesPrice ? Number(product.salesPrice) : 0;
    }

    // Resolve or create Partner + CUSTOMER role inside this transaction.
    const partnerId = await this.resolvePartnerForLead(lead, userId, tx);

    await tx.lead.update({
      where: { id: leadId },
      data: { partnerId },
    });

    const { StoreOrderPaymentType, StoreOrderShippingStage, StoreOrderSource } =
      await import('@prisma/client');

    const paymentType =
      payload?.paymentType === 'CASH_ON_DELIVERY'
        ? StoreOrderPaymentType.CASH_ON_DELIVERY
        : StoreOrderPaymentType.PREPAID;
    const shippingStage =
      paymentType === StoreOrderPaymentType.CASH_ON_DELIVERY
        ? StoreOrderShippingStage.READY_FOR_SHIPPING
        : StoreOrderShippingStage.NOT_READY;

    const internalOrderId =
      await this.numberingEngine.generateNumber('STORE_ORDER');

    const storeOrder = await tx.storeOrder.create({
      data: {
        internalOrderId,
        partnerId,
        leadId: lead.id,
        currencyId: lead.currencyId,
        employeeId: lead.salesEmployeeId,
        paymentType,
        shippingStage,
        notes: payload?.notes,
        createdBy: userId,
        updatedBy: userId,
        source: StoreOrderSource.MANUAL,
        items: {
          create: {
            productId,
            quantity: payload?.quantity ?? lead.quantity,
            unitPrice,
          },
        },
      },
    });

    await tx.storeOrderActivity.create({
      data: {
        storeOrderId: storeOrder.id,
        action: 'ORDER_CREATED_FROM_LEAD',
        details: `Created from Lead ${lead.leadNumber}`,
        performedById: userId,
      },
    });

    await tx.leadActivity.create({
      data: {
        leadId,
        type: 'LEAD_CONVERTED_TO_ORDER',
        description: `Converted to Store Order ${storeOrder.internalOrderId}`,
        metadata: { storeOrderId: storeOrder.id, partnerId },
      },
    });
  }

  /**
   * Partner resolution at conversion boundary — never at Lead create.
   * Reuses existing Partner matched by phone; otherwise creates Partner +
   * CUSTOMER role. All writes use the caller's transaction.
   */
  private async resolvePartnerForLead(
    lead: {
      id: string;
      customerName: string;
      mobileNumber: string;
      countryId: string;
      city: string | null;
      address: string | null;
      partnerId: string | null;
    },
    userId: string,
    tx: Prisma.TransactionClient,
  ): Promise<string> {
    const { PartnerRoleType, PartnerSource, PartnerEntityType, PartnerStatus } =
      await import('@prisma/client');

    if (lead.partnerId) {
      const existing = await tx.partner.findFirst({
        where: { id: lead.partnerId, deletedAt: null },
        include: { roles: true, customerProfile: true },
      });
      if (!existing) {
        throw new BadRequestException('Linked Partner was not found.');
      }
      if (!existing.roles.some((r) => r.role === PartnerRoleType.CUSTOMER)) {
        await tx.partnerRoleAssignment.create({
          data: {
            partnerId: existing.id,
            role: PartnerRoleType.CUSTOMER,
            createdBy: userId,
          },
        });
        if (!existing.customerProfile) {
          await tx.customerProfile.create({ data: { partnerId: existing.id } });
        }
      }
      return existing.id;
    }

    const phoneMatch = await tx.partner.findFirst({
      where: {
        deletedAt: null,
        OR: [{ phone: lead.mobileNumber }, { mobile: lead.mobileNumber }],
      },
      include: { roles: true, customerProfile: true },
    });

    if (phoneMatch) {
      if (!phoneMatch.roles.some((r) => r.role === PartnerRoleType.CUSTOMER)) {
        await tx.partnerRoleAssignment.create({
          data: {
            partnerId: phoneMatch.id,
            role: PartnerRoleType.CUSTOMER,
            createdBy: userId,
          },
        });
        if (!phoneMatch.customerProfile) {
          await tx.customerProfile.create({
            data: { partnerId: phoneMatch.id },
          });
        }
      }
      return phoneMatch.id;
    }

    const partnerNumber = await this.numberingEngine.generateNumber('PARTNER');
    const partner = await tx.partner.create({
      data: {
        partnerNumber,
        name: lead.customerName,
        phone: lead.mobileNumber,
        mobile: lead.mobileNumber,
        countryId: lead.countryId,
        city: lead.city,
        address: lead.address,
        entityType: PartnerEntityType.PERSON,
        status: PartnerStatus.ACTIVE,
        source: PartnerSource.LEAD_CONVERSION,
        createdBy: userId,
        updatedBy: userId,
      },
    });
    await tx.partnerRoleAssignment.create({
      data: {
        partnerId: partner.id,
        role: PartnerRoleType.CUSTOMER,
        createdBy: userId,
      },
    });
    await tx.customerProfile.create({ data: { partnerId: partner.id } });
    return partner.id;
  }

  async getStatusHistory(entityType: string, entityId: string) {
    return this.prisma.statusHistory.findMany({
      where: { entityType, entityId },
      include: {
        fromStatus: true,
        toStatus: true,
        changedBy: { select: { id: true, fullName: true } },
        transition: true,
      },
      orderBy: { changedAt: 'desc' },
    });
  }

  async resolveDefaultStatusId(workflowType: WorkflowType) {
    const def = await this.statusDefinitions.findDefault(workflowType);
    if (!def) {
      throw new BadRequestException(
        `No default status configured for workflow ${workflowType}.`,
      );
    }
    return def.id;
  }

  async resolveStatusIdByCode(workflowType: WorkflowType, code: string) {
    const def = await this.statusDefinitions.findByCode(workflowType, code);
    if (!def) {
      throw new BadRequestException(
        `Status ${code} not found for workflow ${workflowType}.`,
      );
    }
    return def.id;
  }

  listTransitions(workflowType?: WorkflowType) {
    return this.prisma.workflowTransition.findMany({
      where: {
        deletedAt: null,
        ...(workflowType ? { workflowType } : {}),
      },
      include: {
        fromStatus: {
          select: { id: true, code: true, name: true, color: true },
        },
        toStatus: {
          select: { id: true, code: true, name: true, color: true },
        },
      },
      orderBy: [{ workflowType: 'asc' }, { sortOrder: 'asc' }],
    });
  }

  async createTransition(
    dto: {
      workflowType: WorkflowType;
      fromStatusId: string;
      toStatusId: string;
      labelAr: string;
      labelEn?: string;
      requiresApproval?: boolean;
      requiresReason?: boolean;
      requiredPermission?: string;
      businessAction?: WorkflowBusinessAction;
      sortOrder?: number;
    },
    userId?: string,
  ) {
    if (
      dto.businessAction &&
      dto.businessAction !== WorkflowBusinessAction.NONE
    ) {
      throw new BadRequestException(
        'Protected business actions cannot be configured from admin UI — seed/system only.',
      );
    }
    return this.prisma.workflowTransition.create({
      data: {
        workflowType: dto.workflowType,
        fromStatusId: dto.fromStatusId,
        toStatusId: dto.toStatusId,
        labelAr: dto.labelAr.trim(),
        labelEn: dto.labelEn?.trim() ?? null,
        requiresApproval: dto.requiresApproval ?? false,
        requiresReason: dto.requiresReason ?? false,
        requiredPermission: dto.requiredPermission ?? null,
        businessAction: WorkflowBusinessAction.NONE,
        isSystemProtected: false,
        sortOrder: dto.sortOrder ?? 0,
        createdBy: userId,
        updatedBy: userId,
      },
      include: { fromStatus: true, toStatus: true },
    });
  }

  async updateTransition(
    id: string,
    dto: {
      labelAr?: string;
      labelEn?: string;
      requiresApproval?: boolean;
      requiresReason?: boolean;
      requiredPermission?: string;
      isActive?: boolean;
      sortOrder?: number;
    },
    userId?: string,
  ) {
    const existing = await this.prisma.workflowTransition.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing)
      throw new NotFoundException('Workflow transition not found.');
    if (existing.isSystemProtected) {
      // Allow activate/label tweaks only — never businessAction changes.
      if (dto.requiresApproval === false && existing.requiresApproval) {
        throw new BadRequestException(
          'Cannot disable approval on a system-protected transition.',
        );
      }
    }
    return this.prisma.workflowTransition.update({
      where: { id },
      data: {
        labelAr: dto.labelAr?.trim(),
        labelEn: dto.labelEn?.trim(),
        requiresApproval: dto.requiresApproval,
        requiresReason: dto.requiresReason,
        requiredPermission: dto.requiredPermission,
        isActive: dto.isActive,
        sortOrder: dto.sortOrder,
        updatedBy: userId,
      },
      include: { fromStatus: true, toStatus: true },
    });
  }

  listPendingApprovals() {
    return this.prisma.workflowApproval.findMany({
      where: { status: WorkflowApprovalStatus.PENDING },
      include: {
        transition: { include: { fromStatus: true, toStatus: true } },
        fromStatus: true,
        toStatus: true,
        requestedBy: { select: { id: true, fullName: true } },
      },
      orderBy: { requestedAt: 'desc' },
    });
  }

  /**
   * Funnel from StatusHistory events — never inferred from current status alone.
   */
  async getLeadFunnel(params: {
    dateFrom?: string;
    dateTo?: string;
    source?: string;
    salesEmployeeId?: string;
  }) {
    const changedAt: Prisma.DateTimeFilter = {};
    if (params.dateFrom) changedAt.gte = new Date(params.dateFrom);
    if (params.dateTo) changedAt.lte = new Date(params.dateTo);

    const history = await this.prisma.statusHistory.findMany({
      where: {
        entityType: 'LEAD',
        ...(Object.keys(changedAt).length ? { changedAt } : {}),
        toStatus: {
          code: {
            in: [
              'NEW',
              'ASSIGNED',
              'CONTACTED',
              'FOLLOW_UP',
              'QUALIFIED',
              'CONVERTED',
              'LOST',
              'DISQUALIFIED',
            ],
          },
        },
      },
      select: {
        entityId: true,
        toStatus: { select: { code: true } },
        changedAt: true,
      },
    });

    const leadFilter: Prisma.LeadWhereInput = {
      id: { in: [...new Set(history.map((h) => h.entityId))] },
      deletedAt: null,
      ...(params.source ? { source: params.source as never } : {}),
      ...(params.salesEmployeeId
        ? { salesEmployeeId: params.salesEmployeeId }
        : {}),
    };
    const leads =
      history.length === 0
        ? []
        : await this.prisma.lead.findMany({
            where: leadFilter,
            select: { id: true },
          });
    const allowed = new Set(leads.map((l) => l.id));

    const counts: Record<string, number> = {};
    const seen = new Set<string>();
    for (const row of history) {
      if (!allowed.has(row.entityId)) continue;
      const key = `${row.entityId}:${row.toStatus.code}`;
      if (seen.has(key)) continue;
      seen.add(key);
      counts[row.toStatus.code] = (counts[row.toStatus.code] ?? 0) + 1;
    }

    return {
      byStatus: counts,
      totalEvents: history.filter((h) => allowed.has(h.entityId)).length,
    };
  }
}
