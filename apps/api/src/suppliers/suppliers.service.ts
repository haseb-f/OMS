import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  FinancialTransactionStatus,
  Prisma,
  PurchaseDocumentStatus,
  SupplierStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingEngineService } from '../numbering/numbering-engine.service';
import {
  PhoneNumberService,
  phoneErrorMessage,
} from '../common/phone/phone-number.service';
import {
  SupplierActivityService,
  SupplierActivityType,
} from './activities/supplier-activity.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { FindSuppliersQueryDto } from './dto/find-suppliers-query.dto';
import { FindOrCreateSupplierDto } from './dto/find-or-create-supplier.dto';

const BALANCE_STATUSES: PurchaseDocumentStatus[] = [
  PurchaseDocumentStatus.CONFIRMED,
  PurchaseDocumentStatus.CLOSED,
];

type SupplierWithBalance<T> = T & { balance: number };

@Injectable()
export class SuppliersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityService: SupplierActivityService,
    private readonly numberingEngine: NumberingEngineService,
    private readonly phoneNumberService: PhoneNumberService,
  ) {}

  /** Mirrors `CustomersService.normalizeCustomerPhone` — resolves `countryId` (when given) to its ISO2 code, validates strictly against it, and best-effort normalizes without a country (Supplier's `countryId` is nullable). */
  private async normalizeSupplierPhone(
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
    return result.e164 ?? value.trim();
  }

  async create(dto: CreateSupplierDto) {
    const phone = dto.phone
      ? await this.normalizeSupplierPhone(dto.phone, dto.countryId)
      : dto.phone;
    const mobile = dto.mobile
      ? await this.normalizeSupplierPhone(dto.mobile, dto.countryId)
      : dto.mobile;
    // Minted before the transaction opens — the Numbering Engine runs its
    // own short transaction internally (TASK-025 Part 4), the same way the
    // Postgres sequence this replaces was never rolled back by an outer
    // transaction failing either.
    const supplierNumber =
      await this.numberingEngine.generateNumber('SUPPLIER');
    try {
      return await this.prisma.$transaction(async (tx) => {
        const supplier = await tx.supplier.create({
          data: {
            ...dto,
            phone,
            mobile,
            code: dto.code || supplierNumber,
            supplierNumber,
          },
        });
        await this.activityService.log(
          supplier.id,
          SupplierActivityType.SUPPLIER_CREATED,
          `Supplier ${supplier.code} created`,
          undefined,
          tx,
        );
        return supplier;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new BadRequestException('Supplier code must be unique.');
      }
      throw error;
    }
  }

  /**
   * "Search" — filters by Status; matches Code/Name/Commercial Name.
   * TASK-048 — paginated (`{items,total,page,pageSize}`), matching every
   * other list endpoint SupplierPicker/EnterpriseDataTable expect.
   */
  async findAll(query: FindSuppliersQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.SupplierWhereInput = {
      deletedAt: query.includeArchived ? undefined : null,
      status: query.status,
    };

    if (query.search) {
      where.OR = [
        { code: { contains: query.search, mode: 'insensitive' } },
        { name: { contains: query.search, mode: 'insensitive' } },
        { commercialName: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.supplier.findMany({
        where,
        include: { currency: true, country: true, supplierGroup: true },
        orderBy: { [query.sortBy || 'name']: query.sortOrder ?? 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.supplier.count({ where }),
    ]);

    return { items: await this.attachBalances(items), total, page, pageSize };
  }

  async findOne(id: string) {
    const supplier = await this.prisma.supplier.findFirst({
      where: { id, deletedAt: null },
      include: { currency: true, country: true },
    });
    if (!supplier) {
      throw new NotFoundException(`Supplier ${id} not found`);
    }
    const [withBalance] = await this.attachBalances([supplier]);
    return withBalance;
  }

  async update(id: string, dto: UpdateSupplierDto) {
    const existing = await this.findOne(id);
    const data = { ...dto };
    const countryId = dto.countryId ?? existing.countryId ?? undefined;
    if (dto.phone) {
      data.phone = await this.normalizeSupplierPhone(dto.phone, countryId);
    }
    if (dto.mobile) {
      data.mobile = await this.normalizeSupplierPhone(dto.mobile, countryId);
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        const supplier = await tx.supplier.update({ where: { id }, data });
        await this.activityService.log(
          id,
          SupplierActivityType.SUPPLIER_UPDATED,
          `Supplier ${supplier.code} updated`,
          undefined,
          tx,
        );
        return supplier;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new BadRequestException('Supplier code must be unique.');
      }
      throw error;
    }
  }

  /** Soft delete. */
  async archive(id: string) {
    const existing = await this.findOne(id);
    return this.prisma.$transaction(async (tx) => {
      const supplier = await tx.supplier.update({
        where: { id },
        data: { deletedAt: new Date() },
      });
      await this.activityService.log(
        id,
        SupplierActivityType.SUPPLIER_ARCHIVED,
        `Supplier ${existing.code} archived`,
        undefined,
        tx,
      );
      return supplier;
    });
  }

  /** Counterpart of Archive — clears deletedAt so the row rejoins the default list. */
  async restore(id: string) {
    const existing = await this.prisma.supplier.findFirst({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Supplier ${id} not found`);
    }
    return this.prisma.$transaction(async (tx) => {
      const supplier = await tx.supplier.update({
        where: { id },
        data: { deletedAt: null },
      });
      await this.activityService.log(
        id,
        SupplierActivityType.SUPPLIER_RESTORED,
        `Supplier ${existing.code} restored`,
        undefined,
        tx,
      );
      return supplier;
    });
  }

  /** Sets Status back to ACTIVE — the counterpart of manually setting it to INACTIVE via Update. */
  async activate(id: string) {
    const existing = await this.findOne(id);
    return this.prisma.$transaction(async (tx) => {
      const supplier = await tx.supplier.update({
        where: { id },
        data: { status: SupplierStatus.ACTIVE },
      });
      await this.activityService.log(
        id,
        SupplierActivityType.SUPPLIER_UPDATED,
        `Supplier ${existing.code} activated`,
        undefined,
        tx,
      );
      return supplier;
    });
  }

  /**
   * Never duplicates a Supplier: looks up an existing, non-archived record
   * by phone OR email first and reuses it as-is if found; only creates a
   * new Supplier otherwise. Mirrors `CustomersService.findOrCreate` — used
   * by the Supplier Picker's Quick Create.
   */
  async findOrCreate(dto: FindOrCreateSupplierDto) {
    const existing = await this.findDuplicate(dto.phone, dto.email);
    if (existing) {
      return { supplier: existing, created: false };
    }
    const supplier = await this.create(dto);
    return { supplier, created: true };
  }

  /** Reused by every Purchasing document service — "no inactive suppliers" is enforced once here. */
  async assertActiveSupplier(supplierId: string) {
    const supplier = await this.findOne(supplierId);
    if (supplier.status !== SupplierStatus.ACTIVE) {
      throw new BadRequestException('Supplier is inactive.');
    }
    return supplier;
  }

  /** Compares canonical E.164 values, never raw strings (mirrors `CustomersService.findDuplicate`) — a supplier stored as "0501234567" must still match a lookup for "+966501234567". */
  private async findDuplicate(phone?: string, email?: string) {
    const normalizedPhone = phone
      ? this.phoneNumberService.normalizeToE164(phone)
      : null;

    if (normalizedPhone) {
      const candidates = await this.prisma.supplier.findMany({
        where: { deletedAt: null, phone: { not: null } },
      });
      const phoneMatch = candidates.find(
        (c) =>
          this.phoneNumberService.normalizeToE164(c.phone) === normalizedPhone,
      );
      if (phoneMatch) return phoneMatch;
    }

    if (email) {
      const emailMatch = await this.prisma.supplier.findFirst({
        where: { deletedAt: null, email },
      });
      if (emailMatch) return emailMatch;
    }

    return null;
  }

  /**
   * Payable balance = confirmed/closed Purchase Invoices minus confirmed/
   * closed Purchase Returns minus CONFIRMED Supplier Payment allocations for
   * that supplier (TASK-052) — the payable mirror of
   * `CustomersService.attachBalances`, reusing the same Matching Engine
   * allocation data rather than a second computation. Batched: grouped
   * aggregates + one allocation join per page, never N+1.
   */
  private async attachBalances<T extends { id: string }>(
    suppliers: T[],
  ): Promise<SupplierWithBalance<T>[]> {
    if (suppliers.length === 0) return [];
    const ids = suppliers.map((s) => s.id);

    const [invoiceSums, returnSums, allocations] = await Promise.all([
      this.prisma.purchaseInvoice.groupBy({
        by: ['supplierId'],
        where: { supplierId: { in: ids }, status: { in: BALANCE_STATUSES } },
        _sum: { grandTotal: true },
      }),
      this.prisma.purchaseReturn.groupBy({
        by: ['supplierId'],
        where: { supplierId: { in: ids }, status: { in: BALANCE_STATUSES } },
        _sum: { grandTotal: true },
      }),
      this.prisma.financialTransactionAllocation.findMany({
        where: {
          transaction: { status: FinancialTransactionStatus.CONFIRMED },
          purchaseInvoice: { supplierId: { in: ids } },
        },
        select: {
          allocatedAmount: true,
          purchaseInvoice: { select: { supplierId: true } },
        },
      }),
    ]);
    const invoicedBySupplier = new Map(
      invoiceSums.map((row) => [
        row.supplierId,
        Number(row._sum.grandTotal ?? 0),
      ]),
    );
    const returnedBySupplier = new Map(
      returnSums.map((row) => [
        row.supplierId,
        Number(row._sum.grandTotal ?? 0),
      ]),
    );
    const paidBySupplier = new Map<string, number>();
    for (const allocation of allocations) {
      const supplierId = allocation.purchaseInvoice?.supplierId;
      if (!supplierId) continue;
      paidBySupplier.set(
        supplierId,
        (paidBySupplier.get(supplierId) ?? 0) +
          Number(allocation.allocatedAmount),
      );
    }

    return suppliers.map((supplier) => ({
      ...supplier,
      balance:
        (invoicedBySupplier.get(supplier.id) ?? 0) -
        (returnedBySupplier.get(supplier.id) ?? 0) -
        (paidBySupplier.get(supplier.id) ?? 0),
    }));
  }
}
