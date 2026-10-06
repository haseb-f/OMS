import { LookupThrottleService } from '../customer-lookup/lookup-throttle.service';
import { CustomerLookupService } from '../customer-lookup/customer-lookup.service';
import { maskName, maskPhone } from '../customer-lookup/customer-lookup.util';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  PartnerRoleType,
  PartnerSource,
  PartnerStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  PhoneNumberService,
  ambiguousPhoneMessage,
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
import { partnerLedgerBalances } from '../accounting/reports/partner-ledger-balance';
import { CreatePartnerDto } from './dto/create-partner.dto';
import { UpdatePartnerDto } from './dto/update-partner.dto';
import { FindOrCreatePartnerDto } from './dto/find-or-create-partner.dto';
import { FindPartnersQueryDto } from './dto/find-partners-query.dto';
import {
  PartnerPhoneInUseError,
  claimPartnerPhoneKeys,
  partnerPhoneKey,
  partnerPhoneKeys,
  releasePartnerPhoneKeys,
  syncPartnerPhoneKeys,
} from './partner-phone-keys';

const DOCUMENT_TYPE = 'PARTNER';

/** Roles whose identity Quick Create may not extend without `partners.edit` (SEC-03 H3). */
const SENSITIVE_IDENTITY_ROLES: ReadonlySet<PartnerRoleType> = new Set([
  PartnerRoleType.EMPLOYEE,
  PartnerRoleType.INVESTOR,
]);

/** The partner a `PARTNER_PHONE_IN_USE` 409 named, else null. */
function phoneInUsePartnerId(error: unknown): string | null {
  if (!(error instanceof ConflictException)) return null;
  const body = error.getResponse() as {
    code?: string;
    details?: { partner?: { id: string } | null };
  };
  return body.code === 'PARTNER_PHONE_IN_USE'
    ? (body.details?.partner?.id ?? null)
    : null;
}

/** IN-list batches (large backfills / reports). */
function chunks<T>(values: T[], size = 1_000): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) {
    out.push(values.slice(i, i + size));
  }
  return out;
}

