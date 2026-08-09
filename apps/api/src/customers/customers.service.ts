import { BadRequestException, Injectable } from '@nestjs/common';
import {
  CustomerSource,
  CustomerStatus,
  FinancialTransactionStatus,
  Prisma,
  SalesDocumentStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { normalizePhone } from '../common/phone.util';
import { MasterDataActivityLogService } from '../master-data/master-data-activity-log.service';
import {
  MasterDataCrudService,
  MasterDataDelegate,
  MasterDataListResult,
} from '../master-data/master-data-crud.service';
import { MasterDataQueryDto } from '../master-data/dto/master-data-query.dto';
import { NumberingEngineService } from '../numbering/numbering-engine.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { FindOrCreateCustomerDto } from './dto/find-or-create-customer.dto';

const DOCUMENT_TYPE = 'CUSTOMER';
const BALANCE_STATUSES: SalesDocumentStatus[] = [
  SalesDocumentStatus.CONFIRMED,
  SalesDocumentStatus.CLOSED,
];

type CustomerWithBalance<T> = T & { balance: number };

@Injectable()
export class CustomersService extends MasterDataCrudService<
  Prisma.CustomerGetPayload<object>
> {
  protected readonly entityType = DOCUMENT_TYPE;
  protected readonly entityLabel = 'Customer';
  protected readonly searchFields = [
    'customerNumber',
    'name',
    'commercialName',
    'phone',
    'email',
  ];

  constructor(
    prisma: PrismaService,
    activityLog: MasterDataActivityLogService,
    private readonly numberingEngine: NumberingEngineService,
  ) {
    super(prisma, activityLog);
  }

  protected get delegate(): MasterDataDelegate<
    Prisma.CustomerGetPayload<object>
  > {
    return this.prisma.customer as unknown as MasterDataDelegate<
      Prisma.CustomerGetPayload<object>
    >;
  }

  /** Customer Number is never typed by hand — minted the same way Warehouse.code is. */
  async create(dto: CreateCustomerDto, userId?: string) {
    await this.assertNoDuplicate([dto.phone, dto.mobile], dto.email);
    const customerNumber =
      await this.numberingEngine.generateNumber(DOCUMENT_TYPE);
    return super.create(
      { ...dto, customerNumber, source: dto.source ?? CustomerSource.MANUAL },
      userId,
    );
  }

  async update(id: string, dto: UpdateCustomerDto, userId?: string) {
    if (dto.phone || dto.mobile || dto.email) {
      await this.assertNoDuplicate([dto.phone, dto.mobile], dto.email, id);
    }
    return super.update(id, dto, userId);
  }

  /**
   * Read-only lookup for the Customer Master matching rule ("search existing
   * customers by normalized phone") — used by the Leads/Orders form and
   * Import Center preview to show "Existing Customer Found" before anything
   * is written. Never creates or modifies a record.
   */
  async lookupByPhone(phone: string) {
    return this.findDuplicate([phone]);
  }

  /** List needs each row's computed receivables balance for the "Current Balance" column. */
  async findAll(
    query: MasterDataQueryDto,
  ): Promise<
    MasterDataListResult<CustomerWithBalance<Prisma.CustomerGetPayload<object>>>
  > {
    const result = await super.findAll(
      query,
      {},
      {
        include: { customerGroup: true, paymentTerm: true, country: true },
      },
    );
    return { ...result, items: await this.attachBalances(result.items) };
  }

  async findOne(id: string) {
    const customer = await super.findOne(id);
    const [withBalance] = await this.attachBalances([customer]);
    return withBalance;
  }

  /**
   * Never duplicates a Customer: looks up an existing, non-archived record
   * by phone OR email first (whichever is supplied) and reuses it as-is if
   * found; only creates a new Customer when neither matches. Used by the
   * Lead "Convert to Customer" action, the Customer Picker's Quick Create,
   * and available directly for future integrations (Website/Salla/API/
   * Google Sheets) that need the same dedup guarantee.
   */
  async findOrCreate(dto: FindOrCreateCustomerDto, userId?: string) {
    const existing = await this.findDuplicate(
      [dto.phone, dto.mobile],
      dto.email,
    );
    if (existing) {
      return { customer: existing, created: false };
    }
    const customer = await this.create(dto, userId);
    return { customer, created: true };
  }

  /** Reused by every Sales document service — "no inactive customers" is enforced once here. */
  async assertActiveCustomer(customerId: string) {
    const customer = await super.findOne(customerId);
    if (customer.status !== CustomerStatus.ACTIVE) {
      throw new BadRequestException('Customer is inactive.');
    }
    return customer;
  }

  /** "Prevent duplicate customers by Phone or Email. Allow duplicate names only." */
  private async assertNoDuplicate(
    phones: (string | undefined | null)[],
    email?: string,
    excludingId?: string,
  ) {
    const existing = await this.findDuplicate(phones, email, excludingId);
    if (existing) {
      const normalizedInputs = new Set(
        phones.map((p) => normalizePhone(p)).filter((p): p is string => !!p),
      );
      const field =
        normalizedInputs.has(normalizePhone(existing.phone) ?? '') ||
        normalizedInputs.has(normalizePhone(existing.mobile) ?? '')
          ? 'phone number'
          : 'email';
      throw new BadRequestException(
        `A customer with this ${field} already exists (${existing.customerNumber} — ${existing.name}).`,
      );
    }
  }

  /**
   * Customer Master matching (TASK-061): phone comparison is always done on
   * the normalized (E.164, or digits-only fallback) form, never an exact
   * string match — "+966 50 123 4567", "00966501234567", and
   * "+966501234567" must all resolve to the same Customer. Checks the
   * candidate phone(s) against both `Customer.phone` and `Customer.mobile`,
   * since either column may hold the number a Lead/import knows the
   * customer by.
   */
  private async findDuplicate(
    phones: (string | undefined | null)[],
    email?: string,
    excludingId?: string,
  ) {
    const normalizedPhones = [
      ...new Set(
        phones.map((p) => normalizePhone(p)).filter((p): p is string => !!p),
      ),
    ];

    if (normalizedPhones.length > 0) {
      const candidates = await this.prisma.customer.findMany({
        where: {
          deletedAt: null,
          OR: [{ phone: { not: null } }, { mobile: { not: null } }],
          ...(excludingId ? { id: { not: excludingId } } : {}),
        },
      });
      const phoneMatch = candidates.find((c) => {
        const candidatePhones = [
          normalizePhone(c.phone),
          normalizePhone(c.mobile),
        ];
        return candidatePhones.some(
          (p) => p !== null && normalizedPhones.includes(p),
        );
      });
      if (phoneMatch) return phoneMatch;
    }

    if (email) {
      const emailMatch = await this.prisma.customer.findFirst({
        where: {
          deletedAt: null,
          email,
          ...(excludingId ? { id: { not: excludingId } } : {}),
        },
      });
      if (emailMatch) return emailMatch;
    }

    return null;
  }

  /**
   * Balance = confirmed/closed Sales Invoices minus confirmed/closed Sales
   * Returns minus CONFIRMED Customer Receipt allocations for that customer
   * (TASK-052 — this used to stop at Invoices minus Returns; the Matching
   * Engine's allocations, `computeInvoicePaymentSummary`'s own source of
   * truth, existed but this rollup never netted them out, so a fully-paid
   * customer still showed a full outstanding balance). Batched: grouped
   * aggregates + one allocation join per page, never N+1.
   */
  private async attachBalances<T extends { id: string }>(
    customers: T[],
  ): Promise<CustomerWithBalance<T>[]> {
    if (customers.length === 0) return [];
    const ids = customers.map((c) => c.id);

    const [invoiceSums, returnSums, allocations] = await Promise.all([
      this.prisma.salesInvoice.groupBy({
        by: ['customerId'],
        where: { customerId: { in: ids }, status: { in: BALANCE_STATUSES } },
        _sum: { grandTotal: true },
      }),
      this.prisma.salesReturn.groupBy({
        by: ['customerId'],
        where: { customerId: { in: ids }, status: { in: BALANCE_STATUSES } },
        _sum: { grandTotal: true },
      }),
      this.prisma.financialTransactionAllocation.findMany({
        where: {
          transaction: { status: FinancialTransactionStatus.CONFIRMED },
          salesInvoice: { customerId: { in: ids } },
        },
        select: {
          allocatedAmount: true,
          salesInvoice: { select: { customerId: true } },
        },
      }),
    ]);
    const invoicedByCustomer = new Map(
      invoiceSums.map((row) => [
        row.customerId,
        Number(row._sum.grandTotal ?? 0),
      ]),
    );
    const returnedByCustomer = new Map(
      returnSums.map((row) => [
        row.customerId,
        Number(row._sum.grandTotal ?? 0),
      ]),
    );
    const paidByCustomer = new Map<string, number>();
    for (const allocation of allocations) {
      const customerId = allocation.salesInvoice?.customerId;
      if (!customerId) continue;
      paidByCustomer.set(
        customerId,
        (paidByCustomer.get(customerId) ?? 0) +
          Number(allocation.allocatedAmount),
      );
    }

    return customers.map((customer) => ({
      ...customer,
      balance:
        (invoicedByCustomer.get(customer.id) ?? 0) -
        (returnedByCustomer.get(customer.id) ?? 0) -
        (paidByCustomer.get(customer.id) ?? 0),
    }));
  }
}
