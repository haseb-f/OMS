import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { LeadAssignmentMethod, Prisma, WorkflowType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingEngineService } from '../numbering/numbering-engine.service';
import {
  LeadActivityService,
  LeadActivityType,
} from './activities/lead-activity.service';
import { LeadDuplicateDetectionService } from './duplicate-detection/lead-duplicate-detection.service';
import { LeadAutoDistributionService } from './distribution/lead-auto-distribution.service';
import { LeadAssignmentsService } from './assignments/lead-assignments.service';
import { CreateLeadDto } from './dto/create-lead.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';
import { FindLeadsQueryDto } from './dto/find-leads-query.dto';
import { BulkAssignLeadsDto } from './dto/bulk-assign-leads.dto';
import { BulkChangeLeadStatusDto } from './dto/bulk-change-lead-status.dto';
import { CreateLeadFollowUpDto } from './dto/create-lead-follow-up.dto';
import type { BulkActionResult } from '../master-data/master-data-crud.service';
import {
  CloseLeadWithoutPurchaseDto,
  ConvertLeadDto,
} from './dto/convert-lead.dto';
import {
  PhoneNumberService,
  phoneErrorMessage,
} from '../common/phone/phone-number.service';
import { WorkflowEngineService } from '../workflow/workflow-engine.service';
import { LeadFollowUpTypesService } from '../lead-follow-up-types/lead-follow-up-types.service';
import {
  SalesScopeService,
  type SalesScope,
} from '../sales-scope/sales-scope.service';
import { findArabicNormalizedIds } from '../common/text/arabic-search.query';

const SEARCH_FIELDS = [
  'leadNumber',
  'customerName',
  'mobileNumber',
  'externalOrderId',
] as const;

/** Arabic-normalized search target — "أحمد محمد صالح" finds "احمد محمد صالح" (`common/text/arabic-search.ts`). */
export const LEAD_NORMALIZED_SEARCH = {
  table: 'leads',
  columns: ['customer_name'],
} as const;

/** List/detail views need these display names — the Customer Master link, in particular, is what the frontend uses for "Existing Customer Found" and Customer Order History. */
const LEAD_INCLUDE = {
  country: { select: { id: true, name: true } },
  currency: { select: { id: true, code: true, name: true } },
  partner: { select: { id: true, partnerNumber: true, name: true } },
  salesEmployee: { select: { id: true, fullName: true, email: true } },
  product: { select: { id: true, name: true, displayName: true, sku: true } },
  status: {
    select: {
      id: true,
      code: true,
      name: true,
      nameEn: true,
      color: true,
      isFinal: true,
    },
  },
  storeOrder: {
    select: { id: true, internalOrderId: true },
  },
  customerClassification: {
    select: {
      id: true,
      code: true,
      name: true,
      nameEn: true,
      color: true,
      isActive: true,
      deletedAt: true,
    },
  },
  noPurchaseReason: {
    select: {
      id: true,
      code: true,
      name: true,
      nameEn: true,
      isActive: true,
      deletedAt: true,
    },
  },
} satisfies Prisma.LeadInclude;

/**
 * Trimmed variant of `LEAD_INCLUDE` for `findAll`/list rows — the grid
 * (`apps/web/src/config/crm/lead-columns.tsx`) never renders `currency`,
 * `partner`, `product`, `storeOrder`, or `noPurchaseReason`; those exist
 * only for the Lead detail page. Same "list vs detail include" split
 * `StoreOrdersService` already uses (`ORDER_LIST_INCLUDE`/`ORDER_INCLUDE`).
 */
const LEAD_LIST_INCLUDE = {
  country: LEAD_INCLUDE.country,
  salesEmployee: LEAD_INCLUDE.salesEmployee,
  status: LEAD_INCLUDE.status,
  customerClassification: LEAD_INCLUDE.customerClassification,
} satisfies Prisma.LeadInclude;

/** Fields imported/entered order data may carry that live on `Payment`/`LeadNote`, not on `Lead` itself — recorded onto the timeline instead of a new table (see `recordImportedOrderDetails`). */
export interface ImportedOrderDetails {
  orderDate?: string;
  paidAmount?: number;
  currencyCode?: string;
  paymentMethodLabel?: string;
  receiptUrls?: string[];
  notes?: string;
}

