import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  InvestmentOpportunityStatus,
  PartnerRoleType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PartnersService } from '../partners/partners.service';
import { MasterDataActivityLogService } from '../master-data/master-data-activity-log.service';
import { CreateInvestorDto } from './dto/create-investor.dto';
import { UpdateInvestorDto } from './dto/update-investor.dto';
import { InvestorsQueryDto } from './dto/investors-query.dto';

const ENTITY_TYPE = 'INVESTOR';

/** Opportunity statuses counted as "active" for an Investor's summary (Phase 22) — an investment still in play, not yet ended/settled/closed/cancelled. */
const ACTIVE_OPPORTUNITY_STATUSES: InvestmentOpportunityStatus[] = [
  InvestmentOpportunityStatus.OPEN,
  InvestmentOpportunityStatus.FUNDED,
  InvestmentOpportunityStatus.ACTIVE,
];

const INVESTOR_INCLUDE = {
  partner: {
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      notes: true,
      commercialRegistration: true,
      entityType: true,
      status: true,
    },
  },
  user: { select: { id: true, email: true } },
  subscriptions: {
    where: { deletedAt: null },
    select: {
      fundedAmount: true,
      opportunity: { select: { status: true } },
    },
  },
} satisfies Prisma.InvestorProfileInclude;

type InvestorWithRelations = Prisma.InvestorProfileGetPayload<{
  include: typeof INVESTOR_INCLUDE;
}>;

/** Flattens the Partner+InvestorProfile split into the single Investor shape the frontend renders — same pattern as EmployeesService.toEmployeeView. No profit figures here: Milestone 1 never calculates profit (mission Phase 47). */
function toInvestorView(row: InvestorWithRelations) {
  const activeInvestmentsCount = row.subscriptions.filter((s) =>
    ACTIVE_OPPORTUNITY_STATUSES.includes(s.opportunity.status),
  ).length;
  const completedInvestmentsCount =
    row.subscriptions.length - activeInvestmentsCount;
  const totalConfirmedFunding = row.subscriptions.reduce(
    (sum, s) => sum + Number(s.fundedAmount),
    0,
  );
  return {
    id: row.id,
    partnerId: row.partnerId,
    name: row.partner.name,
    entityType: row.partner.entityType,
    phone: row.partner.phone,
    email: row.partner.email,
    notes: row.partner.notes,
    commercialRegistration: row.partner.commercialRegistration,
    status: row.partner.status,
    nationalId: row.nationalId,
    residencyId: row.residencyId,
    iban: row.iban,
    userId: row.user?.id ?? null,
    userEmail: row.user?.email ?? null,
    activeInvestmentsCount,
    completedInvestmentsCount,
    totalConfirmedFunding,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

@Injectable()
export class InvestorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly partnersService: PartnersService,
    private readonly activityLog: MasterDataActivityLogService,
  ) {}

  async create(dto: CreateInvestorDto, userId?: string) {
    const partner = await this.partnersService.create(
      {
        name: dto.name,
        entityType: dto.entityType,
        phone: dto.phone,
        email: dto.email,
        commercialRegistration: dto.commercialRegistration,
        notes: dto.notes,
        roles: [PartnerRoleType.INVESTOR],
        investorProfile: {
          userId: dto.userId,
          nationalId: dto.nationalId,
          residencyId: dto.residencyId,
          iban: dto.iban,
        },
      },
      userId,
    );
    const investorProfileId = partner.investorProfile!.id;
    await this.activityLog.log(
      ENTITY_TYPE,
      investorProfileId,
      'CREATED',
      `Investor ${dto.name} created`,
      userId,
    );
    return this.findOne(investorProfileId);
  }

  async findAll(query: InvestorsQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.InvestorProfileWhereInput = {
      deletedAt: query.includeArchived ? undefined : null,
      OR: query.search
        ? [
            {
              partner: {
                OR: [
                  { name: { contains: query.search, mode: 'insensitive' } },
                  { phone: { contains: query.search, mode: 'insensitive' } },
                  { email: { contains: query.search, mode: 'insensitive' } },
                ],
              },
            },
          ]
        : undefined,
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.investorProfile.findMany({
        where,
        include: INVESTOR_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.investorProfile.count({ where }),
    ]);

    return { items: items.map(toInvestorView), total, page, pageSize };
  }

  private async findRaw(id: string) {
    const row = await this.prisma.investorProfile.findFirst({
      where: { id },
      include: INVESTOR_INCLUDE,
    });
    if (!row) throw new NotFoundException('Investor not found.');
    return row;
  }

  async findOne(id: string) {
    return toInvestorView(await this.findRaw(id));
  }

  async update(id: string, dto: UpdateInvestorDto, userId?: string) {
    const existing = await this.findRaw(id);
    const { status, ...rest } = dto;
    await this.partnersService.update(
      existing.partnerId,
      {
        name: rest.name,
        entityType: rest.entityType,
        phone: rest.phone,
        email: rest.email,
        commercialRegistration: rest.commercialRegistration,
        notes: rest.notes,
        status,
        investorProfile: {
          nationalId: rest.nationalId,
          residencyId: rest.residencyId,
          iban: rest.iban,
        },
      },
      userId,
    );
    await this.activityLog.log(
      ENTITY_TYPE,
      id,
      'UPDATED',
      `Investor ${existing.partner.name} updated`,
      userId,
    );
    return this.findOne(id);
  }

  async archive(id: string, userId?: string) {
    const existing = await this.findRaw(id);
    if (existing.deletedAt) {
      return this.findOne(id);
    }
    await this.prisma.investorProfile.update({
      where: { id },
      data: { deletedAt: new Date(), updatedBy: userId ?? null },
    });
    await this.activityLog.log(
      ENTITY_TYPE,
      id,
      'ARCHIVED',
      `Investor ${existing.partner.name} archived`,
      userId,
    );
    return this.findOne(id);
  }

  async restore(id: string, userId?: string) {
    const existing = await this.findRaw(id);
    if (!existing.deletedAt) {
      return this.findOne(id);
    }
    await this.prisma.investorProfile.update({
      where: { id },
      data: { deletedAt: null, updatedBy: userId ?? null },
    });
    await this.activityLog.log(
      ENTITY_TYPE,
      id,
      'RESTORED',
      `Investor ${existing.partner.name} restored`,
      userId,
    );
    return this.findOne(id);
  }

  async activityFor(id: string) {
    return this.activityLog.findForEntity(ENTITY_TYPE, id);
  }

  /** Used by InvestorSubscriptionsService to validate an investor is real, active, and not archived before letting it subscribe to an Opportunity. */
  async assertActiveInvestor(id: string) {
    const investor = await this.findRaw(id);
    if (investor.deletedAt || investor.partner.status !== 'ACTIVE') {
      throw new BadRequestException('Investor is not active.');
    }
    return investor;
  }
}