const PARTNER_INCLUDE = {
  roles: true,
  customerProfile: { include: { customerGroup: true, paymentTerm: true } },
  supplierProfile: { include: { supplierGroup: true } },
  employeeProfile: {
    include: {
      jobTitle: true,
      department: true,
      salesTeam: true,
      manager: { include: { partner: { select: { id: true, name: true } } } },
    },
  },
  investorProfile: true,
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
    'mobile',
    'email',
  ];
  protected readonly phoneSearchFields = ['phone', 'mobile'] as const;
  /** SEC-03 L2 — an unknown `sortBy` falls back to `name` instead of reaching Prisma (a 500). Real columns only (the list's balance/credit columns are computed, not sortable server-side). */
  protected readonly sortableFields = [
    'name',
    'partnerNumber',
    'commercialName',
    'createdAt',
    'updatedAt',
    'phone',
    'status',
  ];
  /** Arabic-normalized name search — "أحمد محمد صالح" finds "احمد محمد صالح". */
  protected readonly normalizedSearch = {
    table: 'partners',
    columns: ['name', 'commercial_name'],
  };

  constructor(
    prisma: PrismaService,
    activityLog: MasterDataActivityLogService,
    private readonly numberingEngine: NumberingEngineService,
    private readonly phoneNumberService: PhoneNumberService,
    /** R7 - shared lookup budget + disclosure rule. Optional only so unit specs can omit it. */
    @Optional() private readonly lookupThrottle?: LookupThrottleService,
    @Optional() private readonly customerLookup?: CustomerLookupService,
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

  /**
   * The stored form of a partner phone — always a full E.164 (R13 A1).
   * With a country: read in that country (strict, unchanged). Without one:
   * read through the R11 one path (`PhoneNumberService.lookupCandidates`:
   * the number on its own, else the first valid reading in SA / EG / AE)
   * and rejected with a 400 when no valid reading exists — never stored as
   * raw text. `keepAsIs` lists the values already stored on the record, so
   * re-saving an untouched legacy value never blocks an unrelated edit.
   */
  async normalizePartnerPhone(
    value: string | undefined | null,
    countryId: string | undefined | null,
    keepAsIs: readonly (string | null | undefined)[] = [],
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
    const { e164, ambiguous } =
      this.phoneNumberService.resolveWithoutCountry(value);
    if (e164) return e164;
    if (keepAsIs.includes(value)) return value;
    if (ambiguous.length > 0) {
      throw new BadRequestException({
        code: 'PHONE_AMBIGUOUS',
        message: ambiguousPhoneMessage(ambiguous),
      });
    }
    throw new BadRequestException(
      result.errorReason === 'NOT_A_NUMBER'
        ? phoneErrorMessage('NOT_A_NUMBER')
        : 'Phone number is not valid: choose its calling code or enter it with the country code (+…).',
    );
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
      dto.email ?? undefined,
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
      investorProfile,
      ...rest
    } = dto;
    const countryCode = await this.countryCodeOf(dto.countryId);
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
        // O3 — one phone number = one customer, race-safe: a concurrent
        // create that claimed the number first wins (this one rolls back).
        const conflict = await claimPartnerPhoneKeys(
          tx,
          partner.id,
          partnerPhoneKeys(
            this.phoneNumberService,
            { phone, mobile },
            countryCode,
          ),
        );
        if (conflict) throw conflict;
        for (const role of new Set(roles)) {
          await tx.partnerRoleAssignment.create({
            data: { partnerId: partner.id, role, createdBy: userId ?? null },
          });
          await this.createProfileForRole(tx, partner.id, role, {
            customerProfile,
            supplierProfile,
            employeeProfile,
            investorProfile,
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
      if (error instanceof PartnerPhoneInUseError) {
        throw await this.phoneInUseConflict(error);
      }
      throw this.mapError(error);
    }
  }

  private async countryCodeOf(countryId: string | null | undefined) {
    if (!countryId) return null;
    const country = await this.prisma.country.findFirst({
      where: { id: countryId },
      select: { code: true },
    });
    return country?.code ?? null;
  }

  /**
   * O3 — a phone / mobile already owned by another partner: 409 naming the
   * existing record (internal callers only — agent flows never reach the
   * Partner CRUD).
   */
  private async phoneInUseConflict(error: PartnerPhoneInUseError) {
    const owner = await this.prisma.partner.findUnique({
      where: { id: error.partnerId },
      select: { id: true, partnerNumber: true, name: true },
    });
    const label = owner ? `${owner.partnerNumber} — ${owner.name}` : '';
    return new ConflictException({
      code: 'PARTNER_PHONE_IN_USE',
      message: `رقم الهاتف مسجل لشريك آخر (${label}) — This phone number belongs to another partner (${label}).`,
      details: { partner: owner, phone: error.phone },
    });
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
    delete data.investorProfile;

    let countryId = dto.countryId;
    if (dto.phone !== undefined || dto.mobile !== undefined) {
      if (countryId === undefined) countryId = existing.countryId ?? undefined;
      if (dto.phone !== undefined) {
        data.phone = dto.phone
          ? await this.normalizePartnerPhone(dto.phone, countryId, [
              existing.phone,
              existing.mobile,
            ])
          : dto.phone;
      }
      if (dto.mobile !== undefined) {
        data.mobile = dto.mobile
          ? await this.normalizePartnerPhone(dto.mobile, countryId, [
              existing.phone,
              existing.mobile,
            ])
          : dto.mobile;
      }
    }
    // O3 — editing a phone to a number another partner holds → 409 naming it.
    const changedPhones = [data.phone, data.mobile].filter(
      (value): value is string =>
        typeof value === 'string' &&
        !!value &&
        value !== existing.phone &&
        value !== existing.mobile,
    );
    const phoneOwner = (await this.findPhoneMatches(changedPhones, id))[0];
    if (phoneOwner) {
      throw await this.phoneInUseConflict(
        new PartnerPhoneInUseError(
          this.phoneNumberService.normalizeToE164(changedPhones[0]) ??
            changedPhones[0],
          phoneOwner.id,
        ),
      );
    }
    if (dto.email || dto.taxNumber || dto.commercialRegistration) {
      await this.assertNoDuplicate(
        [],
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
          include: { country: { select: { code: true } } },
        });
        await syncPartnerPhoneKeys(
          tx,
          this.phoneNumberService,
          id,
          existing,
          partner,
          partner.country?.code,
        );
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
          const { hireDate, ...employeeRest } = dto.employeeProfile;
          await tx.employeeProfile.update({
            where: { partnerId: id },
            data: {
              ...employeeRest,
              hireDate: hireDate ? new Date(hireDate) : undefined,
              updatedBy: userId ?? null,
            },
          });
        }
        if (dto.investorProfile && existing.investorProfile) {
          await tx.investorProfile.update({
            where: { partnerId: id },
            data: { ...dto.investorProfile, updatedBy: userId ?? null },
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
      if (error instanceof PartnerPhoneInUseError) {
        throw await this.phoneInUseConflict(error);
      }
      throw this.mapError(error);
    }
  }

  /**
   * Soft-delete (O3): the archive and the release of the partner's phone
   * keys commit together — the number may then be reused.
   */
  async archive(id: string, userId?: string) {
    await this.findOne(id);
    const archived = await this.prisma.$transaction(async (tx) => {
      const partner = await tx.partner.update({
        where: { id },
        data: { deletedAt: new Date(), updatedBy: userId ?? null },
      });
      await releasePartnerPhoneKeys(tx, id);
      return partner;
    });
    await this.activityLog.log(
      this.entityType,
      id,
      'ARCHIVED',
      `${this.entityLabel} archived`,
      userId,
    );
    return archived;
  }

  /**
   * Restore re-claims the numbers in the same transaction; refused (409)
   * when another live partner holds one now.
   */
  async restore(id: string, userId?: string) {
    const existing = await this.prisma.partner.findFirst({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`${this.entityLabel} ${id} not found`);
    }
    let restored: Prisma.PartnerGetPayload<object>;
    try {
      restored = await this.prisma.$transaction(async (tx) => {
        const partner = await tx.partner.update({
          where: { id },
          data: { deletedAt: null, updatedBy: userId ?? null },
          include: { country: { select: { code: true } } },
        });
        const conflict = await claimPartnerPhoneKeys(
          tx,
          id,
          partnerPhoneKeys(
            this.phoneNumberService,
            partner,
            partner.country?.code,
          ),
        );
        if (conflict) throw conflict;
        return partner;
      });
    } catch (error) {
      if (error instanceof PartnerPhoneInUseError) {
        throw await this.phoneInUseConflict(error);
      }
      throw error;
    }
    await this.activityLog.log(
      this.entityType,
      id,
      'RESTORED',
      `${this.entityLabel} restored`,
      userId,
    );
    return restored;
  }

  private async createProfileForRole(
    tx: Prisma.TransactionClient,
    partnerId: string,
    role: PartnerRoleType,
    profiles: {
      customerProfile?: CreatePartnerDto['customerProfile'];
      supplierProfile?: CreatePartnerDto['supplierProfile'];
      employeeProfile?: CreatePartnerDto['employeeProfile'];
      investorProfile?: CreatePartnerDto['investorProfile'];
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
      case PartnerRoleType.EMPLOYEE: {
        const fields = {
          userId: profiles.employeeProfile?.userId,
          jobTitleId: profiles.employeeProfile?.jobTitleId,
          departmentId: profiles.employeeProfile?.departmentId,
          salesTeamId: profiles.employeeProfile?.salesTeamId,
          managerEmployeeId: profiles.employeeProfile?.managerEmployeeId,
          hireDate: profiles.employeeProfile?.hireDate
            ? new Date(profiles.employeeProfile.hireDate)
            : undefined,
          employmentStatus: profiles.employeeProfile?.employmentStatus,
        };
        // A Partner can only ever hold one EmployeeProfile (partnerId is
        // unique) — if the EMPLOYEE role was previously removed
        // (soft-deleted), reassigning it must reactivate that same row
        // (keeping its original employeeCode/history) rather than create a
        // second one, which the unique constraint would reject anyway.
        const existing = await tx.employeeProfile.findUnique({
          where: { partnerId },
        });
        if (existing) {
          await tx.employeeProfile.update({
            where: { partnerId },
            data: {
              ...fields,
              employmentStatus: fields.employmentStatus ?? 'ACTIVE',
              deletedAt: null,
            },
          });
          return;
        }
        // HR Milestone 1: employeeCode is app-generated here, the ONE place
        // a new EmployeeProfile is created — never user-typed, regardless
        // of whether the row originates from the Partner UI's role
        // checkbox or the dedicated Employee creation wizard (both funnel
        // through this method, so the code is minted exactly once).
        const employeeCode = await this.numberingEngine.generateNumber(
          'EMPLOYEE',
          undefined,
          tx,
        );
        await tx.employeeProfile.create({
          data: { partnerId, employeeCode, ...fields },
        });
        return;
      }
      case PartnerRoleType.INVESTOR: {
        const fields = {
          userId: profiles.investorProfile?.userId,
          nationalId: profiles.investorProfile?.nationalId,
          residencyId: profiles.investorProfile?.residencyId,
          iban: profiles.investorProfile?.iban,
          investorTypeId: profiles.investorProfile?.investorTypeId,
        };
        // Same reactivate-in-place rule as EmployeeProfile above — partnerId
        // is unique, so re-assigning a previously-removed INVESTOR role must
        // revive that same row, never create a second one.
        const existingInvestor = await tx.investorProfile.findUnique({
          where: { partnerId },
        });
        if (existingInvestor) {
          await tx.investorProfile.update({
            where: { partnerId },
            data: { ...fields, deletedAt: null },
          });
          return;
        }
        await tx.investorProfile.create({
          data: { partnerId, ...fields },
        });
        return;
      }
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
        // Employees are soft-deleted only (never hard-deleted) — HR history
        // (Compensation/KPI/Target/Commission/Payroll rows) references
        // employeeProfileId and must stay traceable/auditable.
        await tx.employeeProfile.updateMany({
          where: { partnerId: id },
          data: {
            deletedAt: new Date(),
            employmentStatus: 'TERMINATED',
            updatedBy: userId ?? null,
          },
        });
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
  async findOrCreateWithRole(
    dto: FindOrCreatePartnerDto,
    userId?: string,
    /**
     * `mayExtendSensitiveIdentity`: whether the caller may attach a new role
     * to an existing Partner that is an EMPLOYEE or INVESTOR (needs
     * `partners.edit`). Quick Create must never let a document creator
     * silently re-purpose an HR / investor identity (SEC-03 H3).
     */
    options: { mayExtendSensitiveIdentity?: boolean } = {},
  ) {
    const { role, ...rest } = dto;
    const phone = await this.normalizePartnerPhone(dto.phone, dto.countryId);
    const mobile = await this.normalizePartnerPhone(dto.mobile, dto.countryId);
    const existing = await this.findDuplicate(
      [phone, mobile],
      dto.email ?? undefined,
      dto.taxNumber,
      dto.commercialRegistration,
    );
    if (existing) {
      const partner = await this.useExistingWithRole(
        existing.id,
        role,
        userId,
        options,
      );
      return { partner, created: false };
    }
    try {
      const partner = await this.create({ ...rest, roles: [role] }, userId);
      return { partner, created: true };
    } catch (error) {
      // O3 race: a concurrent create claimed the same number first — reuse it.
      // It surfaces either as the phone-key claim or, when the winner had
      // already committed, as create()'s duplicate check; a partner found now
      // (none existed a moment ago) is that winner.
      const winnerId =
        phoneInUsePartnerId(error) ??
        (
          await this.findDuplicate(
            [phone, mobile],
            dto.email ?? undefined,
            dto.taxNumber,
            dto.commercialRegistration,
          )
        )?.id;
      if (!winnerId) throw error;
      const partner = await this.useExistingWithRole(
        winnerId,
        role,
        userId,
        options,
      );
      return { partner, created: false };
    }
  }

  /**
   * Reuses an already-identified Partner (dedup match, or a customer the
   * user explicitly confirmed — Round 5 Spec 1B) and adds `role` when it is
   * missing, with the same sensitive-identity guard as Quick Create. Never
   * updates the Partner's own fields.
   */
  async useExistingWithRole(
    partnerId: string,
    role: PartnerRoleType,
    userId?: string,
    options: { mayExtendSensitiveIdentity?: boolean } = {},
  ) {
    const full = await this.findOne(partnerId);
    const hasRole = full.roles.some((r) => r.role === role);
    if (
      !hasRole &&
      !options.mayExtendSensitiveIdentity &&
      full.roles.some((r) => SENSITIVE_IDENTITY_ROLES.has(r.role))
    ) {
      throw new ForbiddenException(
        `This contact belongs to an existing partner that cannot be given the ${role} role from Quick Create. Ask a user with Partner edit permission to add the role.`,
      );
    }
    return hasRole ? full : this.assignRole(partnerId, role, userId);
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

  /** The partners holding any of these (already normalized) E.164 numbers — key owner first. */
  async lookupAllByPhones(phones: string[]) {
    return this.findPhoneMatches(phones);
  }

  /**
   * Exact-match "does a Customer already exist for this phone number, and
   * what has it bought before?" — the safe DTO behind the
   * `customers.lookup_global` permission (Leads/Customers/Orders
   * Finalization Milestone). Deliberately excludes profit/margin,
   * commissions, internal notes, and any other Order Owner's identity —
   * only the operational summary needed to serve a returning customer.
   * Every call is written to `GlobalLookupAudit`, matched or not.
   */
  async globalLookupByPhone(phone: string, userId: string) {
    // Saudi is the primary market for this lookup — resolve a bare local
    // ("0501234567") or trunk-less ("501234567") number the same way a
    // "+966"/"966" one already resolves, without changing the stricter
    // country-agnostic behavior `findDuplicate`/`lookupByPhone` rely on for
    // Create/Update duplicate checks across every country.
    const normalized = this.phoneNumberService.normalizeToE164(phone, 'SA');
    // R7 review — fail closed: discovery without the shared audited budget
    // and the disclosure rule must never run (the two are optional in the
    // constructor only for unit specs that never call this route).
    if (!this.lookupThrottle || !this.customerLookup) {
      throw new ServiceUnavailableException(
        'Customer lookup is not available: lookup throttle/disclosure services are not configured.',
      );
    }
    // R7 - one shared per-user budget (atomic) for every lookup route.
    const reservation = await this.lookupThrottle.reserve(
      userId,
      'GLOBAL_CUSTOMER_LOOKUP',
      'PHONE',
      normalized ?? phone,
    );
    const matches =
      (await this.findPhoneMatches([phone], undefined, 'SA'))[0] ??
      (await this.findPhoneMatches([phone], undefined, 'EG'))[0] ??
      (await this.findPhoneMatches([phone], undefined, 'AE'))[0] ??
      (await this.findPhoneMatches([phone]))[0];
    let match: typeof matches | null = matches ?? null;

    // R7 — customers only: a supplier / employee / investor phone is never a
    // discovery hit.
    if (match) {
      const isCustomer = await this.prisma.partner.count({
        where: {
          id: match.id,
          roles: { some: { role: PartnerRoleType.CUSTOMER } },
        },
      });
      if (isCustomer === 0) match = null;
    }

    // R7 — internal data only: a customer whose whole footprint belongs to an
    // agent (agent orders/leads, none of ours) is not visible to company staff.
    if (match) {
      const [internalOrders, internalLeads, agentOrders, agentLeads] =
        await Promise.all([
          this.prisma.storeOrder.count({
            where: { partnerId: match.id, agentId: null, deletedAt: null },
          }),
          this.prisma.lead.count({
            where: { partnerId: match.id, agentId: null, deletedAt: null },
          }),
          this.prisma.storeOrder.count({
            where: {
              partnerId: match.id,
              agentId: { not: null },
              deletedAt: null,
            },
          }),
          this.prisma.lead.count({
            where: {
              partnerId: match.id,
              agentId: { not: null },
              deletedAt: null,
            },
          }),
        ]);
      if (
        internalOrders + internalLeads === 0 &&
        agentOrders + agentLeads > 0
      ) {
        match = null;
      }
    }

    const mayOpen = match
      ? await this.customerLookup.callerCanOpenPartner(userId, match.id)
      : false;

    await this.lookupThrottle.finalise(reservation.reservationId, {
      outcome: match ? 'MATCH' : 'NO_MATCH',
      resultCount: match ? 1 : 0,
      queryValue: normalized ?? phone,
      matchedPartnerId: match?.id,
    });

    if (!match) return null;

    // R7 - somebody else’s customer: the minimal masked shape only (no id,
    // address, order history or products). Full details stay available for a
    // customer the caller can already open under their own scope.
    if (!mayOpen) {
      return {
        restricted: true as const,
        partialName: maskName(match.name),
        maskedPhone: maskPhone(match.mobile ?? match.phone),
        notAssignedToYou: true as const,
      };
    }

    const orders = await this.prisma.storeOrder.findMany({
      where: { partnerId: match.id, agentId: null, deletedAt: null },
      orderBy: { orderDate: 'desc' },
      take: 5,
      include: {
        items: { include: { product: true }, take: 3 },
        shipments: { orderBy: { attemptNumber: 'desc' }, take: 1 },
      },
    });

    const totalOrders = await this.prisma.storeOrder.count({
      where: { partnerId: match.id, agentId: null, deletedAt: null },
    });

    const summarize = (order: (typeof orders)[number]) => ({
      id: order.id,
      orderNumber: order.internalOrderId,
      orderDate: order.orderDate,
      products: order.items
        .map((item) => item.product.displayName || item.product.name)
        .join(' · '),
      paymentStatus: order.paymentStatus,
      shippingStage: order.shippingStage,
      shippingStatus: order.shipments[0]?.status ?? null,
    });

    return {
      restricted: false as const,
      id: match.id,
      partnerNumber: match.partnerNumber,
      name: match.name,
      phone: match.phone,
      mobile: match.mobile,
      countryId: match.countryId,
      city: match.city,
      address: match.address,
      totalOrders,
      lastOrder: orders[0] ? summarize(orders[0]) : null,
      recentOrders: orders.map(summarize),
    };
  }

  /** Identity columns only — no phone/mobile/email (see `findAll`'s `options`). */
  static readonly IDENTITY_SEARCH_FIELDS = [
    'partnerNumber',
    'name',
    'commercialName',
  ] as const;

  async findAll(
    query: FindPartnersQueryDto,
    /**
     * `identitySearchOnly`: the picker catalog for a caller without contact
     * detail rights — searching by phone/email would let them confirm who
     * owns a contact they cannot see (SEC-01).
     */
    options: { identitySearchOnly?: boolean } = {},
  ): Promise<MasterDataListResult<PartnerWithBalance<PartnerWithRelations>>> {
    const roleWhere = query.role?.length
      ? { roles: { some: { role: { in: query.role } } } }
      : {};
    const result = await super.findAll(
      query,
      {
        status: prismaEnumFilter(query.status),
        source: prismaEnumFilter(query.source),
        ...(query.ids?.length ? { id: { in: query.ids } } : {}),
        ...roleWhere,
      },
      { include: PARTNER_INCLUDE },
      options.identitySearchOnly
        ? PartnersService.IDENTITY_SEARCH_FIELDS
        : undefined,
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
    defaultRegion?: string,
  ) {
    // The ONE identity-matching path (`PhoneNumberService.lookupCandidates`):
    // the typed region, then the number on its own, then the primary markets.
    const normalizedPhones = [
      ...new Set(
        phones.flatMap((p) =>
          // Narrow: a Create/Update guard must not block a save over a second reading.
          this.phoneNumberService.lookupCandidates(p, defaultRegion, true),
        ),
      ),
    ];
    if (normalizedPhones.length === 0) return [];
    const notSelf = excludingId ? { id: { not: excludingId } } : {};

    // 1. The claimed keys (one customer per number, O3) and any record storing
    //    the exact E.164 — an index lookup, not a table scan.
    const direct = await this.prisma.partner.findMany({
      where: {
        deletedAt: null,
        ...notSelf,
        OR: [
          { phoneKeys: { some: { phoneE164: { in: normalizedPhones } } } },
          { phone: { in: normalizedPhones } },
          { mobile: { in: normalizedPhones } },
        ],
      },
      include: { country: { select: { code: true } } },
    });
    // 2. Legacy rows whose number is stored in a local / unclaimed format (never
    //    keyed, or keyed only for another of their numbers): narrowed in SQL to the
    //    rows containing the candidate's trailing digits, then compared as full
    //    normalized numbers in memory with the partner's own country. A narrowing
    //    step only — identity is never a fragment match.
    const tails = [
      ...new Set(
        normalizedPhones.map((value) => value.replace(/\D/g, '').slice(-7)),
      ),
    ].filter((tail) => tail.length === 7);
    const legacy = await this.prisma.partner.findMany({
      where: {
        deletedAt: null,
        ...notSelf,
        id: { notIn: direct.map((partner) => partner.id) },
        OR: tails.flatMap((tail) => [
          { phone: { contains: tail } },
          { mobile: { contains: tail } },
        ]),
      },
      include: { country: { select: { code: true } } },
      take: 500,
    });
    const legacyMatches = legacy.filter((partner) =>
      [partner.phone, partner.mobile].some((raw) => {
        const value = partnerPhoneKey(
          this.phoneNumberService,
          raw,
          partner.country?.code,
        );
        return value !== null && normalizedPhones.includes(value);
      }),
    );
    const matches = [...direct, ...legacyMatches];
    if (matches.length < 2) return matches;
    // O3 — the key owner (the one customer of this number) first, then the
    // oldest record: legacy duplicates always resolve to the same partner.
    const owners = new Set(
      (
        await this.prisma.partnerPhoneKey.findMany({
          where: { phoneE164: { in: normalizedPhones } },
          select: { partnerId: true },
        })
      ).map((key) => key.partnerId),
    );
    return matches.sort(
      (x, y) =>
        Number(owners.has(y.id)) - Number(owners.has(x.id)) ||
        x.createdAt.getTime() - y.createdAt.getTime(),
    );
  }

  /**
   * O3 — the one partner of a phone number (key owner, else the oldest
   * holder of a legacy duplicate), or null.
   */
  async findByPhone(phone: string) {
    return (await this.findPhoneMatches([phone]))[0] ?? null;
  }

  /**
   * O3 — legacy duplicate groups: live partners sharing a normalized phone
   * (records created before one phone = one customer). Read-only — never
   * merged automatically; the key owner is the record new orders attach to.
   */
  async legacyPhoneDuplicateGroups() {
    const partners = await this.prisma.partner.findMany({
      where: {
        deletedAt: null,
        OR: [{ phone: { not: null } }, { mobile: { not: null } }],
      },
      select: {
        id: true,
        partnerNumber: true,
        name: true,
        phone: true,
        mobile: true,
        createdAt: true,
        country: { select: { code: true } },
        roles: { select: { role: true } },
        _count: { select: { storeOrders: { where: { deletedAt: null } } } },
      },
      orderBy: { createdAt: 'asc' },
    });
    const byPhone = new Map<string, typeof partners>();
    for (const partner of partners) {
      const keys = partnerPhoneKeys(
        this.phoneNumberService,
        partner,
        partner.country?.code,
      );
      for (const { phone } of keys) {
        const group = byPhone.get(phone) ?? [];
        if (!group.some((row) => row.id === partner.id)) group.push(partner);
        byPhone.set(phone, group);
      }
    }
    const isCustomer = (partner: (typeof partners)[number]) =>
      partner.roles.some((r) => r.role === PartnerRoleType.CUSTOMER);
    // Customer duplicates only; another identity sharing the number (an
    // employee, investor, supplier…) is listed as a masked internal record.
    const duplicates = [...byPhone.entries()].filter(
      ([, group]) => group.length > 1 && group.some(isCustomer),
    );
    const owners = new Map<string, string>();
    for (const phones of chunks(duplicates.map(([phone]) => phone))) {
      const keys = await this.prisma.partnerPhoneKey.findMany({
        where: { phoneE164: { in: phones } },
        select: { phoneE164: true, partnerId: true },
      });
      for (const key of keys) owners.set(key.phoneE164, key.partnerId);
    }
    return duplicates.map(([phone, group]) => {
      const ownerId = owners.get(phone) ?? null;
      return {
        phone,
        keyOwnerId: group.some((p) => p.id === ownerId && isCustomer(p))
          ? ownerId
          : null,
        partners: group.map((partner) =>
          isCustomer(partner)
            ? {
                id: partner.id,
                partnerNumber: partner.partnerNumber,
                name: partner.name,
                internalRecord: false,
                createdAt: partner.createdAt,
                orderCount: partner._count.storeOrders,
                keyOwner: ownerId === partner.id,
              }
            : {
                id: null,
                partnerNumber: null,
                name: null,
                internalRecord: true,
                createdAt: partner.createdAt,
                orderCount: partner._count.storeOrders,
                keyOwner: ownerId === partner.id,
              },
        ),
      };
    });
  }

  /** Batch version — one DB fetch for a whole Store Orders sync run, never one query per row. */
  async findByNormalizedPhones(
    normalizedPhones: string[],
  ): Promise<Map<string, Prisma.PartnerGetPayload<object>>> {
    const targets = new Set(normalizedPhones.filter(Boolean));
    const result = new Map<string, Prisma.PartnerGetPayload<object>>();
    if (targets.size === 0) return result;
    // O3 — the key owner of a number is its one customer; unkeyed legacy
    // rows fall back to the oldest record storing it.
    for (const phones of chunks([...targets])) {
      const keyed = await this.prisma.partnerPhoneKey.findMany({
        where: { phoneE164: { in: phones }, partner: { deletedAt: null } },
        select: { phoneE164: true, partner: true },
      });
      for (const key of keyed) result.set(key.phoneE164, key.partner);
    }
    const candidates = await this.prisma.partner.findMany({
      where: {
        deletedAt: null,
        OR: [{ phone: { not: null } }, { mobile: { not: null } }],
      },
      orderBy: { createdAt: 'asc' },
      include: { country: { select: { code: true } } },
    });
    for (const partner of candidates) {
      for (const raw of [partner.phone, partner.mobile]) {
        const normalized = partnerPhoneKey(
          this.phoneNumberService,
          raw,
          partner.country?.code,
        );
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
   * Receivable / Payable balances come from the posted ledger — the
   * partner-tagged lines on the AR/AP control accounts, in functional
   * currency (`partnerLedgerBalances`) — the exact figures the Customer /
   * Supplier Statement closes on. They were formerly re-derived from
   * documents (invoices − returns − allocations), which silently drifted from
   * the statement for unallocated advances, refunds, foreign-currency
   * documents, bank fees, opening balances and legacy documents confirmed
   * without a Journal Entry. Computed independently and never netted (spec
   * sections 25/26 — Net Exposure is a display-only concern).
   */
  private async attachBalances<T extends { id: string }>(
    partners: T[],
  ): Promise<PartnerWithBalance<T>[]> {
    if (partners.length === 0) return [];
    const balances = await partnerLedgerBalances(
      this.prisma,
      partners.map((p) => p.id),
    );
    return partners.map((partner) => ({
      ...partner,
      receivableBalance: balances.get(partner.id)?.receivable ?? 0,
      payableBalance: balances.get(partner.id)?.payable ?? 0,
    }));
  }
}
