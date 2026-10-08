import { HttpException, Injectable } from '@nestjs/common';
import { Prisma, ProductSupplyMethod } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PermissionsResolverService } from '../../permissions/permissions-resolver.service';
import { isAgentPortalPermission } from '../../permissions/permission-catalog';
import { ObjectStorageService } from '../../common/storage/object-storage.service';
import type { AgentRequestContext } from '../../auth/guards/jwt-auth.guard';
import { ProductsService } from '../../products/products.service';
import { InventoryService } from '../../inventory/inventory.service';
import { isStockAffecting } from '../../inventory/stock-lines/stock-line-resolver';
import { RecipeInsightsService } from '../../recipes/recipe-insights.service';
import {
  agentLeadWhere,
  agentNotFound,
  agentStoreOrderWhere,
  resolveAgentReportScope,
  resolveAgentVisibility,
  type AgentVisibility,
} from '../common/agent-visibility';
import {
  AGENT_ORDER_FIGURES_SELECT,
  agentOrderFigures,
  emptyLeadCounts,
  sumLeadCounts,
  teamBreakdown,
} from '../overview/agent-order-figures';
import {
  agentTeamMembers,
  leadCountsBy,
} from '../overview/agent-overview-queries';
import { resolveActiveAgreement } from '../admin/agent-agreements.service';
import { shippingAgreementTerms } from '../shipping-agreements/shipping-agreement-resolution';
import { AgentDestinationsService } from '../admin/agent-destinations.service';
import { AgentCommissionReportService } from '../finance/agent-commission-report.service';
import { AgentStatementService } from '../finance/agent-statement.service';
import { AgentPayoutsService } from '../finance/agent-payouts.service';
import { portalAttachmentUrl } from './agent-portal-orders.service';
import type {
  AgentPortalPageQueryDto,
  AgentPortalProductsQueryDto,
  AgentPortalStatementQueryDto,
  AgentPortalStockQueryDto,
} from './dto/agent-portal.dto';

/**
 * Calculation inputs an agent may see on its statement (S8). Everything else
 * in `basis` is internal (settlement batch fee, paying account id/name,
 * counter accounts, internal entry ids) and is dropped.
 */
const PORTAL_BASIS_KEYS = [
  'base',
  'ratePercent',
  'merchandise',
  'returnedBeforeEarning',
  'returnedAfterEarningCumulative',
  'perShipment',
  'perReturn',
  'returnNumber',
  'agreementNumber',
  'shippingCharge',
  // O1 — the agent sees the customer shipping (C) and its contractual
  // shipping fee (F) only, never the difference attribution.
  'agentShippingCharge',
  'serviceFeePerOrder',
  'customerServiceCharge',
  'paymentNumber',
  'receiptNumber',
  'payoutNumber',
  'reference',
  'lineAmount',
  'reverses',
  'direction',
  'paidBy',
  'reason',
] as const;

export function portalBasis(basis: unknown): Record<string, unknown> | null {
  if (!basis || typeof basis !== 'object' || Array.isArray(basis)) return null;
  const source = basis as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of PORTAL_BASIS_KEYS) {
    if (key in source) out[key] = source[key];
  }
  return out;
}

/**
 * Agent portal reads (spec §3, §8–§10): profile, dashboard, products, stock,
 * payment destinations, statement, payouts and evidence files. The agent id
 * always comes from the verified `AgentRequestContext`; responses are shaped
 * for external users (no journal/posting internals, no staff emails, no
 * internal notes).
 */