@Injectable()
export class LeadsService {
  private readonly logger = new Logger(LeadsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly leadActivityService: LeadActivityService,
    private readonly leadDuplicateDetectionService: LeadDuplicateDetectionService,
    private readonly leadAutoDistributionService: LeadAutoDistributionService,
    private readonly leadAssignmentsService: LeadAssignmentsService,
    private readonly numberingEngine: NumberingEngineService,
    private readonly phoneNumberService: PhoneNumberService,
    private readonly workflowEngine: WorkflowEngineService,
    private readonly salesScope: SalesScopeService,
    private readonly leadFollowUpTypesService: LeadFollowUpTypesService,
  ) {}

  /** Resolves `dto.countryId` to its ISO2 code and validates/normalizes `dto.mobileNumber` against it — the country-aware check `@IsPhoneNumber()` on the DTO can't do (it has no access to the sibling `countryId`). Returns the E.164 value every caller should use in place of the raw input. */
  private async normalizeLeadMobile(
    mobileNumber: string,
    countryId: string,
  ): Promise<string> {
    const country = await this.prisma.country.findFirst({
      where: { id: countryId, deletedAt: null },
    });
    if (!country) {
      throw new BadRequestException('Invalid country.');
    }
    const phone = this.phoneNumberService.parse(mobileNumber, country.code);
    if (!phone.isValid || !phone.e164) {
      throw new BadRequestException(phoneErrorMessage(phone.errorReason));
    }
    return phone.e164;
  }

  /** The no-default-configured fallback `resolveDefaultCurrencyId`/`create` share — its own helper only so `create()` can reuse one already-fetched `country` row instead of querying Country twice (mobile normalization + currency default) per Lead. */
  private async resolveFallbackCurrencyId(): Promise<string> {
    const fallback = await this.prisma.currency.findFirst({
      where: { deletedAt: null },
      orderBy: { code: 'asc' },
    });
    if (!fallback) {
      throw new BadRequestException(
        'No currency is configured — add at least one Currency in Master Data before creating Leads.',
      );
    }
    return fallback.id;
  }

