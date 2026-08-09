import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CustomerSource, LeadStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingEngineService } from '../numbering/numbering-engine.service';
import {
  LeadActivityService,
  LeadActivityType,
} from './activities/lead-activity.service';
import { LeadDuplicateDetectionService } from './duplicate-detection/lead-duplicate-detection.service';
import { LeadAutoDistributionService } from './distribution/lead-auto-distribution.service';
import { CustomersService } from '../customers/customers.service';
import { CreateLeadDto } from './dto/create-lead.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';
import { ArchiveLeadDto } from './dto/archive-lead.dto';
import { MasterDataQueryDto } from '../master-data/dto/master-data-query.dto';

const SEARCH_FIELDS = [
  'leadNumber',
  'customerName',
  'mobileNumber',
  'externalOrderId',
] as const;

/** List/detail views need these display names — the Customer Master link, in particular, is what the frontend uses for "Existing Customer Found" and Customer Order History. */
const LEAD_INCLUDE = {
  country: { select: { id: true, name: true } },
  currency: { select: { id: true, code: true, name: true } },
  customer: { select: { id: true, customerNumber: true, name: true } },
  salesEmployee: { select: { id: true, fullName: true, email: true } },
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly leadActivityService: LeadActivityService,
    private readonly leadDuplicateDetectionService: LeadDuplicateDetectionService,
    private readonly leadAutoDistributionService: LeadAutoDistributionService,
    private readonly numberingEngine: NumberingEngineService,
    private readonly customersService: CustomersService,
  ) {}

  private async transitionStatus(
    id: string,
    status: LeadStatus,
    activityType: string,
    description: string,
    extraData: Prisma.LeadUpdateInput = {},
  ) {
    const existing = await this.findOne(id);
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.lead.update({
        where: { id },
        data: { status, ...extraData },
      });
      await this.leadActivityService.log(
        id,
        activityType,
        description,
        { previousStatus: existing.status, newStatus: status },
        tx,
      );
      return updated;
    });
  }

  /**
   * TASK-061 — Customer must be a MASTER RECORD, linked to every one of
   * their orders from the moment the order exists (never only after it's
   * marked PAID). Every Lead creation now:
   *  1. Rejects an exact-duplicate Lead (unchanged).
   *  2. Rejects a duplicate Order (same `externalOrderId` as an existing,
   *     non-deleted Lead) — never creates a second order for the same
   *     source-system order.
   *  3. Reuses an existing Customer by normalized phone if one matches
   *     (`CustomersService.findOrCreate`), otherwise creates one — never
   *     duplicates the Customer. If the reused Customer's own name/city/
   *     address differs from what this order carries, that's flagged on the
   *     Lead's timeline for manual review; the Customer record itself is
   *     never silently overwritten.
   * `convertToCustomer()` (TASK-037) stays in place and is now always a
   * no-op for a Lead created through this path (customerId is already set),
   * but remains correct for any Lead created before this change.
   */
  async create(dto: CreateLeadDto, userId?: string) {
    const duplicateCheck = await this.leadDuplicateDetectionService.check({
      mobileNumber: dto.mobileNumber,
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
          `Duplicate Order — an order with External Order ID "${dto.externalOrderId}" already exists (${existingOrder.leadNumber}).`,
        );
      }
    }

    const { customer, created: customerCreated } =
      await this.customersService.findOrCreate(
        {
          name: dto.customerName,
          phone: dto.mobileNumber,
          countryId: dto.countryId,
          city: dto.city,
          address: dto.address,
          source: CustomerSource.LEAD_CONVERSION,
        },
        userId,
      );
    const dataMismatches = customerCreated
      ? []
      : this.detectCustomerDataMismatch(customer, dto);

    const leadNumber = await this.numberingEngine.generateNumber('LEAD');
    let lead: Prisma.LeadGetPayload<object>;
    try {
      lead = await this.prisma.$transaction(async (tx) => {
        const created = await tx.lead.create({
          data: {
            ...dto,
            leadNumber,
            status: LeadStatus.NEW,
            possibleDuplicate: duplicateCheck.isPossibleDuplicate,
            customerId: customer.id,
          },
        });
        await this.leadActivityService.log(
          created.id,
          LeadActivityType.LEAD_CREATED,
          `Lead ${created.leadNumber} created`,
          undefined,
          tx,
        );
        await this.leadActivityService.log(
          created.id,
          customerCreated
            ? 'CUSTOMER_CREATED_FROM_LEAD'
            : 'CUSTOMER_LINKED_FROM_LEAD',
          customerCreated
            ? `New Customer ${customer.customerNumber} created for this order`
            : `Linked to existing Customer ${customer.customerNumber} (matched by phone)`,
          { customerId: customer.id },
          tx,
        );
        if (dataMismatches.length > 0) {
          await this.leadActivityService.log(
            created.id,
            'CUSTOMER_DATA_MISMATCH_FLAGGED',
            `Imported data differs from the existing customer record on: ${dataMismatches.join(', ')}. The customer record was not changed — review and update it manually if needed.`,
            { fields: dataMismatches },
            tx,
          );
        }
        return created;
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

    // Auto Assignment (TASK-061 §5) — runs after the Lead exists so it can be
    // assigned via the same LeadAssignmentsService.assign() every manual
    // assignment uses; a caller-supplied salesEmployeeId is always preserved
    // (this only fires when none was given).
    if (!lead.salesEmployeeId) {
      await this.leadAutoDistributionService.distribute(lead.id);
    }
    return lead;
  }

  /** "Prevent duplicate customers... never silently overwrite" — compares only the fields this order actually carries against the existing Customer record. */
  private detectCustomerDataMismatch(
    customer: { name: string; city: string | null; address: string | null },
    dto: CreateLeadDto,
  ): string[] {
    const mismatches: string[] = [];
    const differs = (
      a: string | null | undefined,
      b: string | null | undefined,
    ) => !!a && !!b && a.trim().toLowerCase() !== b.trim().toLowerCase();
    if (differs(customer.name, dto.customerName)) mismatches.push('name');
    if (differs(customer.city, dto.city)) mismatches.push('city');
    if (differs(customer.address, dto.address)) mismatches.push('address');
    return mismatches;
  }

  /**
   * TASK-061 — records order-level details an import/manual entry carries
   * that don't belong on `Lead` itself (Paid Amount, Payment Method,
   * Receipts, Notes, source Order Date) onto the existing timeline instead
   * of a new table — visible in the Lead's/Customer's order history exactly
   * like every other activity entry.
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

  /**
   * TASK-061 §7 — Customer Service sees only their assigned Leads/Orders by
   * default; authorized managers (resolved by the controller via
   * `crm.leads.manage`) see everything. `restrictToSalesEmployeeId` unset
   * means "no restriction," never "restrict to nothing." Same
   * search/page/sort/includeArchived shape every other list endpoint in OMS
   * uses (`MasterDataQueryDto`) — Lead isn't a `MasterDataCrudService`
   * subclass (its `create()` has its own duplicate/Customer-Master/Auto
   * Assignment logic, and its timeline is `LeadActivity`, not the shared
   * Master Data activity log), but the list response shape stays identical
   * so the same frontend table/pagination component works unchanged.
   */
  async findAll(
    query: MasterDataQueryDto,
    restrictToSalesEmployeeId?: string,
    customerId?: string,
  ) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.LeadWhereInput = {
      deletedAt: query.includeArchived ? undefined : null,
      ...(restrictToSalesEmployeeId
        ? { salesEmployeeId: restrictToSalesEmployeeId }
        : {}),
      ...(customerId ? { customerId } : {}),
      ...(query.search
        ? {
            OR: SEARCH_FIELDS.map((field) => ({
              [field]: { contains: query.search, mode: 'insensitive' as const },
            })),
          }
        : {}),
    };
    const orderBy = {
      [query.sortBy || 'createdAt']: query.sortOrder ?? 'desc',
    };

    const [items, total] = await Promise.all([
      this.prisma.lead.findMany({
        where,
        include: LEAD_INCLUDE,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy,
      }),
      this.prisma.lead.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  async findOne(id: string) {
    const lead = await this.prisma.lead.findFirst({
      where: { id, deletedAt: null },
      include: LEAD_INCLUDE,
    });
    if (!lead) {
      throw new NotFoundException(`Lead ${id} not found`);
    }
    return lead;
  }

  async update(id: string, dto: UpdateLeadDto) {
    const existing = await this.findOne(id);
    const statusChanged =
      dto.status !== undefined && dto.status !== existing.status;

    try {
      return await this.prisma.$transaction(async (tx) => {
        const updated = await tx.lead.update({ where: { id }, data: dto });
        if (statusChanged) {
          await this.leadActivityService.log(
            id,
            LeadActivityType.LEAD_STATUS_CHANGED,
            `Lead status changed from ${existing.status} to ${updated.status}`,
            { from: existing.status, to: updated.status },
            tx,
          );
        }
        return updated;
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

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.lead.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  /** Business operation: change status to UNDER_FOLLOW_UP. */
  startFollowUp(id: string) {
    return this.transitionStatus(
      id,
      LeadStatus.UNDER_FOLLOW_UP,
      LeadActivityType.FOLLOW_UP_STARTED,
      'Follow-up Started',
    );
  }

  /** Business operation: change status to PAID. The Orders module continues the workflow from here. */
  markPaid(id: string) {
    return this.transitionStatus(
      id,
      LeadStatus.PAID,
      LeadActivityType.MARKED_PAID,
      'Marked Paid',
    );
  }

  /** Business operation: change status to ARCHIVED. Archive reason is optional. */
  archive(id: string, dto: ArchiveLeadDto) {
    return this.transitionStatus(
      id,
      LeadStatus.ARCHIVED,
      LeadActivityType.ARCHIVED,
      'Archived',
      {
        archivedReason: dto.archiveReason ?? null,
      },
    );
  }

  /**
   * Sales Foundation (TASK-037) business operation: converts this Lead into
   * a Customer — reusing an existing Customer if one already matches this
   * lead's mobile number (never duplicating), otherwise creating a new one
   * from the Lead's own snapshot fields. Idempotent: a Lead already linked
   * to a Customer just returns that same link again rather than creating a
   * second one.
   */
  async convertToCustomer(id: string, userId?: string) {
    const lead = await this.findOne(id);
    if (lead.customerId) {
      const customer = await this.customersService.findOne(lead.customerId);
      return { lead, customer, created: false };
    }

    const { customer, created } = await this.customersService.findOrCreate(
      {
        name: lead.customerName,
        phone: lead.mobileNumber,
        countryId: lead.countryId,
        city: lead.city,
        address: lead.address,
        source: CustomerSource.LEAD_CONVERSION,
      },
      userId,
    );

    const updatedLead = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.lead.update({
        where: { id },
        data: { customerId: customer.id },
      });
      await this.leadActivityService.log(
        id,
        created ? 'CUSTOMER_CREATED_FROM_LEAD' : 'CUSTOMER_LINKED_FROM_LEAD',
        created
          ? `Converted to new Customer ${customer.customerNumber}`
          : `Linked to existing Customer ${customer.customerNumber}`,
        { customerId: customer.id },
        tx,
      );
      return updated;
    });

    return { lead: updatedLead, customer, created };
  }
}
