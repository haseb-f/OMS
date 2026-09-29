import { Injectable } from '@nestjs/common';
import {
  AgentLedgerEntryType,
  AgentLedgerPostingStatus,
  AgentPayoutStatus,
  PaymentSettlementDocStatus,
  PaymentStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  storeOrderLineAmount,
  storeOrderPayableTotal,
} from '../../store-orders/store-order-line-amount';
import {
  agentFulfillmentFacts,
  aggregateAgentFulfillment,
  readAgentTermsSnapshot,
} from '../common/agent-terms';
import { agentNotFoundError } from '../common/agent-errors';
import {
  computeAgentBalances,
  computeCollectionAvailableAt,
  eligibleCredits,
  paymentStage,
  round2,
  sumByType,
  toMinor,
  fromMinor,
  withRunningBalance,
  type AgentEntryType,
  type LedgerRowLite,
} from './agent-ledger.math';
import { AGENT_SOURCE } from './agent-fulfillment.service';

type Client = Prisma.TransactionClient | PrismaService;

export interface StatementQuery {
  from?: string;
  to?: string;
  currencyId?: string;
}

export interface LedgerListQuery {
  from?: string;
  to?: string;
  entryType?: AgentLedgerEntryType;
  postingStatus?: AgentLedgerPostingStatus;
  storeOrderId?: string;
  page?: number;
  pageSize?: number;
}

/** Inclusive calendar-day bounds (UTC) from `YYYY-MM-DD` strings. */
export function periodBounds(from?: string, to?: string) {
  const start = from ? new Date(`${from.slice(0, 10)}T00:00:00.000Z`) : null;
  const end = to ? new Date(`${to.slice(0, 10)}T23:59:59.999Z`) : null;
  return { start, end };
}

/**
 * Read side of the agent ledger (spec §8, §10): balances with live
 * availability, the statement with opening/running/closing balance and its
 * summary, the dashboard and per-payment stages. Every function takes the
 * agentId explicitly — the portal (B3) passes the server-derived one.
 */
@Injectable()
export class AgentStatementService {
  constructor(private readonly prisma: PrismaService) {}

  async requireAgent(agentId: string, client: Client = this.prisma) {
    const agent = await client.agent.findFirst({
      where: { id: agentId, deletedAt: null },
      select: {
        id: true,
        agentNumber: true,
        name: true,
        legalName: true,
        status: true,
        partnerId: true,
        currencyId: true,
        currency: { select: { id: true, code: true, name: true } },
      },
    });
    if (!agent) throw agentNotFoundError('Agent', 'الوكيل');
    return agent;
  }