  /**
   * `options` is bulk-import-only tuning, additive and opt-in — every
   * existing caller (manual "Create Lead", Lead Convert, etc.) keeps
   * calling `create(dto, userId)` unchanged and gets identical behavior.
   * `defaultStatusId`: the default LEAD workflow status never changes
   * mid-batch, so an importer resolves it once and passes it in instead of
   * `create()` re-querying it on every single row. `skipFullRefetch`: the
   * final `findOne()` re-fetch (7 joined relations) exists so the caller
   * gets a fully-populated Lead back — importers discard `create()`'s
   * return value entirely, so that read is pure waste for them.
   */
  async create(
    dto: CreateLeadDto,
    userId?: string,
    options?: { defaultStatusId?: string; skipFullRefetch?: boolean },
  ) {
    if (dto.recordType === 'ORDER') {
      throw new BadRequestException(
        'Lead-as-Order is retired. Create a Store Order for operational orders, or a Lead for CRM prospects.',
      );
    }

    // One Country fetch reused for both phone-normalization (needs the ISO2
    // code) and the currency default (needs `defaultCurrencyId`) — this was
    // two separate Country queries before, for the exact same countryId.
    const country = await this.prisma.country.findFirst({
      where: { id: dto.countryId, deletedAt: null },
      select: { code: true, defaultCurrencyId: true },
    });
    if (!country) {
      throw new BadRequestException('Invalid country.');
    }
    const phone = this.phoneNumberService.parse(dto.mobileNumber, country.code);
    if (!phone.isValid || !phone.e164) {
      throw new BadRequestException(phoneErrorMessage(phone.errorReason));
    }
    const mobileNumber = phone.e164;

    const duplicateCheck = await this.leadDuplicateDetectionService.check({
      mobileNumber,
      customerName: dto.customerName,
      productId: dto.productId,
    });

    if (duplicateCheck.isExactDuplicate) {
      throw new ConflictException('Duplicate Lead');
    }

    if (dto.externalOrderId) {
      const existingOrder = await this.prisma.lead.findFirst({
        where: { externalOrderId: dto.externalOrderId, deletedAt: null },
      });
      if (existingOrder) {
        throw new ConflictException(
          `Duplicate Lead — an item with External ID "${dto.externalOrderId}" already exists (${existingOrder.leadNumber}).`,
        );
      }
    }

    const quantity = dto.quantity ?? 1;
    const currencyId =
      dto.currencyId ??
      country.defaultCurrencyId ??
      (await this.resolveFallbackCurrencyId());

    if (dto.customerClassificationId) {
      await this.assertClassificationAssignable(
        dto.customerClassificationId,
        null,
      );
    }

    const leadNumber = await this.numberingEngine.generateNumber('LEAD');
    const defaultStatusId =
      options?.defaultStatusId ??
      (await this.workflowEngine.resolveDefaultStatusId(WorkflowType.LEAD));

    const explicitOwnerId = dto.salesEmployeeId;
    const importMethod = dto.importBatch
      ? LeadAssignmentMethod.IMPORT
      : LeadAssignmentMethod.MANUAL;
    const autoPolicy = explicitOwnerId
      ? null
      : await this.leadAutoDistributionService.getEffectivePolicy();
    const distributionHeld = !explicitOwnerId && !autoPolicy;

    if (explicitOwnerId && userId && explicitOwnerId !== userId) {
      const scope = await this.salesScope.resolve(userId);
      this.salesScope.assertCanAssign(scope);
      if (!this.salesScope.canSetOrderOwner(scope, explicitOwnerId)) {
        throw new ForbiddenException(
          'You cannot assign this Lead to that employee.',
        );
      }
    }

    let lead: Prisma.LeadGetPayload<object>;
    try {
      lead = await this.prisma.$transaction(async (tx) => {
        const created = await tx.lead.create({
          data: {
            customerName: dto.customerName,
            mobileNumber,
            countryId: dto.countryId,
            city: dto.city,
            address: dto.address,
            productId: dto.productId,
            quantity,
            currencyId,
            source: dto.source,
            importBatch: dto.importBatch,
            distributionHeld,
            externalOrderId: dto.externalOrderId,
            leadNumber,
            statusId: defaultStatusId,
            possibleDuplicate: duplicateCheck.isPossibleDuplicate,
            customerClassificationId: dto.customerClassificationId,
            createdBy: userId ?? null,
            updatedBy: userId ?? null,
          },
        });
        await this.leadActivityService.log(
          created.id,
          LeadActivityType.LEAD_CREATED,
          `Lead ${created.leadNumber} created`,
          undefined,
          tx,
        );
        return created;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new BadRequestException(
          'Invalid country, currency, product, or sales employee reference.',
        );
      }
      throw error;
    }

    if (explicitOwnerId) {
      await this.leadAssignmentsService.assign(lead.id, {
        salesEmployeeId: explicitOwnerId,
        method: importMethod,
        actorId: userId ?? null,
      });
    } else {
      await this.leadAutoDistributionService.distribute(lead.id);
    }
    return options?.skipFullRefetch ? lead : this.findOne(lead.id);
  }

  /**
   * TASK-061 — records order-level details an import/manual entry carries
   * that don't belong on `Lead` itself (Paid Amount, Payment Method,
   * Receipts, Notes, source Order Date) onto the existing timeline instead
   * of a new table — visible in the Lead's timeline exactly like every
   * other activity entry.
   */
  async recordImportedOrderDetails(
    leadId: string,
    details: ImportedOrderDetails,
  ) {
    const hasAnyDetail = Object.values(details).some(
      (v) => v !== undefined && v !== null && v !== '',
    );
    if (!hasAnyDetail) return;
    await this.leadActivityService.log(
      leadId,
      'ORDER_DETAILS_IMPORTED',
      'Order details recorded from import (payment/receipt information)',
      details as Record<string, unknown>,
    );
  }

  async findAll(query: FindLeadsQueryDto, scope: SalesScope) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where = await this.buildLeadWhere(query, scope);
    const orderBy = this.buildLeadOrderBy(query);

    const [items, total, unassignedCount] = await Promise.all([
      this.prisma.lead.findMany({
        where,
        include: LEAD_LIST_INCLUDE,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy,
      }),
      this.prisma.lead.count({ where }),
      this.prisma.lead.count({
        where: {
          AND: [
            this.salesScope.leadWhere(scope),
            { deletedAt: query.includeArchived ? undefined : null },
            { salesEmployeeId: null },
          ],
        },
      }),
    ]);

    return { items, total, page, pageSize, unassignedCount };
  }

