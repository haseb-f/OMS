import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CompanyPartnerStatus,
  PartnerAgreementStatus,
  PartnerEntityType,
  PartnerProfitPeriodStatus,
  PartnerRoleType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PartnersService } from '../partners/partners.service';
import { MasterDataActivityLogService } from '../master-data/master-data-activity-log.service';
import {
  CreateCompanyPartnerDto,
  CreatePartnerAgreementDto,
  EndPartnerAgreementDto,
  SupersedePartnerAgreementDto,
  UpdateCompanyPartnerDto,
  UpdatePartnerAgreementDto,
} from './dto/company-partners.dto';
import {
  addCalendarDays,
  toBusinessDateString,
} from '../common/time/business-date';
import {
  dateValue,
  isoDate,
  maxConcurrentPercent,
  rangesOverlap,
} from './partner-profit-calculator';
import { PartnerBalancesService } from './partner-balances.service';

export const PROFILE_ENTITY = 'COMPANY_PARTNER';
export const AGREEMENT_ENTITY = 'PARTNER_AGREEMENT';

/** Agreements that are (or were) in force — DRAFT never counts. */
export const IN_FORCE_STATUSES = [
  PartnerAgreementStatus.ACTIVE,
  PartnerAgreementStatus.ENDED,
];

export function parseBusinessDate(value: string, field: string): string {
  try {
    return toBusinessDateString(value);
  } catch {
    throw new BadRequestException({
      code: 'INVALID_DATE',
      message: `${field}: "${value}" is not a calendar date.`,
    });
  }
}

type AgreementRow = Prisma.PartnerAgreementGetPayload<object>;

export function agreementView(row: AgreementRow) {
  return {
    id: row.id,
    partnerId: row.partnerId,
    profitSharePercent: Number(row.profitSharePercent),
    basis: row.basis,
    effectiveFrom: isoDate(row.effectiveFrom),
    effectiveTo: row.effectiveTo ? isoDate(row.effectiveTo) : null,
    frequency: row.frequency,
    scope: row.scope,
    status: row.status,
    supersedesId: row.supersedesId,
    notes: row.notes,
    activatedAt: row.activatedAt,
    endedAt: row.endedAt,
    createdAt: row.createdAt,
  };
}

interface CandidateAgreement {
  id: string;
  partnerId: string;
  percent: number;
  from: string;
  to: string | null;
  frequency: string;
  status: PartnerAgreementStatus;
}

/**
 * R14 W5 (spec-5 §1-2, §4) — company partners (Partner + OWNER role) and
 * their profit-sharing agreements. An ACTIVE agreement is never edited: a
 * new share ends it and starts a successor (`supersede`), so every closed
 * period keeps the terms it was computed with.
 */