  /**
   * Ledger rows for the balance math: collection credits carry their LIVE
   * availability (never trusting a stale persisted value), credits carry
   * Σ allocations of confirmed payouts.
   */
  async loadBalanceRows(
    client: Client,
    agentId: string,
  ): Promise<LedgerRowLite[]> {
    const entries = await client.agentLedgerEntry.findMany({
      where: { agentId },
      orderBy: [{ entryDate: 'asc' }, { entryNumber: 'asc' }],
      include: {
        payoutAllocations: {
          where: { payout: { status: AgentPayoutStatus.CONFIRMED } },
          select: { amount: true },
        },
      },
    });
    const paymentIds = [
      ...new Set(
        entries
          .filter(
            (e) =>
              e.entryType === AgentLedgerEntryType.COLLECTION_RECEIVED &&
              e.paymentId,
          )
          .map((e) => e.paymentId!),
      ),
    ];
    const payments = paymentIds.length
      ? await client.payment.findMany({
          where: { id: { in: paymentIds } },
          select: {
            id: true,
            amount: true,
            settledAmount: true,
            verifiedAt: true,
            paymentMethod: { select: { requiresReconciliation: true } },
            settlementLines: {
              where: {
                settlement: { status: PaymentSettlementDocStatus.POSTED },
              },
              select: { settlement: { select: { settlementDate: true } } },
            },
            storeOrder: {
              select: { agentEarnedAt: true, agentTermsSnapshot: true },
            },
          },
        })
      : [];
    const liveAvailableAt = new Map<string, Date | null>();
    for (const payment of payments) {
      const settledAt = payment.settlementLines.reduce<Date | null>(
        (latest, line) =>
          !latest || line.settlement.settlementDate > latest
            ? line.settlement.settlementDate
            : latest,
        null,
      );
      const holdDays = payment.storeOrder?.agentTermsSnapshot
        ? readAgentTermsSnapshot(payment.storeOrder.agentTermsSnapshot)
            .payoutHoldDays
        : 0;
      liveAvailableAt.set(
        payment.id,
        computeCollectionAvailableAt({
          requiresReconciliation:
            !!payment.paymentMethod?.requiresReconciliation,
          paymentAmount: Number(payment.amount),
          settledAmount: Number(payment.settledAmount),
          settledAt,
          verifiedAt: payment.verifiedAt,
          earnedAt: payment.storeOrder?.agentEarnedAt ?? null,
          holdDays,
        }),
      );
    }
    return entries.map((entry) => ({
      id: entry.id,
      entryNumber: entry.entryNumber,
      entryType: entry.entryType,
      entryDate: entry.entryDate,
      sourceType: entry.sourceType,
      sourceId: entry.sourceId,
      payoutId: entry.payoutId,
      currencyId: entry.currencyId,
      debit: Number(entry.debit),
      credit: Number(entry.credit),
      availableAt:
        entry.entryType === AgentLedgerEntryType.COLLECTION_RECEIVED &&
        entry.paymentId
          ? (liveAvailableAt.get(entry.paymentId) ?? null)
          : entry.availableAt,
      allocated: round2(
        entry.payoutAllocations.reduce((sum, a) => sum + Number(a.amount), 0),
      ),
    }));
  }

  async balances(
    agentId: string,
    client: Client = this.prisma,
    now = new Date(),
  ) {
    const rows = await this.loadBalanceRows(client, agentId);
    return { rows, balances: computeAgentBalances(rows, now) };
  }

  /** Payout preview data (spec §9): balance, available, eligible credits and deductions. */
  async payoutPosition(agentId: string, client: Client = this.prisma) {
    const agent = await this.requireAgent(agentId, client);
    const now = new Date();
    const { rows, balances } = await this.balances(agentId, client, now);
    const balance = balances.find((b) => b.currencyId === agent.currencyId) ?? {
      currencyId: agent.currencyId,
      balance: 0,
      pending: 0,
      availableCredits: 0,
      deductions: 0,
      paidOut: 0,
      available: 0,
      availableRaw: 0,
    };
    const eligible = eligibleCredits(rows, now, agent.currencyId);
    const deductionRows = rows.filter(
      (row) =>
        row.currencyId === agent.currencyId &&
        row.debit > 0 &&
        row.entryType !== 'PAYOUT' &&
        row.entryType !== 'COLLECTION_REVERSAL',
    );
    return {
      agent,
      balance,
      eligible,
      deductions: deductionRows,
      otherCurrencies: balances.filter(
        (b) => b.currencyId !== agent.currencyId,
      ),
    };
  }

  // -------------------------------------------------------------------------
  // Ledger list / pending postings
  // -------------------------------------------------------------------------