  /**
   * Smart Selection (Bulk Ops) — "select all matching" (`pageSize` omitted,
   * capped at 10,000) and "select first N" (`pageSize: N`) both go through
   * this one bare-id lookup, ordered by the SAME sort the table is
   * currently showing (`buildLeadOrderBy`) so "first 50" is deterministic
   * and matches what the user actually sees, never a random subset.
   */
  async findAllIds(query: FindLeadsQueryDto, scope: SalesScope) {
    const where = await this.buildLeadWhere(query, scope);
    const take = Math.min(query.pageSize ?? 10_000, 10_000);
    const [rows, total] = await Promise.all([
      this.prisma.lead.findMany({
        where,
        select: { id: true },
        orderBy: this.buildLeadOrderBy(query),
        take,
      }),
      this.prisma.lead.count({ where }),
    ]);
    return { ids: rows.map((row) => row.id), total };
  }

  private buildLeadOrderBy(
    query: Pick<FindLeadsQueryDto, 'sortBy' | 'sortOrder'>,
  ): Prisma.LeadOrderByWithRelationInput[] {
    const sortField = query.sortBy || 'createdAt';
    const sortDir = query.sortOrder ?? 'desc';
    return sortField === 'id'
      ? [{ id: sortDir }]
      : [{ [sortField]: sortDir }, { id: 'desc' }];
  }

  async unassignedCount(scope: SalesScope) {
    const count = await this.prisma.lead.count({
      where: {
        AND: [
          this.salesScope.leadWhere(scope),
          { deletedAt: null },
          { salesEmployeeId: null },
        ],
      },
    });
    return { count };
  }

  /** Idempotent import/sync lookup — same External Lead ID = same Lead. */
  async findByExternalOrderId(externalOrderId: string) {
    return this.prisma.lead.findFirst({
      where: { externalOrderId, deletedAt: null },
      include: LEAD_INCLUDE,
    });
  }

  /**
   * Bulk-import idempotency pre-check — one query for every externalOrderId
   * in the batch instead of one `findByExternalOrderId` (full `LEAD_INCLUDE`)
   * call per row. Existence-only (`select: { externalOrderId: true }`), so
   * callers should still go through `create()`'s own authoritative
   * per-row check for the actual create — this is purely the "skip early
   * so it counts as skipped, not errored" fast path.
   */
  async findExistingExternalOrderIds(
    externalOrderIds: string[],
  ): Promise<Set<string>> {
    const uniqueIds = [...new Set(externalOrderIds.filter(Boolean))];
    if (uniqueIds.length === 0) return new Set();
    const rows = await this.prisma.lead.findMany({
      where: { externalOrderId: { in: uniqueIds }, deletedAt: null },
      select: { externalOrderId: true },
    });
    return new Set(
      rows.map((row) => row.externalOrderId).filter((id): id is string => !!id),
    );
  }