@Injectable()
export class CompanyPartnersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly partners: PartnersService,
    private readonly activityLog: MasterDataActivityLogService,
    private readonly balances: PartnerBalancesService,
  ) {}

  // ---------------------------------------------------------------- profiles

  async list() {
    const profiles = await this.prisma.companyPartnerProfile.findMany({
      include: {
        partner: {
          select: {
            id: true,
            name: true,
            partnerNumber: true,
            phone: true,
            email: true,
            partnerAgreements: {
              where: { status: { in: IN_FORCE_STATUSES } },
              orderBy: { effectiveFrom: 'desc' },
            },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    const balances = await this.balances.forPartners(
      profiles.map((p) => p.partnerId),
    );
    const today = isoDate(new Date());
    return profiles.map((profile) => {
      const current =
        profile.partner.partnerAgreements.find((a) =>
          rangesOverlap(
            isoDate(a.effectiveFrom),
            a.effectiveTo ? isoDate(a.effectiveTo) : null,
            today,
            today,
          ),
        ) ?? null;
      return {
        ...this.profileView(profile),
        currentAgreement: current ? agreementView(current) : null,
        ...balances.get(profile.partnerId)!,
      };
    });
  }

  async findOne(partnerId: string) {
    const profile = await this.requireProfile(partnerId);
    const agreements = await this.prisma.partnerAgreement.findMany({
      where: { partnerId },
      orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
    });
    const balances = await this.balances.forPartners([partnerId]);
    return {
      ...this.profileView(profile),
      agreements: agreements.map(agreementView),
      ...balances.get(partnerId)!,
    };
  }

  private profileView(
    profile: Prisma.CompanyPartnerProfileGetPayload<object> & {
      partner: {
        id: string;
        name: string;
        partnerNumber: string;
        phone: string | null;
        email: string | null;
      };
    },
  ) {
    return {
      id: profile.id,
      partnerId: profile.partnerId,
      name: profile.partner.name,
      partnerNumber: profile.partner.partnerNumber,
      phone: profile.partner.phone,
      email: profile.partner.email,
      ownershipPercent:
        profile.ownershipPercent == null
          ? null
          : Number(profile.ownershipPercent),
      notes: profile.notes,
      status: profile.status,
      createdAt: profile.createdAt,
    };
  }

  async requireProfile(partnerId: string) {
    const profile = await this.prisma.companyPartnerProfile.findUnique({
      where: { partnerId },
      include: {
        partner: {
          select: {
            id: true,
            name: true,
            partnerNumber: true,
            phone: true,
            email: true,
          },
        },
      },
    });
    if (!profile) {
      throw new NotFoundException(`Company partner ${partnerId} not found`);
    }
    return profile;
  }

  /** From an existing Partner (gains the OWNER role) or a brand-new Partner. No login is ever created. */
  async create(dto: CreateCompanyPartnerDto, userId?: string) {
    let partnerId = dto.partnerId;
    if (partnerId) {
      const partner = await this.partners.findOne(partnerId);
      if (partner.deletedAt) {
        throw new BadRequestException(`Partner ${partner.name} is archived.`);
      }
      const existing = await this.prisma.companyPartnerProfile.findUnique({
        where: { partnerId },
      });
      if (existing) {
        throw new ConflictException({
          code: 'COMPANY_PARTNER_EXISTS',
          message: `${partner.name} is already a company partner.`,
        });
      }
      if (!partner.roles.some((r) => r.role === PartnerRoleType.OWNER)) {
        await this.partners.assignRole(
          partnerId,
          PartnerRoleType.OWNER,
          userId,
        );
      }
    } else {
      const name = dto.name?.trim();
      if (!name) {
        throw new BadRequestException({
          code: 'COMPANY_PARTNER_NAME_REQUIRED',
          message: 'Choose an existing partner or enter the new partner name.',
        });
      }
      const created = await this.partners.create(
        {
          name,
          entityType: PartnerEntityType.PERSON,
          phone: dto.phone || undefined,
          email: dto.email || undefined,
          roles: [PartnerRoleType.OWNER],
        },
        userId,
      );
      partnerId = created.id;
    }
    await this.prisma.companyPartnerProfile.create({
      data: {
        partnerId,
        ownershipPercent: dto.ownershipPercent ?? null,
        notes: dto.notes || null,
        createdBy: userId ?? null,
        updatedBy: userId ?? null,
      },
    });
    await this.activityLog.log(
      PROFILE_ENTITY,
      partnerId,
      'CREATED',
      'Company partner created',
      userId,
    );
    return this.findOne(partnerId);
  }

  async update(
    partnerId: string,
    dto: UpdateCompanyPartnerDto,
    userId?: string,
  ) {
    await this.requireProfile(partnerId);
    await this.prisma.companyPartnerProfile.update({
      where: { partnerId },
      data: {
        ownershipPercent: dto.ownershipPercent,
        notes: dto.notes,
        status: dto.status,
        updatedBy: userId ?? null,
      },
    });
    await this.activityLog.log(
      PROFILE_ENTITY,
      partnerId,
      'UPDATED',
      'Company partner updated',
      userId,
      { ...dto },
    );
    return this.findOne(partnerId);
  }

  // -------------------------------------------------------------- agreements

  async listAgreements(partnerId?: string) {
    const rows = await this.prisma.partnerAgreement.findMany({
      where: { partnerId },
      include: { partner: { select: { name: true } } },
      orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
    });
    return rows.map((row) => ({
      ...agreementView(row),
      partnerName: row.partner.name,
    }));
  }

  private async requireAgreement(
    id: string,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const row = await client.partnerAgreement.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`Agreement ${id} not found`);
    return row;
  }

  async createAgreement(dto: CreatePartnerAgreementDto, userId?: string) {
    const profile = await this.requireProfile(dto.partnerId);
    if (profile.status !== CompanyPartnerStatus.ACTIVE) {
      throw new BadRequestException({
        code: 'COMPANY_PARTNER_INACTIVE',
        message: `${profile.partner.name} is inactive — activate the partner before adding an agreement.`,
      });
    }
    const from = parseBusinessDate(dto.effectiveFrom, 'effectiveFrom');
    const to = dto.effectiveTo
      ? parseBusinessDate(dto.effectiveTo, 'effectiveTo')
      : null;
    this.assertRange(from, to);
    const created = await this.prisma.$transaction(async (tx) => {
      await this.lockPool(tx);
      const row = await tx.partnerAgreement.create({
        data: {
          partnerId: dto.partnerId,
          profitSharePercent: dto.profitSharePercent,
          basis: dto.basis,
          effectiveFrom: dateValue(from),
          effectiveTo: to ? dateValue(to) : null,
          frequency: dto.frequency,
          notes: dto.notes || null,
          createdBy: userId ?? null,
          updatedBy: userId ?? null,
        },
      });
      if (dto.activate !== false) {
        await this.activateInTx(tx, row.id, userId);
      }
      return row;
    });
    await this.activityLog.log(
      AGREEMENT_ENTITY,
      created.id,
      'CREATED',
      `Agreement ${dto.profitSharePercent}% (${dto.basis}) from ${from}`,
      userId,
    );
    return agreementView(await this.requireAgreement(created.id));
  }

  /** Only a DRAFT is editable — an ACTIVE agreement is ended and superseded instead. */
  async updateAgreement(
    id: string,
    dto: UpdatePartnerAgreementDto,
    userId?: string,
  ) {
    const row = await this.requireAgreement(id);
    if (row.status !== PartnerAgreementStatus.DRAFT) {
      throw new ConflictException({
        code: 'PARTNER_AGREEMENT_LOCKED',
        message:
          'An active agreement cannot be edited — end it and start a new one (supersede) so history stays intact.',
      });
    }
    const from = dto.effectiveFrom
      ? parseBusinessDate(dto.effectiveFrom, 'effectiveFrom')
      : isoDate(row.effectiveFrom);
    const to =
      dto.effectiveTo === undefined
        ? row.effectiveTo
          ? isoDate(row.effectiveTo)
          : null
        : dto.effectiveTo
          ? parseBusinessDate(dto.effectiveTo, 'effectiveTo')
          : null;
    this.assertRange(from, to);
    await this.prisma.partnerAgreement.update({
      where: { id },
      data: {
        profitSharePercent: dto.profitSharePercent,
        basis: dto.basis,
        frequency: dto.frequency,
        effectiveFrom: dateValue(from),
        effectiveTo: to ? dateValue(to) : null,
        notes: dto.notes,
        updatedBy: userId ?? null,
      },
    });
    return agreementView(await this.requireAgreement(id));
  }

  async activateAgreement(id: string, userId?: string) {
    await this.prisma.$transaction(async (tx) => {
      await this.lockPool(tx);
      await this.activateInTx(tx, id, userId);
    });
    await this.activityLog.log(
      AGREEMENT_ENTITY,
      id,
      'ACTIVATED',
      'Agreement activated',
      userId,
    );
    return agreementView(await this.requireAgreement(id));
  }

  /** Sets the last day in force. The agreement keeps governing the dates up to it. */
  async endAgreement(id: string, dto: EndPartnerAgreementDto, userId?: string) {
    const effectiveTo = parseBusinessDate(dto.effectiveTo, 'effectiveTo');
    await this.prisma.$transaction(async (tx) => {
      await this.lockPool(tx);
      const row = await this.requireAgreement(id, tx);
      if (row.status !== PartnerAgreementStatus.ACTIVE) {
        throw new ConflictException({
          code: 'PARTNER_AGREEMENT_NOT_ACTIVE',
          message: 'Only an active agreement can be ended.',
        });
      }
      const from = isoDate(row.effectiveFrom);
      const oldTo = row.effectiveTo ? isoDate(row.effectiveTo) : null;
      this.assertRange(from, effectiveTo);
      if (oldTo !== null && effectiveTo > oldTo) {
        throw new BadRequestException({
          code: 'PARTNER_AGREEMENT_END_LATER',
          message: `The agreement already ends on ${oldTo}; an end date can only move earlier.`,
        });
      }
      await this.assertNoClosedPeriod(
        tx,
        addCalendarDays(effectiveTo, 1),
        oldTo,
      );
      await tx.partnerAgreement.update({
        where: { id },
        data: {
          effectiveTo: dateValue(effectiveTo),
          status: PartnerAgreementStatus.ENDED,
          endedAt: new Date(),
          endedBy: userId ?? null,
          updatedBy: userId ?? null,
        },
      });
    });
    await this.activityLog.log(
      AGREEMENT_ENTITY,
      id,
      'ENDED',
      `Agreement ended on ${effectiveTo}`,
      userId,
    );
    return agreementView(await this.requireAgreement(id));
  }

  /** Changing a share: the current agreement ends the day before `effectiveFrom`, the successor starts on it. */
  async supersedeAgreement(
    id: string,
    dto: SupersedePartnerAgreementDto,
    userId?: string,
  ) {
    const effectiveFrom = parseBusinessDate(dto.effectiveFrom, 'effectiveFrom');
    const successorId = await this.prisma.$transaction(async (tx) => {
      await this.lockPool(tx);
      const row = await this.requireAgreement(id, tx);
      if (row.status !== PartnerAgreementStatus.ACTIVE) {
        throw new ConflictException({
          code: 'PARTNER_AGREEMENT_NOT_ACTIVE',
          message: 'Only an active agreement can be superseded.',
        });
      }
      const from = isoDate(row.effectiveFrom);
      const oldTo = row.effectiveTo ? isoDate(row.effectiveTo) : null;
      if (effectiveFrom <= from || (oldTo !== null && effectiveFrom > oldTo)) {
        throw new BadRequestException({
          code: 'PARTNER_AGREEMENT_SUPERSEDE_DATE',
          message: `The new terms must start after ${from}${oldTo ? ` and on or before ${oldTo}` : ''}.`,
        });
      }
      const endOfOld = addCalendarDays(effectiveFrom, -1);
      await this.assertNoClosedPeriod(tx, effectiveFrom, oldTo);
      await tx.partnerAgreement.update({
        where: { id },
        data: {
          effectiveTo: dateValue(endOfOld),
          status: PartnerAgreementStatus.ENDED,
          endedAt: new Date(),
          endedBy: userId ?? null,
          updatedBy: userId ?? null,
        },
      });
      const successor = await tx.partnerAgreement.create({
        data: {
          partnerId: row.partnerId,
          profitSharePercent: dto.profitSharePercent,
          basis: dto.basis ?? row.basis,
          effectiveFrom: dateValue(effectiveFrom),
          effectiveTo: row.effectiveTo,
          frequency: row.frequency,
          supersedesId: row.id,
          notes: dto.notes || null,
          createdBy: userId ?? null,
          updatedBy: userId ?? null,
        },
      });
      await this.activateInTx(tx, successor.id, userId);
      return successor.id;
    });
    await this.activityLog.log(
      AGREEMENT_ENTITY,
      id,
      'SUPERSEDED',
      `Superseded from ${effectiveFrom} by ${dto.profitSharePercent}%`,
      userId,
      { successorId },
    );
    return agreementView(await this.requireAgreement(successorId));
  }

  private assertRange(from: string, to: string | null) {
    if (to !== null && to < from) {
      throw new BadRequestException({
        code: 'PARTNER_AGREEMENT_RANGE',
        message: `The end date (${to}) is before the start date (${from}).`,
      });
    }
  }

  /** Serializes every agreement change of the one company pool (Σ% must be judged on a stable set). */
  private async lockPool(tx: Prisma.TransactionClient) {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('company-partner-pool'))::text AS locked`;
  }

  /** Dates [from, to] must not fall in a CLOSED period — its entitlements were computed with the terms in force then. */
  private async assertNoClosedPeriod(
    tx: Prisma.TransactionClient,
    from: string,
    to: string | null,
  ) {
    const closed = await tx.partnerProfitPeriod.findFirst({
      where: {
        status: PartnerProfitPeriodStatus.CLOSED,
        periodTo: { gte: dateValue(from) },
        ...(to !== null && { periodFrom: { lte: dateValue(to) } }),
      },
      orderBy: { periodFrom: 'asc' },
    });
    if (closed) {
      throw new ConflictException({
        code: 'PARTNER_PERIOD_CLOSED_RANGE',
        message: `The change reaches the closed profit period ${isoDate(closed.periodFrom)} → ${isoDate(closed.periodTo)}; terms of a closed period cannot change. Choose a date after it.`,
      });
    }
  }

  /**
   * DRAFT → ACTIVE after the pool rules (spec §4, D5-2): one partner never
   * has two agreements in force on the same day; Σ profit share of the
   * agreements in force on any day ≤ 100 %; every ACTIVE agreement shares
   * one closing frequency; and no closed period is affected.
   */
  private async activateInTx(
    tx: Prisma.TransactionClient,
    id: string,
    userId?: string,
  ) {
    const row = await this.requireAgreement(id, tx);
    if (row.status !== PartnerAgreementStatus.DRAFT) {
      throw new ConflictException({
        code: 'PARTNER_AGREEMENT_NOT_DRAFT',
        message: `The agreement is already ${row.status}.`,
      });
    }
    const candidate: CandidateAgreement = {
      id: row.id,
      partnerId: row.partnerId,
      percent: Number(row.profitSharePercent),
      from: isoDate(row.effectiveFrom),
      to: row.effectiveTo ? isoDate(row.effectiveTo) : null,
      frequency: row.frequency,
      status: PartnerAgreementStatus.ACTIVE,
    };
    const others = (
      await tx.partnerAgreement.findMany({
        where: { status: { in: IN_FORCE_STATUSES }, id: { not: id } },
      })
    ).map<CandidateAgreement>((a) => ({
      id: a.id,
      partnerId: a.partnerId,
      percent: Number(a.profitSharePercent),
      from: isoDate(a.effectiveFrom),
      to: a.effectiveTo ? isoDate(a.effectiveTo) : null,
      frequency: a.frequency,
      status: a.status,
    }));

    const samePartner = others.find(
      (a) =>
        a.partnerId === candidate.partnerId &&
        rangesOverlap(a.from, a.to, candidate.from, candidate.to),
    );
    if (samePartner) {
      throw new ConflictException({
        code: 'PARTNER_AGREEMENT_OVERLAP',
        message: `This partner already has an agreement in force from ${samePartner.from}${samePartner.to ? ` to ${samePartner.to}` : ''} — end or supersede it first.`,
      });
    }
    const otherFrequency = others.find(
      (a) =>
        a.status === PartnerAgreementStatus.ACTIVE &&
        a.frequency !== candidate.frequency,
    );
    if (otherFrequency) {
      throw new BadRequestException({
        code: 'PARTNER_FREQUENCY_MISMATCH',
        message: `All active agreements close on one frequency (${otherFrequency.frequency}); this one is ${candidate.frequency}.`,
      });
    }
    const pool = maxConcurrentPercent(
      [...others, candidate].map((a) => ({
        from: a.from,
        to: a.to,
        percent: a.percent,
      })),
    );
    if (pool.max > 100) {
      throw new BadRequestException({
        code: 'PARTNER_SHARE_OVER_100',
        message: `مجموع نسب الشركاء يتجاوز 100٪ (${pool.max}٪ في ${pool.on}) — The partners' shares would total ${pool.max}% on ${pool.on}; the company pool cannot exceed 100%.`,
      });
    }
    await this.assertNoClosedPeriod(tx, candidate.from, candidate.to);
    await tx.partnerAgreement.update({
      where: { id },
      data: {
        status: PartnerAgreementStatus.ACTIVE,
        activatedAt: new Date(),
        activatedBy: userId ?? null,
        updatedBy: userId ?? null,
      },
    });
  }
}
