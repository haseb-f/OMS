import { BadRequestException, Injectable } from '@nestjs/common';
import {
  CustomerSource,
  CustomerStatus,
  FinancialTransactionStatus,
  Prisma,
  SalesDocumentStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  PhoneNumberService,
  phoneErrorMessage,
} from '../common/phone/phone-number.service';
import { MasterDataActivityLogService } from '../master-data/master-data-activity-log.service';
import {
  MasterDataCrudService,
  MasterDataDelegate,
  MasterDataListResult,
} from '../master-data/master-data-crud.service';
import { FindCustomersQueryDto } from './dto/find-customers-query.dto';
import { prismaEnumFilter } from '../common/query/enum-list';
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
    private readonly phoneNumberService: PhoneNumberService,
  ) {
    super(prisma, activityLog);
  }

  /** Resolves `countryId` (when given) to its ISO2 code and validates/normalizes a phone value against it; without a country, best-effort normalizes but doesn't reject (no country rules to validate against — `phone`/`mobile` are optional and `countryId` is nullable on Customer). Returns `undefined` for an empty input so an untouched optional field never becomes a validation error. */
  private async normalizeCustomerPhone(
    value: string | undefined | null,
    countryId: string | undefined | null,
  ): Promise<string | undefined> {
    if (!value?.trim()) return undefined;
    const country = countryId
      ? await this.prisma.country.findFirst({
          where: { id: countryId, deletedAt: null },
        })
      : null;
    const result = this.phoneNumberService.parse(value, country?.code);
    if (country) {
      if (!result.isValid || !result.e164) {
        throw new BadRequestException(phoneErrorMessage(result.errorReason));
      }
      return result.e164;
    }
    // No country context — accept as-is if it doesn't even parse (we can't
    // validate a numbering plan we don't know), but still normalize when it does.
    return result.e164 ?? value.trim();
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
    const phone = await this.normalizeCustomerPhone(dto.phone, dto.countryId);
    const mobile = await this.normalizeCustomerPhone(dto.mobile, dto.countryId);
    await this.assertNoDuplicate([phone, mobile], dto.email);
    const customerNumber =
      await this.numberingEngine.generateNumber(DOCUMENT_TYPE);
    return super.create(
      {
        ...dto,
        phone,
        mobile,
        customerNumber,
        source: dto.source ?? CustomerSource.MANUAL,
      },
      userId,
    );
  }

  async update(id: string, dto: UpdateCustomerDto, userId?: string) {
    const data = { ...dto };
    let countryId = dto.countryId;
    if (dto.phone !== undefined || dto.mobile !== undefined) {
      if (countryId === undefined) {
        const existing = await super.findOne(id);
        countryId = existing.countryId ?? undefined;
      }
      // An explicit "" / null clears the field — only run normalization for
      // an actual value, so clearing never gets silently turned into a
      // no-op by `normalizeCustomerPhone` treating empty as "not provided."
      if (dto.phone !== undefined) {
        data.phone = dto.phone
          ? await this.normalizeCustomerPhone(dto.phone, countryId)
          : dto.phone;
      }
      if (dto.mobile !== undefined) {
        data.mobile = dto.mobile
          ? await this.normalizeCustomerPhone(dto.mobile, countryId)
          : dto.mobile;
      }
    }
    if (data.phone || data.mobile || dto.email) {
      await this.assertNoDuplicate([data.phone, data.mobile], dto.email, id);
    }
    return super.update(id, data, userId);
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

  /**
   * Same matching engine as `lookupByPhone` / `findDuplicate`, returning every
   * non-archived phone match. Used by Store Orders import to distinguish a
   * unique existing customer (reuse) from an ambiguous phone collision.
   */
  async lookupAllByPhone(phone: string) {
    return this.findPhoneMatches([phone]);
  }

  /** List needs each row's computed receivables balance for the "Current Balance" column. */
  async findAll(
    query: FindCustomersQueryDto,
  ): Promise<
    MasterDataListResult<CustomerWithBalance<Prisma.CustomerGetPayload<object>>>
  > {
    const result = await super.findAll(
      query,
      { source: prismaEnumFilter(query.source) },
      {
        include: { customerGroup: true, paymentTerm: true, country: true },
      },
    );
    return { ...result, items: await this.attachBalances(result.items) };
  }

  async findAllIds(query: FindCustomersQueryDto) {
    return super.findAllIds(query, { source: prismaEnumFilter(query.source) });
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
        phones
          .map((p) => this.phoneNumberService.normalizeToE164(p))
          .filter((p): p is string => !!p),
      );
      const field =
        normalizedInputs.has(
          this.phoneNumberService.normalizeToE164(existing.phone) ?? '',
        ) ||
        normalizedInputs.has(
          this.phoneNumberService.normalizeToE164(existing.mobile) ?? '',
        )
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
  private async findPhoneMatches(
    phones: (string | undefined | null)[],
    excludingId?: string,
  ) {
    const normalizedPhones = [
      ...new Set(
        phones
          .map((p) => this.phoneNumberService.normalizeToE164(p))
          .filter((p): p is string => !!p),
      ),
    ];
    if (normalizedPhones.length === 0) return [];

    const candidates = await this.prisma.customer.findMany({
      where: {
        deletedAt: null,
        OR: [{ phone: { not: null } }, { mobile: { not: null } }],
        ...(excludingId ? { id: { not: excludingId } } : {}),
      },
    });
    return candidates.filter((customer) => {
      const candidatePhones = [
        this.phoneNumberService.normalizeToE164(customer.phone),
        this.phoneNumberService.normalizeToE164(customer.mobile),
      ];
      return candidatePhones.some(
        (value) => value !== null && normalizedPhones.includes(value),
      );
    });
  }

  /**
   * Batch version of the same normalized-phone matching `findPhoneMatches`
   * does for a single row — one DB fetch for the whole set, so a Store
   * Orders Sync duplicate pre-check never issues one query per row.
   * Existing stored `phone`/`mobile` values are normalized at comparison
   * time (never assumed to already be clean E.164), so pre-existing
   * raw/mixed-format data already in OMS is never missed — the "safe
   * compatibility" approach for existing data (never a schema backfill,
   * never an automatic merge).
   */
  async findByNormalizedPhones(
    normalizedPhones: string[],
  ): Promise<Map<string, Prisma.CustomerGetPayload<object>>> {
    const targets = new Set(normalizedPhones.filter(Boolean));
    const result = new Map<string, Prisma.CustomerGetPayload<object>>();
    if (targets.size === 0) return result;
    const candidates = await this.prisma.customer.findMany({
      where: {
        deletedAt: null,
        OR: [{ phone: { not: null } }, { mobile: { not: null } }],
      },
    });
    for (const customer of candidates) {
      for (const raw of [customer.phone, customer.mobile]) {
        const normalized = this.phoneNumberService.normalizeToE164(raw);
        if (normalized && targets.has(normalized) && !result.has(normalized)) {
          result.set(normalized, customer);
        }
      }
    }
    return result;
  }

  private async findDuplicate(
    phones: (string | undefined | null)[],
    email?: string,
    excludingId?: string,
  ) {
    const phoneMatches = await this.findPhoneMatches(phones, excludingId);
    if (phoneMatches[0]) return phoneMatches[0];

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