  async findOne(id: string, scope?: SalesScope) {
    const lead = await this.prisma.lead.findFirst({
      where: { id, deletedAt: null },
      include: {
        ...LEAD_INCLUDE,
        followUps: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 20,
          include: { user: { select: { id: true, fullName: true } } },
        },
      },
    });
    if (!lead) {
      throw new NotFoundException(`Lead ${id} not found`);
    }
    this.salesScope.assertLeadAccess(
      scope ?? {
        kind: 'ALL',
        ownerIds: null,
        userId: '',
        isSuperAdmin: true,
        canManageLeads: true,
        canViewLeads: true,
        canViewStoreOrders: true,
        canViewShipping: true,
        canEditShipping: true,
        canViewPaymentEvidence: true,
        canManagePaymentEvidence: true,
      },
      lead,
    );
    return lead;
  }

  async update(id: string, dto: UpdateLeadDto, scope: SalesScope) {
    const existing = await this.findOne(id, scope);
    const {
      archivedReason: _archivedReason,
      salesEmployeeId: _salesEmployeeId,
      recordType: _recordType,
      paidAmount: _paidAmount,
      ...data
    } = dto;
    void _archivedReason;
    void _salesEmployeeId;
    void _recordType;
    void _paidAmount;
    delete (data as { noPurchaseReasonId?: string }).noPurchaseReasonId;
    if (dto.mobileNumber !== undefined) {
      data.mobileNumber = await this.normalizeLeadMobile(
        dto.mobileNumber,
        dto.countryId ?? existing.countryId,
      );
    }
    if (dto.customerClassificationId !== undefined) {
      if (dto.customerClassificationId) {
        await this.assertClassificationAssignable(
          dto.customerClassificationId,
          existing.customerClassificationId,
        );
      }
    }

    try {
      return await this.prisma.lead.update({
        where: { id },
        data,
        include: LEAD_INCLUDE,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new BadRequestException(
          'Invalid country, currency, or sales employee reference.',
        );
      }
      throw error;
    }
  }

  async remove(id: string, scope: SalesScope) {
    await this.findOne(id, scope);
    return this.prisma.lead.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async firstOpen(id: string, userId: string, scope: SalesScope) {
    const lead = await this.findOne(id, scope);
    if (lead.salesEmployeeId !== userId) {
      return lead;
    }
    if (lead.firstOpenedAt || lead.status.code !== 'NEW') {
      return lead;
    }

    try {
      await this.workflowEngine.executeTransitionByCodes(
        'LEAD',
        id,
        'NEW',
        'IN_PROGRESS',
        userId,
        {},
        scope.isSuperAdmin,
      );
    } catch (error) {
      this.logger.warn(
        `Lead firstOpen NEW→IN_PROGRESS failed for ${id}: ${
          error instanceof Error ? error.message : error
        }`,
      );
      return this.findOne(id, scope);
    }
    return this.prisma.lead.update({
      where: { id },
      data: { firstOpenedAt: new Date() },
      include: LEAD_INCLUDE,
    });
  }

  /**
   * Follow-up is an activity, not a lifecycle stage — recording one never
   * mutates Lead.status. A Lead can carry unlimited follow-ups while staying
   * IN_PROGRESS; FOLLOW_UP as a status is legacy (kept for history/rollback
   * only, no longer entered from here).
   */
  async addFollowUp(
    id: string,
    dto: CreateLeadFollowUpDto,
    userId: string,
    scope: SalesScope,
  ) {
    await this.findOne(id, scope);
    if (dto.followUpTypeId) {
      await this.leadFollowUpTypesService.assertAssignable(dto.followUpTypeId);
    }
    const followUp = await this.prisma.$transaction(async (tx) => {
      const created = await tx.leadFollowUp.create({
        data: {
          leadId: id,
          userId,
          followUpTypeId: dto.followUpTypeId ?? null,
          outcome: dto.outcome?.trim() || null,
          note: dto.note?.trim() || null,
          followUpAt: dto.followUpAt ? new Date(dto.followUpAt) : null,
          createdBy: userId,
          updatedBy: userId,
        },
      });
      await this.refreshNextFollowUp(id, tx);
      await this.leadActivityService.log(
        id,
        'FOLLOW_UP_ADDED',
        dto.outcome ? `Follow-up: ${dto.outcome}` : 'Follow-up recorded',
        {
          followUpId: created.id,
          outcome: dto.outcome,
          followUpAt: dto.followUpAt,
          followUpTypeId: dto.followUpTypeId,
        },
        tx,
      );
      return created;
    });

    return followUp;
  }

  listFollowUps(leadId: string) {
    return this.prisma.leadFollowUp.findMany({
      where: { leadId, deletedAt: null },
      include: {
        user: { select: { id: true, fullName: true } },
        followUpType: { select: { id: true, name: true, nameEn: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async bulkAssign(
    dto: BulkAssignLeadsDto,
    actorId: string,
    scope: SalesScope,
  ) {
    this.salesScope.assertCanAssign(scope);
    const ids = dto.leadIds?.length
      ? dto.leadIds
      : await this.resolveAssignableLeadIds(dto, scope);
    if (dto.dryRun) {
      return { assigned: 0, ids, preview: true };
    }

    // The target employee and the caller's scope are the same for every
    // lead in the batch — validate both once instead of once per lead
    // (previously: 1 employee-eligibility check + 1 redundant Lead read
    // per item, on top of `assign()`'s own per-item read/write).
    await this.leadAssignmentsService.assertEligibleEmployee(
      dto.salesEmployeeId,
    );
    if (!this.salesScope.canSetOrderOwner(scope, dto.salesEmployeeId)) {
      throw new ForbiddenException(
        'Target employee is outside your assignment scope.',
      );
    }

    const leads = await this.prisma.lead.findMany({
      where: { id: { in: ids }, deletedAt: null },
      select: { id: true, salesEmployeeId: true },
    });
    const leadsById = new Map(leads.map((lead) => [lead.id, lead]));

    for (const leadId of ids) {
      const lead = leadsById.get(leadId) ?? null;
      this.salesScope.assertLeadAccess(scope, lead);
      await this.leadAssignmentsService.assign(leadId, {
        salesEmployeeId: dto.salesEmployeeId,
        method: LeadAssignmentMethod.MANUAL,
        reason: dto.reason,
        actorId,
        scope,
        skipEligibilityCheck: true,
      });
    }
    return { assigned: ids.length, ids };
  }

  /**
   * Smart Selection (Bulk Ops) — bulk status change across a set of Leads
   * that may currently sit in different statuses. Reuses
   * `WorkflowEngineService.executeTransitionByCodes` per lead exactly as
   * the single-Lead `WorkflowActionsPanel` does (never a parallel
   * status-mutation path): each call independently re-checks that lead's
   * own scope, the transition's `requiredPermission`/`requiresApproval`,
   * and the LOST/DISQUALIFIED-needs-a-reason guard, so a mixed-status
   * batch naturally skips whatever isn't a valid FROM→TO transition for
   * that one lead instead of forcing an invalid state. Partial success is
   * expected and reported, never all-or-nothing.
   */
  async bulkChangeStatus(
    dto: BulkChangeLeadStatusDto,
    actorId: string,
    scope: SalesScope,
    isSuperAdmin: boolean,
  ): Promise<BulkActionResult> {
    const leads = await this.prisma.lead.findMany({
      where: { id: { in: dto.leadIds } },
      select: { id: true, deletedAt: true, status: { select: { code: true } } },
    });
    const leadsById = new Map(leads.map((lead) => [lead.id, lead]));

    const succeeded: string[] = [];
    const failed: { id: string; message: string }[] = [];
    for (const leadId of dto.leadIds) {
      const lead = leadsById.get(leadId);
      if (!lead || lead.deletedAt) {
        failed.push({ id: leadId, message: 'Lead not found.' });
        continue;
      }
      try {
        await this.workflowEngine.executeTransitionByCodes(
          'LEAD',
          leadId,
          lead.status.code,
          dto.statusCode,
          actorId,
          { reason: dto.reason },
          isSuperAdmin,
        );
        succeeded.push(leadId);
      } catch (error) {
        failed.push({
          id: leadId,
          message:
            error instanceof Error ? error.message : 'Status change failed.',
        });
      }
    }
    return { succeeded, failed };
  }

  /** Descriptive classification only — never changes workflow status. */
  private async assertClassificationAssignable(
    classificationId: string,
    currentId: string | null,
  ) {
    const row = await this.prisma.customerClassification.findFirst({
      where: { id: classificationId },
    });
    if (!row) {
      throw new BadRequestException('Customer classification not found.');
    }
    const keepingCurrent = currentId === classificationId;
    if (!keepingCurrent && (row.deletedAt || row.isActive === false)) {
      throw new BadRequestException(
        'Archived or inactive Customer Classifications cannot be assigned.',
      );
    }
  }

  async convertToStoreOrder(
    id: string,
    dto: ConvertLeadDto,
    userId: string,
    scope: SalesScope,
  ) {
    await this.findOne(id, scope);
    await this.workflowEngine.convertLead(id, userId, {
      items: dto.items,
      paymentType: dto.paymentType,
      paymentMethodId: dto.paymentMethodId,
      currencyId: dto.currencyId,
      amountPaid: dto.amountPaid,
      paymentReference: dto.paymentReference,
      paymentProofUrl: dto.paymentProofUrl,
      stagingAttachmentIds: dto.stagingAttachmentIds,
      countryId: dto.countryId,
      city: dto.city,
      address: dto.address,
      notes: dto.notes,
    });
    return this.findOne(id, scope);
  }

  async closeWithoutPurchase(
    id: string,
    dto: CloseLeadWithoutPurchaseDto,
    userId: string,
    scope: SalesScope,
  ) {
    const lead = await this.findOne(id, scope);
    if (lead.status.code === 'CONVERTED') {
      throw new BadRequestException(
        'A converted Lead cannot be closed without purchase.',
      );
    }
    if (lead.status.code === 'LOST' || lead.status.code === 'DISQUALIFIED') {
      throw new BadRequestException('Lead is already closed.');
    }
    const reason = await this.prisma.noPurchaseReason.findFirst({
      where: { id: dto.noPurchaseReasonId },
    });
    if (!reason) {
      throw new BadRequestException('No purchase reason not found.');
    }
    if (reason.deletedAt || reason.isActive === false) {
      throw new BadRequestException(
        'Archived or inactive No Purchase Reasons cannot be used.',
      );
    }

    await this.prisma.lead.update({
      where: { id },
      data: {
        noPurchaseReasonId: reason.id,
        closeNotes: dto.notes?.trim() || null,
        archivedReason: reason.name,
      },
    });

    const toCode = lead.status.code === 'NEW' ? 'DISQUALIFIED' : 'LOST';
    try {
      await this.workflowEngine.executeTransitionByCodes(
        'LEAD',
        id,
        lead.status.code,
        toCode,
        userId,
        { reason: reason.name, noPurchaseReasonId: reason.id },
      );
    } catch {
      await this.workflowEngine.executeTransitionByCodes(
        'LEAD',
        id,
        lead.status.code,
        toCode === 'LOST' ? 'DISQUALIFIED' : 'LOST',
        userId,
        { reason: reason.name, noPurchaseReasonId: reason.id },
      );
    }
    await this.leadActivityService.log(
      id,
      LeadActivityType.ARCHIVED,
      `Closed without purchase — ${reason.name}`,
      { noPurchaseReasonId: reason.id, notes: dto.notes ?? null },
    );
    return this.findOne(id, scope);
  }

  markQualifiedFromPayment(): Promise<never> {
    throw new BadRequestException(
      'Payment belongs to Store Order, not Lead. Use Store Order payment reporting.',
    );
  }

  convertToCustomer(): Promise<never> {
    throw new BadRequestException(
      'Use Lead conversion (LEAD_CONVERT) — Partner is created with the Store Order, not alone.',
    );
  }

  private async buildLeadWhere(
    query: FindLeadsQueryDto,
    scope: SalesScope,
  ): Promise<Prisma.LeadWhereInput> {
    const parts: Prisma.LeadWhereInput[] = [this.salesScope.leadWhere(scope)];
    if (!query.includeArchived) parts.push({ deletedAt: null });
    if (query.ids?.length) parts.push({ id: { in: query.ids } });
    if (query.partnerId) parts.push({ partnerId: query.partnerId });
    if (query.countryId) parts.push({ countryId: query.countryId });
    if (query.source) parts.push({ source: query.source });
    if (query.unassigned) parts.push({ salesEmployeeId: null });
    else if (query.salesEmployeeId) {
      parts.push({ salesEmployeeId: query.salesEmployeeId });
    }
    if (query.statusCode) {
      parts.push({ status: { code: query.statusCode } });
    }
    if (query.teamId) {
      const team = await this.prisma.salesTeam.findFirst({
        where: { id: query.teamId, deletedAt: null },
        select: {
          managerId: true,
          members: { select: { userId: true } },
        },
      });
      if (team) {
        parts.push({
          salesEmployeeId: {
            in: [team.managerId, ...team.members.map((m) => m.userId)],
          },
        });
      }
    }
    if (query.classificationIds?.length) {
      parts.push({
        customerClassificationId: { in: query.classificationIds },
      });
    }
    const lifecycle = query.lifecycle ?? 'active';
    if (lifecycle === 'active') {
      parts.push({
        status: { code: { notIn: ['CONVERTED', 'LOST', 'DISQUALIFIED'] } },
      });
    } else if (lifecycle === 'converted') {
      parts.push({ status: { code: 'CONVERTED' } });
    } else if (lifecycle === 'closed') {
      parts.push({ status: { code: { in: ['LOST', 'DISQUALIFIED'] } } });
    }
    if (query.dateFrom || query.dateTo) {
      parts.push({
        createdAt: {
          ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
          ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
        },
      });
    }
    if (query.search) {
      const or: Prisma.LeadWhereInput[] = SEARCH_FIELDS.map((field) => ({
        [field]: { contains: query.search, mode: 'insensitive' as const },
      }));
      // Extra OR branch only — scope/filters above still AND-constrain it.
      const normalizedIds = await findArabicNormalizedIds(
        this.prisma,
        LEAD_NORMALIZED_SEARCH,
        query.search,
      );
      if (normalizedIds?.length) or.push({ id: { in: normalizedIds } });
      parts.push({ OR: or });
    }
    if (query.followUpFilter) {
      const now = new Date();
      const startToday = new Date(now);
      startToday.setHours(0, 0, 0, 0);
      const startTomorrow = new Date(startToday);
      startTomorrow.setDate(startTomorrow.getDate() + 1);
      if (query.followUpFilter === 'today') {
        parts.push({ nextFollowUpAt: { gte: startToday, lt: startTomorrow } });
      } else if (query.followUpFilter === 'overdue') {
        // Matches the table cell's own bucketing (lead-columns.tsx): "today"
        // wins even if its time-of-day has already passed, so overdue means
        // strictly before today, not merely before the current instant.
        parts.push({ nextFollowUpAt: { lt: startToday } });
      } else if (query.followUpFilter === 'upcoming') {
        parts.push({ nextFollowUpAt: { gte: startTomorrow } });
      } else if (query.followUpFilter === 'none') {
        parts.push({ nextFollowUpAt: null });
      }
    }
    return { AND: parts };
  }

  private async resolveAssignableLeadIds(
    dto: BulkAssignLeadsDto,
    scope: SalesScope,
  ): Promise<string[]> {
    if (!dto.count) {
      throw new BadRequestException(
        'Provide leadIds or a positive count for Custom N assignment.',
      );
    }
    const where = await this.buildLeadWhere(
      {
        unassigned: dto.unassignedOnly !== false,
        countryId: dto.countryId,
        statusCode: dto.statusCode,
        source: dto.source,
        search: dto.search,
        page: 1,
        pageSize: dto.count,
      },
      scope,
    );
    const rows = await this.prisma.lead.findMany({
      where,
      select: { id: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: dto.count,
    });
    return rows.map((row) => row.id);
  }

  private async refreshNextFollowUp(
    leadId: string,
    tx: Prisma.TransactionClient,
  ) {
    const next = await tx.leadFollowUp.findFirst({
      where: {
        leadId,
        deletedAt: null,
        completedAt: null,
        followUpAt: { not: null },
      },
      orderBy: { followUpAt: 'asc' },
      select: { followUpAt: true },
    });
    await tx.lead.update({
      where: { id: leadId },
      data: { nextFollowUpAt: next?.followUpAt ?? null },
    });
  }
}
