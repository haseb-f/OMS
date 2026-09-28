import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PermissionsResolverService } from '../../permissions/permissions-resolver.service';
import { isAgentPortalPermission } from '../../permissions/permission-catalog';
import { ObjectStorageService } from '../../common/storage/object-storage.service';
import type { AgentRequestContext } from '../../auth/guards/jwt-auth.guard';
import {
  storeOrderLineAmount,
  storeOrderPayableTotal,
} from '../../store-orders/store-order-line-amount';
import { ProductsService } from '../../products/products.service';
import { InventoryService } from '../../inventory/inventory.service';
import {
  agentNotFound,
  agentStoreOrderWhere,
  resolveAgentVisibility,
} from '../common/agent-visibility';
import {
  agentFulfillmentFacts,
  aggregateAgentFulfillment,
} from '../common/agent-terms';
import { resolveActiveAgreement } from '../admin/agent-agreements.service';
import { AgentDestinationsService } from '../admin/agent-destinations.service';
import { AgentStatementService } from '../finance/agent-statement.service';
import { AgentPayoutsService } from '../finance/agent-payouts.service';
import { portalAttachmentUrl } from './agent-portal-orders.service';
import type {
  AgentPortalPageQueryDto,
  AgentPortalProductsQueryDto,
  AgentPortalStatementQueryDto,
  AgentPortalStockQueryDto,
} from './dto/agent-portal.dto';

const round2 = (value: number) => Math.round(value * 100) / 100;

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
  ) {}

  private async permissions(agent: AgentRequestContext) {
    return [...(await this.resolver.getPermissions(agent.userId))]
      .filter(isAgentPortalPermission)
      .sort();
  }

  // ── Profile ───────────────────────────────────────────────────────────

  async me(agent: AgentRequestContext) {
    const [profile, user, agreement, permissions] = await Promise.all([
      this.statements.requireAgent(agent.agentId),
      this.prisma.user.findUniqueOrThrow({
        where: { id: agent.userId },
        select: { id: true, fullName: true, username: true, email: true },
      }),
      resolveActiveAgreement(agent.agentId, new Date(), this.prisma),
      this.permissions(agent),
    ]);
    const rates = agreement
      ? await this.prisma.agentShippingRate.findMany({
          where: { agreementId: agreement.id },
          orderBy: [{ countryId: 'asc' }, { city: 'asc' }],
          select: {
            city: true,
            amount: true,
            country: {
              select: { id: true, name: true, nameEn: true, code: true },
            },
          },
        })
      : [];
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
            commissionRatePercent: Number(agreement.commissionRatePercent),
            commissionEarningEvent: agreement.commissionEarningEvent,
            returnCommissionTreatment: agreement.returnCommissionTreatment,
            customerShippingChargeOwner: agreement.customerShippingChargeOwner,
            providerFeesBorneBy: agreement.providerFeesBorneBy,
            shippingFeePerShipment: Number(agreement.shippingFeePerShipment),
            returnFeePerShipment: Number(agreement.returnFeePerShipment),
            serviceFeePerOrder: Number(agreement.serviceFeePerOrder),
            allowAgentDestinations: agreement.allowAgentDestinations,
            payoutHoldDays: agreement.payoutHoldDays,
            shippingRates: rates.map((r) => ({
              country: r.country,
              city: r.city || null,
              amount: Number(r.amount),
            })),
          }
        : null,
    };
  }

  // ── Dashboard ─────────────────────────────────────────────────────────

  /**
   * Agent-wide dashboard for `agent.records.view_all`; otherwise order
   * counts/sales over the caller's own orders. Money figures (sales,
   * returns, collections, balance, payouts) only with `agent.statement.view`.
   */
  async dashboard(agent: AgentRequestContext) {
    const [visibility, canSeeMoney] = await Promise.all([
      resolveAgentVisibility(agent, this.resolver),
      this.resolver.hasPermission(agent.userId, 'agent.statement.view'),
    ]);
    const full = await this.statements.dashboard(agent.agentId);
    const scope = visibility.ownerUserId ? 'OWN' : 'ALL';
    const own = visibility.ownerUserId
      ? await this.ownFulfillmentAndSales(agent, full.agent.currency.id)
      : null;
    return {
      scope,
      agent: full.agent,
      fulfillment: own?.fulfillment ?? full.fulfillment,
      sales: canSeeMoney ? (own?.sales ?? full.sales) : null,
      returns: canSeeMoney && !own ? full.returns : null,
      collections: canSeeMoney ? full.collections : null,
      position: canSeeMoney ? full.position : null,
      payouts: canSeeMoney ? full.payouts : null,
    };
  }

  private async ownFulfillmentAndSales(
    agent: AgentRequestContext,
    currencyId: string,
  ) {
    const visibility = await resolveAgentVisibility(agent, this.resolver);
    const orders = await this.prisma.storeOrder.findMany({
      where: agentStoreOrderWhere(visibility),
      select: {
        agentDispatchedAt: true,
        agentEarnedAt: true,
        currencyId: true,
        merchandiseAmount: true,
        payableTotal: true,
        shippingCharge: true,
        agentTermsSnapshot: true,
        fulfillmentStatus: { select: { code: true } },
        items: {
          where: { deletedAt: null },
          select: {
            quantity: true,
            unitPrice: true,
            agreedAmount: true,
            productId: true,
            product: { select: { isInventoryItem: true } },
          },
        },
        _count: { select: { agentReturns: true } },
      },
    });
    const active = orders.filter(
      (o) => o.fulfillmentStatus?.code !== 'CANCELLED',
    );
    const inCurrency = active.filter((o) => o.currencyId === currencyId);
    const sum = (values: number[]) => round2(values.reduce((s, v) => s + v, 0));
    return {
      fulfillment: aggregateAgentFulfillment(orders.map(agentFulfillmentFacts)),
      sales: {
        merchandiseSalesExShipping: sum(
          inCurrency.map((o) =>
            o.merchandiseAmount != null
              ? Number(o.merchandiseAmount)
              : o.items.reduce((s, i) => s + storeOrderLineAmount(i), 0),
          ),
        ),
        customerShippingCharges: sum(
          inCurrency.map((o) => Number(o.shippingCharge ?? 0)),
        ),
        totalOrderValue: sum(inCurrency.map((o) => storeOrderPayableTotal(o))),
      },
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
            available && p.isInventoryItem ? (available.get(p.id) ?? 0) : null,
        })),
      total: catalog.total,
      page: catalog.page,
      pageSize: catalog.pageSize,
      stockVisible: canSeeStock,
    };
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
