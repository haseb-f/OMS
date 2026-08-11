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
import {
  PhoneNumberService,
  phoneErrorMessage,
} from '../common/phone/phone-number.service';

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
  product: { select: { id: true, name: true, displayName: true, sku: true } },
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
    private readonly phoneNumberService: PhoneNumberService,
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
  /**
   * Order mode's extra requirements — address/product/paid amount — depend
   * on more than one field together, so this lives in the service, not as
   * DTO decorators (which only ever see one field at a time).
   */
  private assertOrderReady(dto: CreateLeadDto): void {
    const missing: { field: string; constraints: string[] }[] = [];
    if (!dto.address)
      missing.push({ field: 'address', constraints: ['required_for_order'] });
    if (!dto.productId)
      missing.push({ field: 'productId', constraints: ['required_for_order'] });
    if (dto.paidAmount === undefined || dto.paidAmount === null) {
      missing.push({
        field: 'paidAmount',
        constraints: ['required_for_order'],
      });
    }
    if (missing.length > 0) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Order is missing fields required to save as an Order.',
        fields: missing,
      });
    }
  }

  /** Order mode omits currencyId — resolved from the selected country's `defaultCurrencyId`, falling back to the system's first active currency. */
  private async resolveDefaultCurrencyId(countryId: string): Promise<string> {
    const country = await this.prisma.country.findFirst({
      where: { id: countryId, deletedAt: null },
      select: { defaultCurrencyId: true },
    });
    if (country?.defaultCurrencyId) return country.defaultCurrencyId;
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

  /** Order mode's PaymentSource/ReceivingAccount — the row flagged `isDefault`, else the first active one — so the user only ever types the Paid Amount. */
  private async resolvePaymentDefault<
    T extends { id: string; isDefault: boolean; isActive: boolean },
  >(
    delegate: { findMany: (args: object) => Promise<T[]> },
    overrideId: string | undefined,
    orderBy: object,
  ): Promise<string> {
    if (overrideId) return overrideId;
    const candidates = await delegate.findMany({
      where: { deletedAt: null, isActive: true },
      orderBy: [{ isDefault: 'desc' }, orderBy],
      take: 1,
    });
    if (!candidates[0]) {
      throw new BadRequestException(
        'No active Payment Source/Receiving Account is configured — add at least one before saving an Order with a Paid Amount.',
      );
    }
    return candidates[0].id;
  }

  async create(dto: CreateLeadDto, userId?: string) {
    const recordType = dto.recordType ?? 'LEAD';
    if (recordType === 'ORDER') {
      this.assertOrderReady(dto);
    }

    const mobileNumber = await this.normalizeLeadMobile(
      dto.mobileNumber,
      dto.countryId,
    );

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
          `Duplicate Order — an order with External Order ID "${dto.externalOrderId}" already exists (${existingOrder.leadNumber}).`,
        );
      }
    }

    const { customer, created: customerCreated } =
      await this.customersService.findOrCreate(
        {
          name: dto.customerName,
          phone: mobileNumber,
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

    const quantity = dto.quantity ?? 1;
    const currencyId =
      dto.currencyId ?? (await this.resolveDefaultCurrencyId(dto.countryId));

    // Minted before the transaction, same trade-off as leadNumber below — a
    // rollback leaves a gap in the sequence, which is fine. Only minted for
    // Order mode with a Paid Amount, since that's the only case a Payment
    // gets created at all.
    const shouldCreatePayment =
      recordType === 'ORDER' &&
      dto.paidAmount !== undefined &&
      dto.paidAmount !== null;
    const [leadNumber, paymentNumber, paymentSourceId, receivingAccountId] =
      await Promise.all([
        this.numberingEngine.generateNumber('LEAD'),
        shouldCreatePayment
          ? this.numberingEngine.generateNumber('PAYMENT')
          : Promise.resolve(null),
        shouldCreatePayment
          ? this.resolvePaymentDefault(
              this.prisma.paymentSource,
              dto.paymentSourceId,
              { name: 'asc' as const },
            )
          : Promise.resolve(null),
        shouldCreatePayment
          ? this.resolvePaymentDefault(
              this.prisma.receivingAccount,
              dto.receivingAccountId,
              { name: 'asc' as const },
            )
          : Promise.resolve(null),
      ]);

    let lead: Prisma.LeadGetPayload<object>;
    try {
      lead = await this.prisma.$transaction(async (tx) => {
        const {
          recordType: _recordType,
          paidAmount: _paidAmount,
          paymentSourceId: _paymentSourceId,
          receivingAccountId: _receivingAccountId,
          ...leadFields
        } = dto;
        void _recordType;
        void _paidAmount;
        void _paymentSourceId;
        void _receivingAccountId;
        const created = await tx.lead.create({
          data: {
            ...leadFields,
            mobileNumber,
            leadNumber,
            quantity,
            currencyId,
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

        // Order mode with a Paid Amount — create the linked Payment in the
        // same transaction (Lead and its Payment either both exist or
        // neither does), reusing PaymentsService's own field shape without
        // calling PaymentsService itself (it depends on LeadsService, so
        // injecting it back here would be a circular module dependency).
        if (
          shouldCreatePayment &&
          paymentNumber &&
          paymentSourceId &&
          receivingAccountId
        ) {
          const payment = await tx.payment.create({
            data: {
              paymentNumber,
              leadId: created.id,
              paymentDate: new Date(),
              amount: dto.paidAmount!,
              currencyId,
              paymentSourceId,
              receivingAccountId,
              senderName: dto.customerName,
              status: 'PENDING',
            },
          });
          await tx.paymentActivity.create({
            data: {
              paymentId: payment.id,
              type: 'PAYMENT_CREATED',
              description: `Payment ${payment.paymentNumber} created from Order ${created.leadNumber}`,
              metadata: { leadId: created.id },
            },
          });
        }

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

    const data = { ...dto };
    if (dto.mobileNumber !== undefined) {
      data.mobileNumber = await this.normalizeLeadMobile(
        dto.mobileNumber,
        dto.countryId ?? existing.countryId,
      );
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const updated = await tx.lead.update({ where: { id }, data });
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
        city: lead.city ?? undefined,
        address: lead.address ?? undefined,
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