  async listLedger(agentId: string, query: LedgerListQuery) {
    await this.requireAgent(agentId);
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, query.pageSize ?? 50));
    const { start, end } = periodBounds(query.from, query.to);
    const where: Prisma.AgentLedgerEntryWhereInput = {
      agentId,
      ...(query.entryType ? { entryType: query.entryType } : {}),
      ...(query.postingStatus ? { postingStatus: query.postingStatus } : {}),
      ...(query.storeOrderId ? { storeOrderId: query.storeOrderId } : {}),
      ...(start || end
        ? {
            entryDate: {
              ...(start ? { gte: start } : {}),
              ...(end ? { lte: end } : {}),
            },
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.agentLedgerEntry.findMany({
        where,
        orderBy: [{ entryDate: 'desc' }, { entryNumber: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { currency: { select: { code: true } } },
      }),
      this.prisma.agentLedgerEntry.count({ where }),
    ]);
    const refs = await this.references(items);
    return {
      items: items.map((item) => this.presentEntry(item, refs)),
      total,
      page,
      pageSize,
    };
  }

  async listPendingPostings(agentId?: string) {
    const items = await this.prisma.agentLedgerEntry.findMany({
      where: {
        postingStatus: AgentLedgerPostingStatus.PENDING_CONFIGURATION,
        ...(agentId ? { agentId } : {}),
      },
      orderBy: [{ entryDate: 'asc' }, { entryNumber: 'asc' }],
      take: 500,
      include: {
        currency: { select: { code: true } },
        agent: { select: { agentNumber: true, name: true } },
      },
    });
    const refs = await this.references(items);
    return {
      items: items.map((item) => ({
        ...this.presentEntry(item, refs),
        agent: item.agent,
      })),
      total: items.length,
    };
  }

  // -------------------------------------------------------------------------
  // Statement + summary
  // -------------------------------------------------------------------------

  async statement(agentId: string, query: StatementQuery) {
    const agent = await this.requireAgent(agentId);
    const currencyId = query.currencyId ?? agent.currencyId;
    const { start, end } = periodBounds(query.from, query.to);
    const openingAgg = start
      ? await this.prisma.agentLedgerEntry.aggregate({
          where: { agentId, currencyId, entryDate: { lt: start } },
          _sum: { debit: true, credit: true },
        })
      : null;
    const opening = openingAgg
      ? round2(
          Number(openingAgg._sum.credit ?? 0) -
            Number(openingAgg._sum.debit ?? 0),
        )
      : 0;
    const entries = await this.prisma.agentLedgerEntry.findMany({
      where: {
        agentId,
        currencyId,
        ...(start || end
          ? {
              entryDate: {
                ...(start ? { gte: start } : {}),
                ...(end ? { lte: end } : {}),
              },
            }
          : {}),
      },
      orderBy: [{ entryDate: 'asc' }, { entryNumber: 'asc' }],
      include: { currency: { select: { code: true } } },
    });
    const refs = await this.references(entries);
    const presented = entries.map((entry) => this.presentEntry(entry, refs));
    const running = withRunningBalance(opening, presented);
    const summary = await this.summaryFor(
      agent,
      currencyId,
      start,
      end,
      presented,
    );
    const currency = await this.prisma.currency.findUnique({
      where: { id: currencyId },
      select: { id: true, code: true, name: true },
    });
    return {
      agent,
      currency,
      period: { from: query.from ?? null, to: query.to ?? null },
      signConvention:
        'Balance = credits − debits = what the company owes the agent. A negative balance means the agent owes the company.',
      openingBalance: opening,
      lines: running.lines,
      closingBalance: running.closing,
      totals: {
        debit: fromMinor(presented.reduce((s, l) => s + toMinor(l.debit), 0)),
        credit: fromMinor(presented.reduce((s, l) => s + toMinor(l.credit), 0)),
      },
      summary,
    };
  }

  async summary(agentId: string, query: StatementQuery) {
    const agent = await this.requireAgent(agentId);
    const currencyId = query.currencyId ?? agent.currencyId;
    const { start, end } = periodBounds(query.from, query.to);
    const entries = await this.prisma.agentLedgerEntry.findMany({
      where: {
        agentId,
        currencyId,
        ...(start || end
          ? {
              entryDate: {
                ...(start ? { gte: start } : {}),
                ...(end ? { lte: end } : {}),
              },
            }
          : {}),
      },
      select: {
        entryType: true,
        debit: true,
        credit: true,
        memoAmount: true,
        basis: true,
        sourceType: true,
      },
    });
    return this.summaryFor(
      agent,
      currencyId,
      start,
      end,
      entries.map((e) => ({
        entryType: e.entryType,
        debit: Number(e.debit),
        credit: Number(e.credit),
        memoAmount: e.memoAmount != null ? Number(e.memoAmount) : null,
        basis: e.basis,
        sourceType: e.sourceType,
      })),
    );
  }

  /**
   * Spec §10 summary: sales figures from the orders (orderDate in period,
   * not cancelled), money figures from the ledger lines of the period, and
   * the current pending / available / paid-out position.
   */
  private async summaryFor(
    agent: { id: string; currencyId: string },
    currencyId: string,
    start: Date | null,
    end: Date | null,
    lines: Array<{
      entryType: AgentEntryType;
      debit: number;
      credit: number;
      memoAmount: number | null;
      basis?: unknown;
      sourceType?: string;
    }>,
  ) {
    const period =
      start || end
        ? {
            ...(start ? { gte: start } : {}),
            ...(end ? { lte: end } : {}),
          }
        : undefined;
    const orders = await this.prisma.storeOrder.findMany({
      where: {
        agentId: agent.id,
        currencyId,
        deletedAt: null,
        ...(period ? { orderDate: period } : {}),
        NOT: { fulfillmentStatus: { code: 'CANCELLED' } },
      },
      select: {
        merchandiseAmount: true,
        discountAmount: true,
        taxAmount: true,
        shippingCharge: true,
        serviceCharge: true,
        payableTotal: true,
        items: {
          where: { deletedAt: null },
          select: { quantity: true, unitPrice: true, agreedAmount: true },
        },
      },
    });
    const sum = (values: number[]) =>
      fromMinor(values.reduce((s, v) => s + toMinor(v), 0));
    const merchandise = sum(
      orders.map((o) =>
        o.merchandiseAmount != null
          ? Number(o.merchandiseAmount)
          : o.items.reduce((s, i) => s + storeOrderLineAmount(i), 0),
      ),
    );
    const returns = await this.prisma.agentOrderReturn.aggregate({
      where: {
        agentId: agent.id,
        storeOrder: { currencyId },
        ...(period ? { createdAt: period } : {}),
      },
      _sum: { merchandiseAmount: true },
      _count: { _all: true },
    });
    const byType = sumByType(lines);
    const t = (type: AgentEntryType) =>
      byType[type] ?? { debit: 0, credit: 0, memo: 0 };
    const commissionEntries = lines.filter((l) => l.entryType === 'COMMISSION');
    const commissionBase = sum(
      commissionEntries.map((l) =>
        Number((l.basis as { base?: number } | null)?.base ?? 0),
      ),
    );
    const rates = [
      ...new Set(
        commissionEntries.map((l) =>
          Number((l.basis as { ratePercent?: number } | null)?.ratePercent),
        ),
      ),
    ].filter((r) => Number.isFinite(r));
    // commission-policy.md A7: commission by class (from the per-line basis;
    // legacy single-rate entries have no class split).
    const byClass = { PRODUCT: zeroClass(), SERVICE: zeroClass() };
    let legacyCommission = 0;
    for (const entry of commissionEntries) {
      const basis = entry.basis as {
        byClass?: typeof byClass;
        unclassifiedCommission?: number;
      } | null;
      const split = basis?.byClass;
      if (!split) {
        legacyCommission = round2(legacyCommission + entry.debit);
        continue;
      }
      legacyCommission = round2(
        legacyCommission + Number(basis?.unclassifiedCommission ?? 0),
      );
      for (const key of ['PRODUCT', 'SERVICE'] as const) {
        const part = split[key];
        if (!part) continue;
        byClass[key] = {
          sales: round2(byClass[key].sales + part.sales),
          base: round2(byClass[key].base + part.base),
          commission: round2(byClass[key].commission + part.commission),
        };
      }
    }
    const companyRefunds = t('CUSTOMER_REFUND').debit;
    const agentRefunds = t('CUSTOMER_REFUND').memo;
    const adjustments = t('ADJUSTMENT');
    const { balances } = await this.balances(agent.id);
    const position = balances.find((b) => b.currencyId === currencyId);
    return {
      currencyId,
      orders: {
        count: orders.length,
        merchandiseSalesExShipping: merchandise,
        customerShippingCharges: sum(
          orders.map((o) => Number(o.shippingCharge ?? 0)),
        ),
        serviceCharges: sum(orders.map((o) => Number(o.serviceCharge ?? 0))),
        totalOrderValue: sum(orders.map((o) => storeOrderPayableTotal(o))),
        discounts: sum(orders.map((o) => Number(o.discountAmount ?? 0))),
        tax: sum(orders.map((o) => Number(o.taxAmount ?? 0))),
      },
      returns: {
        count: returns._count._all,
        merchandiseReturned: round2(
          Number(returns._sum.merchandiseAmount ?? 0),
        ),
      },
      refunds: { paidByCompany: companyRefunds, paidByAgent: agentRefunds },
      commission: {
        base: commissionBase,
        ratePercent: rates.length === 1 ? rates[0] : null,
        charged: t('COMMISSION').debit,
        reversed: t('COMMISSION_REVERSAL').credit,
        net: round2(t('COMMISSION').debit - t('COMMISSION_REVERSAL').credit),
        byClass,
        legacySingleRate: legacyCommission,
      },
      deductions: {
        commission: round2(
          t('COMMISSION').debit - t('COMMISSION_REVERSAL').credit,
        ),
        customerShippingRetained: round2(
          t('CUSTOMER_SHIPPING_RETAINED').debit -
            t('CUSTOMER_SHIPPING_RETAINED_REVERSAL').credit,
        ),
        shippingFees: t('SHIPPING_FEE').debit,
        returnFees: t('RETURN_FEE').debit,
        serviceFees: t('SERVICE_FEE').debit,
        providerFees: t('PROVIDER_FEE').debit,
        customerRefunds: companyRefunds,
      },
      adjustments: { credit: adjustments.credit, debit: adjustments.debit },
      collections: {
        byCompany: round2(
          t('COLLECTION_RECEIVED').credit - t('COLLECTION_REVERSAL').debit,
        ),
        byAgent: t('COLLECTION_BY_AGENT').memo,
      },
      payouts: {
        paid: t('PAYOUT').debit,
        reversed: t('PAYOUT_REVERSAL').credit,
        net: round2(t('PAYOUT').debit - t('PAYOUT_REVERSAL').credit),
      },
      position: {
        balance: position?.balance ?? 0,
        pending: position?.pending ?? 0,
        available: position?.available ?? 0,
        paidOut: position?.paidOut ?? 0,
      },
    };
  }

  // -------------------------------------------------------------------------
  // Dashboard + payment stages (portal-reusable)
  // -------------------------------------------------------------------------

  async dashboard(agentId: string) {
    const agent = await this.requireAgent(agentId);
    const orders = await this.prisma.storeOrder.findMany({
      where: { agentId, deletedAt: null },
      select: {
        id: true,
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
    const fulfillment = aggregateAgentFulfillment(
      orders.map(agentFulfillmentFacts),
    );
    const inCurrency = active.filter((o) => o.currencyId === agent.currencyId);
    const sum = (values: number[]) =>
      fromMinor(values.reduce((s, v) => s + toMinor(v), 0));
    const returns = await this.prisma.agentOrderReturn.aggregate({
      where: { agentId },
      _sum: { merchandiseAmount: true },
    });
    const declared = await this.prisma.payment.aggregate({
      where: {
        agentId,
        deletedAt: null,
        status: { in: [PaymentStatus.PENDING, PaymentStatus.MATCHED] },
      },
      _sum: { amount: true },
      _count: { _all: true },
    });
    const payouts = await this.prisma.agentPayout.aggregate({
      where: { agentId, status: AgentPayoutStatus.CONFIRMED },
      _sum: { amount: true },
      _count: { _all: true },
    });
    const lastPayout = await this.prisma.agentPayout.findFirst({
      where: { agentId, status: AgentPayoutStatus.CONFIRMED },
      orderBy: { payoutDate: 'desc' },
      select: { id: true, payoutNumber: true, amount: true, payoutDate: true },
    });
    const { balances } = await this.balances(agentId);
    const position = balances.find((b) => b.currencyId === agent.currencyId);
    return {
      agent: {
        id: agent.id,
        agentNumber: agent.agentNumber,
        name: agent.name,
        currency: agent.currency,
      },
      fulfillment,
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
      returns: {
        merchandiseReturned: round2(
          Number(returns._sum.merchandiseAmount ?? 0),
        ),
      },
      collections: {
        awaitingVerificationCount: declared._count._all,
        awaitingVerificationAmount: round2(Number(declared._sum.amount ?? 0)),
      },
      position: {
        balance: position?.balance ?? 0,
        pending: position?.pending ?? 0,
        available: position?.available ?? 0,
        paidOut: position?.paidOut ?? 0,
      },
      payouts: {
        count: payouts._count._all,
        total: round2(Number(payouts._sum.amount ?? 0)),
        last: lastPayout,
      },
    };
  }

  /** Payments of the agent's orders with their stage (spec §7). */
  async paymentStages(agentId: string, filter: { storeOrderId?: string } = {}) {
    await this.requireAgent(agentId);
    const payments = await this.prisma.payment.findMany({
      where: {
        agentId,
        deletedAt: null,
        ...(filter.storeOrderId ? { storeOrderId: filter.storeOrderId } : {}),
      },
      orderBy: { paymentDate: 'desc' },
      take: 500,
      select: {
        id: true,
        paymentNumber: true,
        paymentDate: true,
        amount: true,
        settledAmount: true,
        status: true,
        destinationOwnership: true,
        verifiedAt: true,
        rejectionReason: true,
        currency: { select: { code: true } },
        paymentMethod: { select: { name: true, requiresReconciliation: true } },
        storeOrder: {
          select: { id: true, internalOrderId: true, agentEarnedAt: true },
        },
      },
    });
    const rows = await this.loadBalanceRows(this.prisma, agentId);
    const reversedKeys = new Set(
      rows
        .filter((r) => r.entryType === 'COLLECTION_REVERSAL')
        .map((r) => `${r.sourceType}|${r.sourceId}`),
    );
    const credits = await this.prisma.agentLedgerEntry.findMany({
      where: {
        agentId,
        entryType: AgentLedgerEntryType.COLLECTION_RECEIVED,
        paymentId: { in: payments.map((p) => p.id) },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, paymentId: true, sourceType: true, sourceId: true },
    });
    const rowById = new Map(rows.map((r) => [r.id, r]));
    const now = new Date();
    return payments.map((payment) => {
      const credit = credits.find((c) => c.paymentId === payment.id);
      const row = credit ? rowById.get(credit.id) : undefined;
      const stage = paymentStage({
        status: payment.status,
        destinationOwnership: payment.destinationOwnership,
        requiresReconciliation: !!payment.paymentMethod?.requiresReconciliation,
        amount: Number(payment.amount),
        settledAmount: Number(payment.settledAmount),
        earnedAt: payment.storeOrder?.agentEarnedAt ?? null,
        credit: row
          ? {
              amount: row.credit,
              availableAt: row.availableAt,
              allocated: row.allocated ?? 0,
              reversed: reversedKeys.has(`${row.sourceType}|${row.sourceId}`),
            }
          : null,
        now,
      });
      return {
        ...payment,
        amount: Number(payment.amount),
        settledAmount: Number(payment.settledAmount),
        stage,
        availableAt: row?.availableAt ?? null,
        paidOutAmount: row?.allocated ?? 0,
      };
    });
  }

  // -------------------------------------------------------------------------
  // Presentation
  // -------------------------------------------------------------------------

  private async references(
    entries: Array<{
      storeOrderId: string | null;
      paymentId: string | null;
      payoutId: string | null;
      sourceType: string;
      sourceId: string;
      journalEntryId: string | null;
    }>,
  ) {
    const ids = (pick: (e: (typeof entries)[number]) => string | null) => [
      ...new Set(entries.map(pick).filter((v): v is string => !!v)),
    ];
    const orderIds = ids((e) => e.storeOrderId);
    const paymentIds = ids((e) => e.paymentId);
    const payoutIds = ids((e) => e.payoutId);
    const journalIds = ids((e) => e.journalEntryId);
    const lineIds = ids((e) =>
      e.sourceType === AGENT_SOURCE.SETTLEMENT_LINE ||
      e.sourceType === AGENT_SOURCE.SETTLEMENT_LINE_REVERSAL
        ? e.sourceId
        : null,
    );
    const returnIds = ids((e) =>
      e.sourceType === AGENT_SOURCE.RETURN ? e.sourceId : null,
    );
    const [orders, payments, payouts, journals, lines, returns] =
      await Promise.all([
        this.prisma.storeOrder.findMany({
          where: { id: { in: orderIds } },
          select: { id: true, internalOrderId: true },
        }),
        this.prisma.payment.findMany({
          where: { id: { in: paymentIds } },
          select: { id: true, paymentNumber: true },
        }),
        this.prisma.agentPayout.findMany({
          where: { id: { in: payoutIds } },
          select: { id: true, payoutNumber: true },
        }),
        this.prisma.journalEntry.findMany({
          where: { id: { in: journalIds } },
          select: { id: true, entryNumber: true },
        }),
        this.prisma.paymentSettlementLine.findMany({
          where: { id: { in: lineIds } },
          select: {
            id: true,
            settlement: { select: { id: true, settlementNumber: true } },
          },
        }),
        this.prisma.agentOrderReturn.findMany({
          where: { id: { in: returnIds } },
          select: { id: true, returnNumber: true },
        }),
      ]);
    return {
      orders: new Map(orders.map((o) => [o.id, o.internalOrderId])),
      payments: new Map(payments.map((p) => [p.id, p.paymentNumber])),
      payouts: new Map(payouts.map((p) => [p.id, p.payoutNumber])),
      journals: new Map(journals.map((j) => [j.id, j.entryNumber])),
      settlements: new Map(lines.map((l) => [l.id, l.settlement])),
      returns: new Map(returns.map((r) => [r.id, r.returnNumber])),
    };
  }

  private presentEntry(
    entry: {
      id: string;
      entryNumber: string;
      entryType: AgentLedgerEntryType;
      entryDate: Date;
      sourceType: string;
      sourceId: string;
      storeOrderId: string | null;
      paymentId: string | null;
      payoutId: string | null;
      debit: Prisma.Decimal;
      credit: Prisma.Decimal;
      memoAmount: Prisma.Decimal | null;
      basis: Prisma.JsonValue;
      description: string;
      availableAt: Date | null;
      postingStatus: AgentLedgerPostingStatus;
      journalEntryId: string | null;
      currencyId: string;
      currency?: { code: string };
    },
    refs: Awaited<ReturnType<AgentStatementService['references']>>,
  ) {
    const settlement = refs.settlements.get(entry.sourceId) ?? null;
    return {
      id: entry.id,
      entryNumber: entry.entryNumber,
      entryType: entry.entryType,
      entryDate: entry.entryDate,
      description: entry.description,
      debit: Number(entry.debit),
      credit: Number(entry.credit),
      memoAmount: entry.memoAmount != null ? Number(entry.memoAmount) : null,
      basis: entry.basis,
      currencyId: entry.currencyId,
      currencyCode: entry.currency?.code ?? null,
      availableAt: entry.availableAt,
      postingStatus: entry.postingStatus,
      sourceType: entry.sourceType,
      sourceId: entry.sourceId,
      references: {
        storeOrderId: entry.storeOrderId,
        orderNumber: entry.storeOrderId
          ? (refs.orders.get(entry.storeOrderId) ?? null)
          : null,
        paymentId: entry.paymentId,
        paymentNumber: entry.paymentId
          ? (refs.payments.get(entry.paymentId) ?? null)
          : null,
        payoutId: entry.payoutId,
        payoutNumber: entry.payoutId
          ? (refs.payouts.get(entry.payoutId) ?? null)
          : null,
        settlementId: settlement?.id ?? null,
        settlementNumber: settlement?.settlementNumber ?? null,
        returnNumber: refs.returns.get(entry.sourceId) ?? null,
        journalEntryId: entry.journalEntryId,
        journalEntryNumber: entry.journalEntryId
          ? (refs.journals.get(entry.journalEntryId) ?? null)
          : null,
      },
    };
  }
}

function zeroClass() {
  return { sales: 0, base: 0, commission: 0 };
}
