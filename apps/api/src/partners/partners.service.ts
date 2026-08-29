import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  FinancialTransactionStatus,
  PartnerRoleType,
  PartnerSource,
  PartnerStatus,
  Prisma,
  PurchaseDocumentStatus,
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
import { prismaEnumFilter } from '../common/query/enum-list';
import { NumberingEngineService } from '../numbering/numbering-engine.service';
import { CreatePartnerDto } from './dto/create-partner.dto';
import { UpdatePartnerDto } from './dto/update-partner.dto';
import { FindOrCreatePartnerDto } from './dto/find-or-create-partner.dto';
import { FindPartnersQueryDto } from './dto/find-partners-query.dto';

const DOCUMENT_TYPE = 'PARTNER';
const SALES_BALANCE_STATUSES: SalesDocumentStatus[] = [
  SalesDocumentStatus.CONFIRMED,
  SalesDocumentStatus.CLOSED,
];
const PURCHASE_BALANCE_STATUSES: PurchaseDocumentStatus[] = [
  PurchaseDocumentStatus.CONFIRMED,
  PurchaseDocumentStatus.CLOSED,
];

const PARTNER_INCLUDE = {
  roles: true,
  customerProfile: { include: { customerGroup: true, paymentTerm: true } },
  supplierProfile: { include: { supplierGroup: true } },
  employeeProfile: { include: { jobTitle: true } },
  country: true,
  currency: true,
} satisfies Prisma.PartnerInclude;

type PartnerWithRelations = Prisma.PartnerGetPayload<{
  include: typeof PARTNER_INCLUDE;
}>;
type PartnerWithBalance<T> = T & {
  receivableBalance: number;
  payableBalance: number;
};

/**
 * Unified Partner Architecture — the single canonical counterparty identity
 * (replaces CustomersService + SuppliersService, which formerly maintained
 * two separate identities). Consolidates the good parts of both: Customer's
 * phone+mobile dedup array and bulk archive/findAllIds, Supplier's
 * transactional create/update/archive/restore. Adds: tax-number/commercial-
 * registration to the dedup check (spec section 14), role assignment
 * (assignRole/removeRole), and findOrCreateWithRole for the Quick Create
 * pickers.
 */
@Injectable()
export class PartnersService extends MasterDataCrudService<
  Prisma.PartnerGetPayload<object>
