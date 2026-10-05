import { Injectable } from '@nestjs/common';
import { phoneSearchCandidates } from '../../common/phone/phone-number.service';
import { LeadAssignmentMethod, LeadSource, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PermissionsResolverService } from '../../permissions/permissions-resolver.service';
import { LeadsService } from '../../leads/leads.service';
import { LeadAssignmentsService } from '../../leads/assignments/lead-assignments.service';
import type { AgentRequestContext } from '../../auth/guards/jwt-auth.guard';
import {
  agentLeadWhere,
  agentNotFound,
  resolveAgentVisibility,
} from '../common/agent-visibility';
import { agentForbidden, agentUnprocessable } from '../common/agent-errors';
import type {
  CreateAgentLeadDto,
  FindAgentLeadsQueryDto,
} from './dto/agent-lead.dto';

const AGENT_LEAD_SELECT = {
  id: true,
  leadNumber: true,
  customerName: true,
  mobileNumber: true,
  city: true,
  address: true,
  quantity: true,
  fulfillmentMethod: true,
  createdAt: true,
  updatedAt: true,
  agentId: true,
  salesEmployeeId: true,
  salesEmployee: { select: { id: true, fullName: true } },
  country: { select: { id: true, name: true, nameEn: true, code: true } },
  product: { select: { id: true, name: true, displayName: true, sku: true } },
  status: {
    select: { id: true, code: true, name: true, nameEn: true, color: true },
  },
  storeOrder: { select: { id: true, internalOrderId: true } },
  // R6 (spec C1) — the lead's follow-up classification, read-only for agents.
  followUpOutcome: true,
  followUpOutcomeAt: true,
} satisfies Prisma.LeadSelect;

/**
 * Agent leads (spec §6.1): created by the agent's users, scoped to that
 * agent, never distributed to internal staff. Every query is built from the
 * server-verified agent context and the caller's visibility.
 */
@Injectable()
export class AgentLeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resolver: PermissionsResolverService,
    private readonly leads: LeadsService,
    private readonly assignments: LeadAssignmentsService,
  ) {}

  async create(actor: AgentRequestContext, dto: CreateAgentLeadDto) {
    if (dto.productId) {
      const product = await this.prisma.product.findFirst({
        where: {
          id: dto.productId,
          ownerAgentId: actor.agentId,
          deletedAt: null,
          status: 'ACTIVE',
        },
        select: { id: true },
      });
      if (!product) {
        throw agentUnprocessable(
          'PRODUCT_NOT_AVAILABLE',
          'المنتج غير متاح',
          'The product is not available.',
        );
      }
    }
    const lead = await this.leads.create(
      {
        customerName: dto.customerName,
        mobileNumber: dto.mobileNumber,
        countryId: dto.countryId,
        city: dto.city,
        address: dto.address,
        productId: dto.productId,
        quantity: dto.quantity,
        source: LeadSource.MANUAL,
        salesEmployeeId: actor.userId,
      },
      actor.userId,
      {
        agentId: actor.agentId,
        skipFullRefetch: true,
        fulfillmentMethod: dto.fulfillmentMethod,
      },
    );
    return this.get(actor, lead.id);
  }

  async list(actor: AgentRequestContext, query: FindAgentLeadsQueryDto) {
    const visibility = await resolveAgentVisibility(actor, this.resolver);
    const where: Prisma.LeadWhereInput = {
      ...agentLeadWhere(visibility),
      deletedAt: null,
      ...(query.statusCode ? { status: { code: query.statusCode } } : {}),
    };
    const search = query.search?.trim();
    if (search) {
      where.OR = [
        { customerName: { contains: search, mode: 'insensitive' } },
        { mobileNumber: { contains: search } },
        // Phone typed in any format (Arabic digits, national, 00/+): same digit candidates as every list.
        ...phoneSearchCandidates(search).map((digits) => ({
          mobileNumber: { contains: digits },
        })),
        { leadNumber: { contains: search, mode: 'insensitive' } },
      ];
    }
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const [items, total] = await Promise.all([
      this.prisma.lead.findMany({
        where,
        select: AGENT_LEAD_SELECT,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.lead.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async get(actor: AgentRequestContext, leadId: string) {
    const visibility = await resolveAgentVisibility(actor, this.resolver);
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, deletedAt: null, ...agentLeadWhere(visibility) },
      select: AGENT_LEAD_SELECT,
    });
    if (!lead) throw agentNotFound('Lead');
    return lead;
  }

  /** Agent Admin (`agent.team.manage`) assigns a lead within their own agent. */
  async assign(
    actor: AgentRequestContext,
    leadId: string,
    targetUserId: string,
  ) {
    if (
      !(await this.resolver.hasPermission(actor.userId, 'agent.team.manage'))
    ) {
      throw agentForbidden(
        'AGENT_PERMISSION_REQUIRED',
        'إسناد العملاء المحتملين يتطلب صلاحية agent.team.manage',
        'Assigning leads requires the agent.team.manage permission.',
      );
    }
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, agentId: actor.agentId, deletedAt: null },
      select: { id: true },
    });
    if (!lead) throw agentNotFound('Lead');
    // LeadAssignmentsService enforces "same agent, active user" itself.
    await this.assignments.assign(leadId, {
      salesEmployeeId: targetUserId,
      method: LeadAssignmentMethod.MANUAL,
      actorId: actor.userId,
    });
    return this.get(actor, leadId);
  }
}
