import { Injectable } from '@nestjs/common';
import { phoneSearchCandidates } from '../../common/phone/phone-number.service';
import { PartnerEntityType, PartnerRoleType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NumberingEngineService } from '../../numbering/numbering-engine.service';
import { PartnersService } from '../../partners/partners.service';
import { InventoryService } from '../../inventory/inventory.service';
import {
  agentConflict,
  agentNotFoundError,
  agentUnprocessable,
} from '../common/agent-errors';
import type {
  CreateAgentDto,
  FindAgentsQueryDto,
  UpdateAgentDto,
} from './dto/agent.dto';

/** Fulfillment codes after which an agent order is no longer open. */
export const CLOSED_FULFILLMENT_CODES = [
  'DELIVERED',
  'COLLECTED',
  'CANCELLED',
  'RETURNED',
];

const AGENT_LIST_SELECT = {
  id: true,
  agentNumber: true,
  name: true,
  legalName: true,
  contactName: true,
  phone: true,
  email: true,
  status: true,
  currencyId: true,
  currency: { select: { id: true, code: true, name: true, symbol: true } },
  partnerId: true,
  createdAt: true,
  updatedAt: true,
  _count: {
    select: {
      users: { where: { deletedAt: null } },
      products: { where: { deletedAt: null } },
      storeOrders: { where: { deletedAt: null } },
    },
  },
} satisfies Prisma.AgentSelect;

/**
 * Internal management of external agents (spec §2, §10). Each Agent has one
 * Partner (role AGENT) — the subledger identity for Agent funds payable.
 */