> {
  protected readonly entityType = DOCUMENT_TYPE;
  protected readonly entityLabel = 'Partner';
  protected readonly searchFields = [
    'partnerNumber',
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

  protected get delegate(): MasterDataDelegate<
    Prisma.PartnerGetPayload<object>
  > {
    return this.prisma.partner as unknown as MasterDataDelegate<
      Prisma.PartnerGetPayload<object>
    >;
  }

  private async normalizePartnerPhone(
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

  /** Partner Number is never typed by hand (spec section 42) — minted the same way Customer/Supplier's own numbers were. */
  async create(
    dto: CreatePartnerDto,
    userId?: string,
  ): Promise<PartnerWithRelations> {
    const phone = await this.normalizePartnerPhone(dto.phone, dto.countryId);
    const mobile = await this.normalizePartnerPhone(dto.mobile, dto.countryId);
    await this.assertNoDuplicate(
      [phone, mobile],
      dto.email,
      dto.taxNumber,
      dto.commercialRegistration,
    );
    const partnerNumber =
      await this.numberingEngine.generateNumber(DOCUMENT_TYPE);
    const {
      roles,
      customerProfile,
      supplierProfile,
      employeeProfile,
      ...rest
    } = dto;
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const partner = await tx.partner.create({
          data: {
            ...rest,
            phone,
            mobile,
            partnerNumber,
            source: dto.source ?? PartnerSource.MANUAL,
            createdBy: userId ?? null,
            updatedBy: userId ?? null,
          },
        });
        for (const role of new Set(roles)) {
          await tx.partnerRoleAssignment.create({
            data: { partnerId: partner.id, role, createdBy: userId ?? null },
          });
          await this.createProfileForRole(tx, partner.id, role, {
            customerProfile,
            supplierProfile,
            employeeProfile,
          });
        }
        await this.activityLog.log(
          this.entityType,
          partner.id,
          'CREATED',
          `Partner ${partner.name} created`,
          userId,
        );
        return partner.id;
      });
      return this.findOne(created);
    } catch (error) {
      throw this.mapError(error);
    }
  }

  async update(
    id: string,
    dto: UpdatePartnerDto,
    userId?: string,
  ): Promise<PartnerWithRelations> {
    const existing = await this.findOne(id);
    const data: Record<string, unknown> = { ...dto };
    delete data.customerProfile;
    delete data.supplierProfile;
    delete data.employeeProfile;

    let countryId = dto.countryId;
    if (dto.phone !== undefined || dto.mobile !== undefined) {
      if (countryId === undefined) countryId = existing.countryId ?? undefined;
      if (dto.phone !== undefined) {
        data.phone = dto.phone
          ? await this.normalizePartnerPhone(dto.phone, countryId)
          : dto.phone;
      }
      if (dto.mobile !== undefined) {
        data.mobile = dto.mobile
          ? await this.normalizePartnerPhone(dto.mobile, countryId)
          : dto.mobile;
      }
    }
    if (
      data.phone ||
      data.mobile ||
      dto.email ||
      dto.taxNumber ||
      dto.commercialRegistration
    ) {
      await this.assertNoDuplicate(
        [
          (data.phone as string | undefined) ?? existing.phone ?? undefined,
          (data.mobile as string | undefined) ?? existing.mobile ?? undefined,
        ],
        dto.email ?? existing.email ?? undefined,
        dto.taxNumber ?? existing.taxNumber ?? undefined,
        dto.commercialRegistration ??
          existing.commercialRegistration ??
          undefined,
        id,
      );
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        const partner = await tx.partner.update({
          where: { id },
          data: { ...data, updatedBy: userId ?? null },
        });
        if (dto.customerProfile && existing.customerProfile) {
          await tx.customerProfile.update({
            where: { partnerId: id },
            data: dto.customerProfile,
          });
        }
        if (dto.supplierProfile && existing.supplierProfile) {
          await tx.supplierProfile.update({
            where: { partnerId: id },
            data: dto.supplierProfile,
          });
        }
        if (dto.employeeProfile && existing.employeeProfile) {
          await tx.employeeProfile.update({
            where: { partnerId: id },
            data: dto.employeeProfile,
          });
        }
        await this.activityLog.log(
          this.entityType,
          id,
          'UPDATED',
          `Partner ${partner.name} updated`,
          userId,
        );
      });
      return this.findOne(id);
    } catch (error) {
      throw this.mapError(error);
    }
  }

  private async createProfileForRole(
    tx: Prisma.TransactionClient,
    partnerId: string,
    role: PartnerRoleType,
    profiles: {
      customerProfile?: CreatePartnerDto['customerProfile'];
      supplierProfile?: CreatePartnerDto['supplierProfile'];
      employeeProfile?: CreatePartnerDto['employeeProfile'];
    },
  ) {
    switch (role) {
      case PartnerRoleType.CUSTOMER:
        await tx.customerProfile.create({
          data: {
            partnerId,
            customerGroupId: profiles.customerProfile?.customerGroupId,
            paymentTermId: profiles.customerProfile?.paymentTermId,
            creditLimit: profiles.customerProfile?.creditLimit,
          },
        });
        return;
      case PartnerRoleType.SUPPLIER:
        await tx.supplierProfile.create({
          data: {
            partnerId,
            supplierGroupId: profiles.supplierProfile?.supplierGroupId,
            paymentTerm: profiles.supplierProfile?.paymentTerm,
            creditLimit: profiles.supplierProfile?.creditLimit,
            isPreferred: profiles.supplierProfile?.isPreferred ?? false,
          },
        });
        return;
      case PartnerRoleType.EMPLOYEE:
        await tx.employeeProfile.create({
          data: {
            partnerId,
            userId: profiles.employeeProfile?.userId,
            jobTitleId: profiles.employeeProfile?.jobTitleId,
          },
        });
        return;
      case PartnerRoleType.OWNER:
      case PartnerRoleType.OTHER:
        return;
    }
  }

  /** Spec section 6/44 — role changes get their own audit entry, distinct from a plain field UPDATED. */
  async assignRole(id: string, role: PartnerRoleType, userId?: string) {
    const partner = await this.findOne(id);
    if (partner.roles.some((r) => r.role === role)) {
      throw new BadRequestException(`Partner already has the ${role} role.`);
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.partnerRoleAssignment.create({
        data: { partnerId: id, role, createdBy: userId ?? null },
      });
      await this.createProfileForRole(tx, id, role, {});
      await this.activityLog.log(
        this.entityType,
        id,
        'ROLE_ASSIGNED',
        `${role} role assigned`,
        userId,
        { role },
      );
    });
    return this.findOne(id);
  }

  async removeRole(id: string, role: PartnerRoleType, userId?: string) {
    const partner = await this.findOne(id);
    const assignment = partner.roles.find((r) => r.role === role);
    if (!assignment) {
      throw new NotFoundException(`Partner does not have the ${role} role.`);
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.partnerRoleAssignment.delete({ where: { id: assignment.id } });
      if (role === PartnerRoleType.CUSTOMER) {
        await tx.customerProfile.deleteMany({ where: { partnerId: id } });
      }
      if (role === PartnerRoleType.SUPPLIER) {
        await tx.supplierProfile.deleteMany({ where: { partnerId: id } });
      }
      if (role === PartnerRoleType.EMPLOYEE) {
        await tx.employeeProfile.deleteMany({ where: { partnerId: id } });
      }
      await this.activityLog.log(
        this.entityType,
        id,
        'ROLE_REMOVED',
        `${role} role removed`,
        userId,
        { role },
      );
    });
    return this.findOne(id);
  }

  /**
   * Spec section 39 — Quick Create. Dedup first (phone/mobile/email/tax
   * number/commercial registration); reuses the existing Partner and adds
   * `role` if it doesn't already hold it, otherwise creates a fresh Partner
   * with just that one role. Never creates a duplicate identity.
   */
  async findOrCreateWithRole(dto: FindOrCreatePartnerDto, userId?: string) {
    const { role, ...rest } = dto;
    const existing = await this.findDuplicate(
      [dto.phone, dto.mobile],
      dto.email,
      dto.taxNumber,
      dto.commercialRegistration,
    );
    if (existing) {
      const full = await this.findOne(existing.id);
      const hasRole = full.roles.some((r) => r.role === role);
      const partner = hasRole
        ? full
        : await this.assignRole(existing.id, role, userId);
      return { partner, created: false };
    }
    const partner = await this.create({ ...rest, roles: [role] }, userId);
    return { partner, created: true };
  }

  /** Reused by every Sales/Purchasing document service — "no inactive partners, and only ones holding the right role" enforced once here. */
  async assertActiveForRole(id: string, role: PartnerRoleType) {
    const partner = await this.findOne(id);
    if (partner.status !== PartnerStatus.ACTIVE) {
      throw new BadRequestException('Partner is inactive.');
    }
    if (!partner.roles.some((r) => r.role === role)) {
      throw new BadRequestException(`Partner does not have the ${role} role.`);
    }
    return partner;
  }

  /** Read-only lookup used by Leads/Store Orders/Import Center preview — "does this phone already belong to a Partner?" */
  async lookupByPhone(phone: string) {
    return this.findDuplicate([phone]);
  }

  async lookupAllByPhone(phone: string) {
    return this.findPhoneMatches([phone]);
  }

  async findAll(
    query: FindPartnersQueryDto,
  ): Promise<MasterDataListResult<PartnerWithBalance<PartnerWithRelations>>> {
    const roleWhere = query.role?.length
      ? { roles: { some: { role: { in: query.role } } } }
      : {};
    const result = await super.findAll(
      query,
      {
        status: prismaEnumFilter(query.status),
        source: prismaEnumFilter(query.source),
        ...roleWhere,
      },
      { include: PARTNER_INCLUDE },
    );
    return {
      ...result,
      items: await this.attachBalances(
        result.items as unknown as PartnerWithRelations[],
      ),
    };
  }

  async findAllIds(query: FindPartnersQueryDto) {
    const roleWhere = query.role?.length
      ? { roles: { some: { role: { in: query.role } } } }
      : {};
    return super.findAllIds(query, {
      status: prismaEnumFilter(query.status),
      source: prismaEnumFilter(query.source),
      ...roleWhere,
    });
  }

  async findOne(id: string): Promise<PartnerWithBalance<PartnerWithRelations>> {
    const partner = await this.prisma.partner.findFirst({
      where: { id, deletedAt: null },
      include: PARTNER_INCLUDE,
    });
    if (!partner) {
      throw new NotFoundException(`Partner ${id} not found`);
    }
    const [withBalance] = await this.attachBalances([partner]);
    return withBalance;
  }

  /**
   * "Prevent duplicate partners by Phone, Mobile, Email, Tax Number, or
   * Commercial Registration" (spec section 14) — allow duplicate names only.
   */
  private async assertNoDuplicate(
    phones: (string | undefined | null)[],
    email?: string,
    taxNumber?: string,
    commercialRegistration?: string,
    excludingId?: string,
  ) {
    const existing = await this.findDuplicate(
      phones,
      email,
      taxNumber,
      commercialRegistration,
      excludingId,
    );
    if (existing) {
      const normalizedInputs = new Set(
        phones
          .map((p) => this.phoneNumberService.normalizeToE164(p))
          .filter((p): p is string => !!p),
      );
      let field = 'phone number';
      if (
        !normalizedInputs.has(
          this.phoneNumberService.normalizeToE164(existing.phone) ?? '',
        ) &&
        !normalizedInputs.has(
          this.phoneNumberService.normalizeToE164(existing.mobile) ?? '',
        )
      ) {
        field =
          taxNumber && existing.taxNumber === taxNumber
            ? 'tax number'
            : commercialRegistration &&
                existing.commercialRegistration === commercialRegistration
              ? 'commercial registration'
              : 'email';
      }
      throw new BadRequestException(
        `A partner with this ${field} already exists (${existing.partnerNumber} — ${existing.name}).`,
      );
    }
  }

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

    const candidates = await this.prisma.partner.findMany({
      where: {
        deletedAt: null,
        OR: [{ phone: { not: null } }, { mobile: { not: null } }],
        ...(excludingId ? { id: { not: excludingId } } : {}),
      },
    });
    return candidates.filter((partner) => {
      const candidatePhones = [
        this.phoneNumberService.normalizeToE164(partner.phone),
        this.phoneNumberService.normalizeToE164(partner.mobile),
      ];
      return candidatePhones.some(
        (value) => value !== null && normalizedPhones.includes(value),
      );
    });
  }

  /** Batch version — one DB fetch for a whole Store Orders sync run, never one query per row. */
  async findByNormalizedPhones(
    normalizedPhones: string[],
  ): Promise<Map<string, Prisma.PartnerGetPayload<object>>> {
    const targets = new Set(normalizedPhones.filter(Boolean));
    const result = new Map<string, Prisma.PartnerGetPayload<object>>();
    if (targets.size === 0) return result;
    const candidates = await this.prisma.partner.findMany({
      where: {
        deletedAt: null,
        OR: [{ phone: { not: null } }, { mobile: { not: null } }],
      },
    });
    for (const partner of candidates) {
      for (const raw of [partner.phone, partner.mobile]) {
        const normalized = this.phoneNumberService.normalizeToE164(raw);
        if (normalized && targets.has(normalized) && !result.has(normalized)) {
          result.set(normalized, partner);
        }
      }
    }
    return result;
  }

  private async findDuplicate(
    phones: (string | undefined | null)[],
    email?: string,
    taxNumber?: string,
    commercialRegistration?: string,
    excludingId?: string,
  ) {
    const phoneMatches = await this.findPhoneMatches(phones, excludingId);
    if (phoneMatches[0]) return phoneMatches[0];

    if (email) {
      const emailMatch = await this.prisma.partner.findFirst({
        where: {
          deletedAt: null,
          email,
          ...(excludingId ? { id: { not: excludingId } } : {}),
        },
      });
      if (emailMatch) return emailMatch;
    }

    if (taxNumber) {
      const taxMatch = await this.prisma.partner.findFirst({
        where: {
          deletedAt: null,
          taxNumber,
          ...(excludingId ? { id: { not: excludingId } } : {}),
        },
      });
      if (taxMatch) return taxMatch;
    }

    if (commercialRegistration) {
      const crMatch = await this.prisma.partner.findFirst({
        where: {
          deletedAt: null,
          commercialRegistration,
          ...(excludingId ? { id: { not: excludingId } } : {}),
        },
      });
      if (crMatch) return crMatch;
    }

    return null;
  }

  /**
   * Receivable = confirmed/closed Sales Invoices minus confirmed/closed
   * Sales Returns minus CONFIRMED Customer Receipt allocations. Payable =
   * the same shape on the Purchasing side. Computed independently and never
   * netted (spec sections 25/26 — Net Exposure is a display-only concern,
   * left to the frontend/Partner Statement, never collapsed here).
   */
  private async attachBalances<T extends { id: string }>(
    partners: T[],
  ): Promise<PartnerWithBalance<T>[]> {
    if (partners.length === 0) return [];
    const ids = partners.map((p) => p.id);

    const [
      invoiceSums,
      returnSums,
      arAllocations,
      poInvoiceSums,
      poReturnSums,
      apAllocations,
    ] = await Promise.all([
      this.prisma.salesInvoice.groupBy({
        by: ['partnerId'],
        where: {
          partnerId: { in: ids },
          status: { in: SALES_BALANCE_STATUSES },
        },
        _sum: { grandTotal: true },
      }),
      this.prisma.salesReturn.groupBy({
        by: ['partnerId'],
        where: {
          partnerId: { in: ids },
          status: { in: SALES_BALANCE_STATUSES },
        },
        _sum: { grandTotal: true },
      }),
      this.prisma.financialTransactionAllocation.findMany({
        where: {
          transaction: { status: FinancialTransactionStatus.CONFIRMED },
          salesInvoice: { partnerId: { in: ids } },
        },
        select: {
          allocatedAmount: true,
          salesInvoice: { select: { partnerId: true } },
        },
      }),
      this.prisma.purchaseInvoice.groupBy({
        by: ['partnerId'],
        where: {
          partnerId: { in: ids },
          status: { in: PURCHASE_BALANCE_STATUSES },
        },
        _sum: { grandTotal: true },
      }),
      this.prisma.purchaseReturn.groupBy({
        by: ['partnerId'],
        where: {
          partnerId: { in: ids },
          status: { in: PURCHASE_BALANCE_STATUSES },
        },
        _sum: { grandTotal: true },
      }),
      this.prisma.financialTransactionAllocation.findMany({
        where: {
          transaction: { status: FinancialTransactionStatus.CONFIRMED },
          purchaseInvoice: { partnerId: { in: ids } },
        },
        select: {
          allocatedAmount: true,
          purchaseInvoice: { select: { partnerId: true } },
        },
      }),
    ]);

    const invoicedByPartner = new Map(
      invoiceSums.map((row) => [
        row.partnerId,
        Number(row._sum.grandTotal ?? 0),
      ]),
    );
    const returnedByPartner = new Map(
      returnSums.map((row) => [
        row.partnerId,
        Number(row._sum.grandTotal ?? 0),
      ]),
    );
    const receiptsByPartner = new Map<string, number>();
    for (const allocation of arAllocations) {
      const partnerId = allocation.salesInvoice?.partnerId;
      if (!partnerId) continue;
      receiptsByPartner.set(
        partnerId,
        (receiptsByPartner.get(partnerId) ?? 0) +
          Number(allocation.allocatedAmount),
      );
    }

    const purchasedByPartner = new Map(
      poInvoiceSums.map((row) => [
        row.partnerId,
        Number(row._sum.grandTotal ?? 0),
      ]),
    );
    const purchaseReturnedByPartner = new Map(
      poReturnSums.map((row) => [
        row.partnerId,
        Number(row._sum.grandTotal ?? 0),
      ]),
    );
    const paymentsByPartner = new Map<string, number>();
    for (const allocation of apAllocations) {
      const partnerId = allocation.purchaseInvoice?.partnerId;
      if (!partnerId) continue;
      paymentsByPartner.set(
        partnerId,
        (paymentsByPartner.get(partnerId) ?? 0) +
          Number(allocation.allocatedAmount),
      );
    }

    return partners.map((partner) => ({
      ...partner,
      receivableBalance:
        (invoicedByPartner.get(partner.id) ?? 0) -
        (returnedByPartner.get(partner.id) ?? 0) -
        (receiptsByPartner.get(partner.id) ?? 0),
      payableBalance:
        (purchasedByPartner.get(partner.id) ?? 0) -
        (purchaseReturnedByPartner.get(partner.id) ?? 0) -
        (paymentsByPartner.get(partner.id) ?? 0),
    }));
  }
}