@Injectable()
export class AgentPortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resolver: PermissionsResolverService,
    private readonly productsService: ProductsService,
    private readonly inventory: InventoryService,
    private readonly destinations: AgentDestinationsService,
    private readonly statements: AgentStatementService,
    private readonly payoutsService: AgentPayoutsService,
    private readonly storage: ObjectStorageService,
    private readonly commissionReport: AgentCommissionReportService,
    private readonly recipeInsights: RecipeInsightsService,
  ) {}

  private async permissions(agent: AgentRequestContext) {
    return [...(await this.resolver.getPermissions(agent.userId))]
      .filter(isAgentPortalPermission)
      .sort();
  }

  // ── Profile ───────────────────────────────────────────────────────────

  async me(agent: AgentRequestContext) {
    const now = new Date();
    const [profile, user, agreement, shippingAgreement, permissions] =
      await Promise.all([
        this.statements.requireAgent(agent.agentId),
        this.prisma.user.findUniqueOrThrow({
          where: { id: agent.userId },
          select: { id: true, fullName: true, username: true, email: true },
        }),
        resolveActiveAgreement(agent.agentId, now, this.prisma),
        // R15 D15-13 — the shipping agreement in force today (charges only).
        shippingAgreementTerms(agent.agentId, now, this.prisma),
        this.permissions(agent),
      ]);
    return {
      user: { ...user, agentRole: agent.agentRole, permissions },
      agent: {
        id: profile.id,
        agentNumber: profile.agentNumber,
        name: profile.name,
        legalName: profile.legalName,
        status: profile.status,
        currency: profile.currency,
      },
      agreement: agreement
        ? {
            agreementNumber: agreement.agreementNumber,
            effectiveFrom: agreement.effectiveFrom,
            effectiveTo: agreement.effectiveTo,
            currencyId: agreement.currencyId,
            productCommissionRatePercent: Number(
              agreement.productCommissionRatePercent,
            ),
            serviceCommissionRatePercent: Number(
              agreement.serviceCommissionRatePercent,
            ),
            shippingPolicy: agreement.shippingPolicy,
            commissionEarningEvent: agreement.commissionEarningEvent,
            returnCommissionTreatment: agreement.returnCommissionTreatment,
            customerShippingChargeOwner: agreement.customerShippingChargeOwner,
            providerFeesBorneBy: agreement.providerFeesBorneBy,
            shippingFeePerShipment: Number(agreement.shippingFeePerShipment),
            returnFeePerShipment: Number(agreement.returnFeePerShipment),
            serviceFeePerOrder: Number(agreement.serviceFeePerOrder),
            allowAgentDestinations: agreement.allowAgentDestinations,
            payoutHoldDays: agreement.payoutHoldDays,
          }
        : null,
      shippingAgreement,
    };
  }

  // ── Dashboard ─────────────────────────────────────────────────────────

  /**
   * Agent portal dashboard (R15 W1). Two scopes, decided per figure:
   *  - RECORDS (`resolveAgentVisibility`: the whole agent with
   *    `agent.records.view_all`, else the caller's own) for the counts the user
   *    can browse in the lists anyway — `fulfillment` (orders by stage) and
   *    `leads` (with `agent.leads.view`); `scope` reports it.
   *  - REPORTS (`resolveAgentReportScope`, D15-18: the whole team only with
   *    `agent.reports.view_team`, else the caller's own) for every sales /
   *    money figure — browsing every record never opens colleagues' sales:
   *    - `own` (no team scope): the caller's own order value, delivered value
   *      and returns — their own work, no further right needed;
   *    - `sales`: team or own sales, with `agent.statement.view`;
   *    - `returns` / `collections` / `position` / `payouts`: agent-level money
   *      (never attributable to one seller), team scope with
   *      `agent.statement.view` only;
   *    - `team`: the per-employee breakdown, team scope.
   */
  async dashboard(agent: AgentRequestContext) {
    const [records, report, canSeeMoney, canSeeLeads, profile] =
      await Promise.all([
        resolveAgentVisibility(agent, this.resolver),
        resolveAgentReportScope(agent, this.resolver),
        this.resolver.hasPermission(agent.userId, 'agent.statement.view'),
        this.resolver.hasPermission(agent.userId, 'agent.leads.view'),
        this.statements.requireAgent(agent.agentId),
      ]);
    const ownRecords = records.ownerUserId !== null;
    const team = report.ownerUserId === null;
    // One read over the wider of the two scopes; each figure filters to its own.
    const widest: AgentVisibility =
      ownRecords && !team ? records : { ...records, ownerUserId: null };
    const [orders, leadGroups, members, money] = await Promise.all([
      this.prisma.storeOrder.findMany({
        where: agentStoreOrderWhere(widest),
        select: AGENT_ORDER_FIGURES_SELECT,
      }),
      canSeeLeads || team
        ? leadCountsBy(this.prisma, agentLeadWhere(widest), 'salesEmployeeId')
        : null,
      team ? agentTeamMembers(this.prisma, agent.agentId) : null,
      canSeeMoney && team
        ? this.statements.dashboardMoney(agent.agentId, profile.currencyId)
        : null,
    ]);
    const ordersOf = (scope: AgentVisibility) =>
      scope.ownerUserId
        ? orders.filter((order) => order.employeeId === scope.ownerUserId)
        : orders;
    const recordFigures = agentOrderFigures(
      ordersOf(records),
      profile.currencyId,
    );
    const reportFigures = agentOrderFigures(
      ordersOf(report),
      profile.currencyId,
    );
    return {
      scope: ownRecords ? 'OWN' : 'ALL',
      agent: {
        id: profile.id,
        agentNumber: profile.agentNumber,
        name: profile.name,
        currency: profile.currency,
      },
      fulfillment: recordFigures.fulfillment,
      leads:
        canSeeLeads && leadGroups
          ? ownRecords
            ? (leadGroups.get(agent.userId) ?? emptyLeadCounts())
            : sumLeadCounts(leadGroups.values())
          : null,
      own: team
        ? null
        : {
            orderValue: reportFigures.sales.totalOrderValue,
            deliveredValue: reportFigures.delivered.value,
            deliveredCount: reportFigures.delivered.count,
            returnCount: reportFigures.returnCount,
          },
      sales: canSeeMoney ? reportFigures.sales : null,
      returns: money?.returns ?? null,
      collections: money?.collections ?? null,
      position: money?.position ?? null,
      payouts: money?.payouts ?? null,
      team:
        members && leadGroups
          ? teamBreakdown(members, orders, leadGroups, profile.currencyId, {
              money: true,
              // R15 review L4 — lead counts only for a user who sees leads.
              leads: canSeeLeads,
            })
          : null,
    };
  }

  /** Active countries (master data) for lead / order destinations. */
  countries() {
    return this.prisma.country.findMany({
      where: { deletedAt: null, isActive: true },
      select: { id: true, name: true, nameEn: true, code: true },
      orderBy: { name: 'asc' },
    });
  }

  // ── Products + stock ──────────────────────────────────────────────────

  async products(
    agent: AgentRequestContext,
    query: AgentPortalProductsQueryDto,
  ) {
    const [catalog, canSeeStock] = await Promise.all([
      this.productsService.findSellableCatalog({
        agentId: agent.agentId,
        isSellable: true,
        search: query.search,
        page: query.page ?? 1,
        pageSize: query.pageSize ?? 20,
      }),
      this.resolver.hasPermission(agent.userId, 'agent.stock.view'),
    ]);
    let available: Map<string, number> | null = null;
    if (canSeeStock) {
      const stock = await this.inventory.getAgentStock(agent.agentId);
      available = new Map();
      for (const row of stock.items) {
        available.set(
          row.productId,
          (available.get(row.productId) ?? 0) + row.available,
        );
      }
      // R13 — a kit owns no stock: what its components allow (min over
      // components of ⌊available ÷ per kit⌋), from the one shared rule.
      for (const p of catalog.items) {
        if (p.supplyMethod === ProductSupplyMethod.KIT) {
          available.set(p.id, await this.kitAvailable(p.id));
        }
      }
    }
    return {
      items: catalog.items
        // Defense in depth: the catalog is already filtered by owner.
        .filter((p) => p.ownerAgentId === agent.agentId)
        .map((p) => ({
          id: p.id,
          sku: p.sku,
          name: p.name,
          nameEn: p.nameEn,
          displayName: p.displayName,
          type: p.type,
          isInventoryItem: p.isInventoryItem,
          listPrice: p.salesPrice == null ? null : Number(p.salesPrice),
          unit: p.unit,
          category: p.category,
          available:
            available && isStockAffecting(p)
              ? (available.get(p.id) ?? 0)
              : null,
        })),
      total: catalog.total,
      page: catalog.page,
      pageSize: catalog.pageSize,
      stockVisible: canSeeStock,
    };
  }

  /** Kits the component stock allows now; a kit without a usable active recipe offers none. */
  private async kitAvailable(productId: string): Promise<number> {
    try {
      return (await this.recipeInsights.availability(productId)).available;
    } catch (error) {
      if (error instanceof HttpException) return 0;
      throw error;
    }
  }

  async stock(agent: AgentRequestContext, query: AgentPortalStockQueryDto) {
    const stock = await this.inventory.getAgentStock(agent.agentId, {
      productId: query.productId,
      warehouseId: query.warehouseId,
    });
    return { items: stock.items, totals: stock.totals };
  }

  // ── Payment destinations ──────────────────────────────────────────────

  async paymentDestinations(agent: AgentRequestContext) {
    const rows = await this.destinations.list(agent.agentId, true);
    return rows
      .filter((row) => row.paymentMethod.isActive)
      .map((row) => ({
        id: row.id,
        label: row.label,
        ownership: row.ownership,
        details: row.details,
        method: { id: row.paymentMethod.id, name: row.paymentMethod.name },
      }));
  }

  // ── Statement ─────────────────────────────────────────────────────────

  async statement(
    agent: AgentRequestContext,
    query: AgentPortalStatementQueryDto,
  ) {
    const statement = await this.statements.statement(agent.agentId, {
      from: query.from,
      to: query.to,
    });
    return {
      agent: {
        id: statement.agent.id,
        agentNumber: statement.agent.agentNumber,
        name: statement.agent.name,
        legalName: statement.agent.legalName,
      },
      currency: statement.currency,
      period: statement.period,
      signConvention: statement.signConvention,
      openingBalance: statement.openingBalance,
      lines: statement.lines.map((line) => ({
        id: line.id,
        entryNumber: line.entryNumber,
        entryType: line.entryType,
        entryDate: line.entryDate,
        description: line.description,
        debit: line.debit,
        credit: line.credit,
        memoAmount: line.memoAmount,
        memo: line.memo,
        balance: line.balance,
        basis: portalBasis(line.basis),
        currencyCode: line.currencyCode,
        availableAt: line.availableAt,
        references: {
          storeOrderId: line.references.storeOrderId,
          orderNumber: line.references.orderNumber,
          paymentNumber: line.references.paymentNumber,
          payoutId: line.references.payoutId,
          payoutNumber: line.references.payoutNumber,
          settlementNumber: line.references.settlementNumber,
          returnNumber: line.references.returnNumber,
        },
      })),
      closingBalance: statement.closingBalance,
      totals: statement.totals,
      summary: statement.summary,
    };
  }

  summary(agent: AgentRequestContext, query: AgentPortalStatementQueryDto) {
    return this.statements.summary(agent.agentId, {
      from: query.from,
      to: query.to,
    });
  }

  /** Item-level commission and shipping-recovery report (commission-policy.md A7), own agent only. */
  commissionReportFor(
    agent: AgentRequestContext,
    query: AgentPortalStatementQueryDto,
  ) {
    // PORTAL audience: no carrier cost, no margin (spec 2E).
    return this.commissionReport.report(
      agent.agentId,
      { from: query.from, to: query.to },
      'PORTAL',
    );
  }

  /** Same data as the statement, plus print metadata for the shared statement template. */
  async statementPrintData(
    agent: AgentRequestContext,
    query: AgentPortalStatementQueryDto,
  ) {
    const [statement, user] = await Promise.all([
      this.statement(agent, query),
      this.prisma.user.findUniqueOrThrow({
        where: { id: agent.userId },
        select: { fullName: true },
      }),
    ]);
    return {
      document: {
        kind: 'AGENT_STATEMENT',
        orientation: 'landscape',
        printedAt: new Date(),
        printedBy: user.fullName,
      },
      ...statement,
    };
  }

  // ── Payouts ───────────────────────────────────────────────────────────

  async payouts(agent: AgentRequestContext, query: AgentPortalPageQueryDto) {
    const result = await this.payoutsService.list(agent.agentId, query);
    return {
      ...result,
      items: result.items.map((p) => ({
        id: p.id,
        payoutNumber: p.payoutNumber,
        status: p.status,
        amount: p.amount,
        currency: p.currency,
        payoutDate: p.payoutDate,
        reference: p.reference,
        payingAccount: { name: p.payingAccount.name },
        reversedAt: p.reversedAt,
        attachmentCount: p._count.attachments,
        allocationCount: p._count.allocations,
      })),
    };
  }

  async payout(agent: AgentRequestContext, payoutId: string) {
    const p = await this.payoutsService.detail(payoutId, agent.agentId);
    const orderIds = [
      ...new Set(
        p.allocations
          .map((a) => a.ledgerEntry.storeOrderId)
          .filter((id): id is string => !!id),
      ),
    ];
    const orders = orderIds.length
      ? await this.prisma.storeOrder.findMany({
          where: { id: { in: orderIds }, agentId: agent.agentId },
          select: { id: true, internalOrderId: true },
        })
      : [];
    const orderNumber = new Map(orders.map((o) => [o.id, o.internalOrderId]));
    return {
      id: p.id,
      payoutNumber: p.payoutNumber,
      status: p.status,
      amount: p.amount,
      currency: p.currency,
      payoutDate: p.payoutDate,
      reference: p.reference,
      payingAccount: { name: p.payingAccount.name },
      reversedAt: p.reversedAt,
      reversalReason: p.reversalReason,
      allocations: p.allocations.map((a) => ({
        amount: a.amount,
        entryNumber: a.ledgerEntry.entryNumber,
        entryType: a.ledgerEntry.entryType,
        description: a.ledgerEntry.description,
        storeOrderId: a.ledgerEntry.storeOrderId,
        orderNumber: a.ledgerEntry.storeOrderId
          ? (orderNumber.get(a.ledgerEntry.storeOrderId) ?? null)
          : null,
      })),
      attachments: p.attachments.map((a) => ({
        attachmentId: a.attachmentId,
        fileName: a.fileName,
        mimeType: a.mimeType,
        sizeBytes: a.sizeBytes,
        createdAt: a.createdAt,
        fileUrl: portalAttachmentUrl(a.attachmentId),
      })),
    };
  }

  // ── Evidence files ────────────────────────────────────────────────────

  /**
   * Serves a finalized attachment only when it is linked to a payment /
   * receipt of an order visible to the caller, or (with
   * `agent.payouts.view`) to a payout of the caller's agent. Anything else
   * — another agent's file, an internal file, a staged file — is 404.
   */
  async getAttachmentFile(agent: AgentRequestContext, attachmentId: string) {
    const attachment = await this.prisma.attachment.findFirst({
      where: { id: attachmentId, deletedAt: null, finalizedAt: { not: null } },
      select: {
        id: true,
        storageKey: true,
        mimeType: true,
        originalName: true,
      },
    });
    if (!attachment || !(await this.canReadAttachment(agent, attachment.id))) {
      throw agentNotFound('Attachment');
    }
    const body = await this.storage.get(attachment.storageKey);
    return {
      body,
      mimeType: attachment.mimeType,
      fileName: attachment.originalName,
    };
  }

  private async canReadAttachment(
    agent: AgentRequestContext,
    attachmentId: string,
  ): Promise<boolean> {
    const visibility = await resolveAgentVisibility(agent, this.resolver);
    const orderWhere: Prisma.StoreOrderWhereInput =
      agentStoreOrderWhere(visibility);
    const [paymentLink, receipt] = await Promise.all([
      this.prisma.paymentAttachment.findFirst({
        where: {
          attachmentId,
          deletedAt: null,
          // Only evidence this agent's users uploaded (S8) — internal
          // Finance evidence on the same claim is not agent-visible.
          attachment: { uploadedBy: { agentId: agent.agentId } },
          payment: {
            agentId: agent.agentId,
            deletedAt: null,
            storeOrder: orderWhere,
          },
        },
        select: { id: true },
      }),
      this.prisma.storeOrderReceipt.findFirst({
        where: {
          attachmentId,
          deletedAt: null,
          storeOrder: orderWhere,
          attachment: { uploadedBy: { agentId: agent.agentId } },
        },
        select: { id: true },
      }),
    ]);
    if (paymentLink || receipt) return true;
    const payoutLink = await this.prisma.agentPayoutAttachment.findFirst({
      where: { attachmentId, payout: { agentId: agent.agentId } },
      select: { id: true },
    });
    if (!payoutLink) return false;
    return this.resolver.hasPermission(agent.userId, 'agent.payouts.view');
  }
}