@Injectable()
export class AgentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numberingEngine: NumberingEngineService,
    private readonly partners: PartnersService,
    private readonly inventory: InventoryService,
  ) {}

  async create(dto: CreateAgentDto, userId: string) {
    await this.assertCurrency(dto.currencyId);
    // One stored form for the agent's phone and its Partner identity (R13 A1):
    // a full E.164, never raw text.
    const phone = await this.partners.normalizePartnerPhone(
      dto.phone,
      dto.countryId,
    );
    // Reuses an existing Partner with the same phone/email (adds the AGENT
    // role) — never a duplicate identity; an HR/investor identity is refused
    // by PartnersService itself.
    const { partner } = await this.partners.findOrCreateWithRole(
      {
        name: dto.name,
        legalName: dto.legalName,
        entityType: PartnerEntityType.ORGANIZATION,
        phone,
        email: dto.email ?? undefined,
        address: dto.address,
        countryId: dto.countryId,
        currencyId: dto.currencyId,
        role: PartnerRoleType.AGENT,
      },
      userId,
    );
    const taken = await this.prisma.agent.findUnique({
      where: { partnerId: partner.id },
      select: { agentNumber: true },
    });
    if (taken) {
      throw agentConflict(
        'AGENT_PARTNER_TAKEN',
        `جهة الاتصال مرتبطة بالفعل بالوكيل ${taken.agentNumber}`,
        `This contact already belongs to agent ${taken.agentNumber}.`,
      );
    }
    const agent = await this.prisma.$transaction(async (tx) => {
      const agentNumber = await this.numberingEngine.generateNumber(
        'AGENT',
        undefined,
        tx,
      );
      return tx.agent.create({
        data: {
          agentNumber,
          partnerId: partner.id,
          name: dto.name,
          legalName: dto.legalName,
          contactName: dto.contactName,
          phone,
          email: dto.email ?? null,
          address: dto.address,
          notes: dto.notes,
          currencyId: dto.currencyId,
          createdBy: userId,
          updatedBy: userId,
        },
      });
    });
    return this.findOne(agent.id);
  }

  async findAll(query: FindAgentsQueryDto) {
    const where: Prisma.AgentWhereInput = {
      deletedAt: null,
      status: query.status,
    };
    const search = query.search?.trim();
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { legalName: { contains: search, mode: 'insensitive' } },
        { agentNumber: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
        ...phoneSearchCandidates(search).map((digits) => ({
          phone: { contains: digits },
        })),
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const [items, total] = await Promise.all([
      this.prisma.agent.findMany({
        where,
        select: AGENT_LIST_SELECT,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.agent.count({ where }),
    ]);
    const today = new Date();
    const active = items.length
      ? await this.prisma.agentAgreement.findMany({
          where: {
            agentId: { in: items.map((item) => item.id) },
            ...activeAgreementWhere(today),
          },
          select: {
            agentId: true,
            id: true,
            agreementNumber: true,
            productCommissionRatePercent: true,
            serviceCommissionRatePercent: true,
            shippingPolicy: true,
            effectiveFrom: true,
            effectiveTo: true,
          },
        })
      : [];
    const activeByAgent = new Map(active.map((row) => [row.agentId, row]));
    return {
      items: items.map((item) => ({
        ...item,
        activeAgreement: activeByAgent.get(item.id) ?? null,
      })),
      total,
      page,
      pageSize,
    };
  }

  async findOne(id: string) {
    const agent = await this.prisma.agent.findFirst({
      where: { id, deletedAt: null },
      select: {
        ...AGENT_LIST_SELECT,
        address: true,
        notes: true,
        partner: {
          select: { id: true, partnerNumber: true, name: true, status: true },
        },
      },
    });
    if (!agent) throw agentNotFoundError('Agent', 'الوكيل');
    const today = new Date();
    const [activeAgreement, openOrders, destinations, agreements] =
      await Promise.all([
        this.prisma.agentAgreement.findFirst({
          where: { agentId: id, ...activeAgreementWhere(today) },
        }),
        this.countOpenOrders(id),
        this.prisma.agentPaymentDestination.count({
          where: { agentId: id, isActive: true },
        }),
        this.prisma.agentAgreement.groupBy({
          by: ['status'],
          where: { agentId: id },
          _count: { _all: true },
        }),
      ]);
    return {
      ...agent,
      activeAgreement,
      summary: {
        openOrders,
        activeDestinations: destinations,
        agreementsByStatus: Object.fromEntries(
          agreements.map((row) => [row.status, row._count._all]),
        ),
      },
    };
  }

  async update(id: string, dto: UpdateAgentDto, userId: string) {
    const existing = await this.requireAgent(id);
    if (dto.currencyId && dto.currencyId !== existing.currencyId) {
      await this.assertCurrency(dto.currencyId);
      // Both agreement documents are in the settlement currency (R15 D15-13).
      const [agreements, shippingAgreements] = await Promise.all([
        this.prisma.agentAgreement.count({ where: { agentId: id } }),
        this.prisma.agentShippingAgreement.count({ where: { agentId: id } }),
      ]);
      if (agreements + shippingAgreements > 0) {
        throw agentConflict(
          'AGENT_CURRENCY_LOCKED',
          'لا يمكن تغيير عملة التسوية بعد إنشاء اتفاقيات للوكيل',
          'The settlement currency cannot change once the agent has agreements.',
        );
      }
    }
    await this.prisma.agent.update({
      where: { id },
      data: {
        name: dto.name,
        legalName: dto.legalName,
        contactName: dto.contactName,
        phone:
          dto.phone === undefined
            ? undefined
            : await this.partners.normalizePartnerPhone(dto.phone, null, [
                existing.phone,
              ]),
        email: dto.email === undefined ? undefined : dto.email,
        address: dto.address,
        notes: dto.notes,
        currencyId: dto.currencyId,
        updatedBy: userId,
      },
    });
    return this.findOne(id);
  }

  /** Inactive agent ⇒ its users lose access at once (guard re-reads the agent); no new orders. */
  async setStatus(id: string, status: 'ACTIVE' | 'INACTIVE', userId: string) {
    await this.requireAgent(id);
    await this.prisma.agent.update({
      where: { id },
      data: { status, updatedBy: userId },
    });
    return this.findOne(id);
  }

  /** Soft archive; refused while the agent still has open orders. */
  async archive(id: string, userId: string) {
    await this.requireAgent(id);
    const open = await this.countOpenOrders(id);
    if (open > 0) {
      throw agentConflict(
        'AGENT_HAS_OPEN_ORDERS',
        `لا يمكن أرشفة الوكيل لوجود ${open} طلب مفتوح`,
        `The agent still has ${open} open order(s); close them before archiving.`,
      );
    }
    await this.prisma.agent.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'INACTIVE', updatedBy: userId },
    });
    return { id, archived: true };
  }

  async getStock(
    id: string,
    filter: { productId?: string; warehouseId?: string },
  ) {
    await this.requireAgent(id);
    return this.inventory.getAgentStock(id, filter);
  }

  async requireAgent(id: string) {
    const agent = await this.prisma.agent.findFirst({
      where: { id, deletedAt: null },
    });
    if (!agent) throw agentNotFoundError('Agent', 'الوكيل');
    return agent;
  }

  /** Agent must exist and be ACTIVE (new orders, users, ownership). */
  async requireActiveAgent(id: string, client?: Prisma.TransactionClient) {
    const agent = await (client ?? this.prisma).agent.findFirst({
      where: { id, deletedAt: null },
    });
    if (!agent) throw agentNotFoundError('Agent', 'الوكيل');
    if (agent.status !== 'ACTIVE') {
      throw agentUnprocessable(
        'AGENT_NOT_ACTIVE',
        'الوكيل غير نشط',
        'The agent is not active.',
      );
    }
    return agent;
  }

  private countOpenOrders(agentId: string) {
    return this.prisma.storeOrder.count({
      where: {
        agentId,
        deletedAt: null,
        OR: [
          { fulfillmentStatusId: null },
          {
            fulfillmentStatus: { code: { notIn: CLOSED_FULFILLMENT_CODES } },
          },
        ],
      },
    });
  }

  private async assertCurrency(currencyId: string) {
    const currency = await this.prisma.currency.findFirst({
      where: { id: currencyId, deletedAt: null },
      select: { id: true },
    });
    if (!currency) {
      throw agentUnprocessable(
        'CURRENCY_NOT_FOUND',
        'العملة غير موجودة',
        'Currency not found.',
      );
    }
  }
}

/**
 * Agreements in force on `date` (spec §2): activated (ACTIVE, or ENDED with
 * a fixed last day) and `effectiveFrom ≤ date ≤ effectiveTo`.
 */
export function activeAgreementWhere(
  date: Date,
): Prisma.AgentAgreementWhereInput {
  const day = toDateOnly(date);
  return {
    status: { in: ['ACTIVE', 'ENDED'] },
    activatedAt: { not: null },
    effectiveFrom: { lte: day },
    OR: [{ effectiveTo: null }, { effectiveTo: { gte: day } }],
  };
}

/** UTC calendar day of `date` (agreement dates are `@db.Date`). */
export function toDateOnly(date: Date | string): Date {
  const d = typeof date === 'string' ? new Date(date) : date;
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}
