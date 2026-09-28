import { Injectable } from '@nestjs/common';
import {
  AgentLedgerEntryType,
  PaymentSettlementDocStatus,
  Prisma,
} from '@prisma/client';
import { AGENT_POSTING_SOURCE } from '../../accounting/posting-providers/agent-ledger-posting.provider';
import { AccountMappingService } from '../../accounting/account-mapping/account-mapping.service';
import { PostingEngineService } from '../../accounting/posting-engine/posting-engine.service';
import { readAgentTermsSnapshot } from '../common/agent-terms';
import { agentConflict, agentUnprocessable } from '../common/agent-errors';
import { AgentLedgerService } from './agent-ledger.service';
import {
  AGENT_SOURCE,
  AgentFulfillmentService,
} from './agent-fulfillment.service';
import { allocateSettlementFee, round2 } from './agent-ledger.math';

type Tx = Prisma.TransactionClient;

/**
 * Payment-side agent hooks (spec §7, §8): company-destination confirmation,
 * receipt reversal, provider settlement fees and availability refresh. Called
 * inside the existing Payments / Reconciliation / Settlement transactions.
 * Company orders (payment.agentId null) are never touched.
 */
@Injectable()
export class AgentCollectionHooksService {
  constructor(
    private readonly ledger: AgentLedgerService,
    private readonly fulfillment: AgentFulfillmentService,
    private readonly accountMapping: AccountMappingService,
    private readonly postingEngine: PostingEngineService,
  ) {}

  /**
   * Refuses to confirm an agent-order payment through the company flow when
   * it is not company cash, when the agent accounts are missing (never falls
   * back to customer AR), or when its currency differs from the agreement's.
   */
  async assertCompanyCollectionAllowed(
    tx: Tx,
    payment: {
      paymentNumber: string;
      agentId: string | null;
      destinationOwnership: string | null;
      currencyId: string;
      storeOrderId: string | null;
    },
  ) {
    if (!payment.agentId) return;
    if (payment.destinationOwnership === 'AGENT') {
      throw agentConflict(
        'AGENT_DESTINATION_USE_AGENT_COLLECTIONS',
        `الدفعة ${payment.paymentNumber} استلمها الوكيل مباشرة — راجعها من طابور تحصيلات الوكلاء`,
        `Payment ${payment.paymentNumber} was received by the agent — review it in Finance → Agent collections (it is not company cash).`,
      );
    }
    await this.ledger.assertAccountsConfigured(tx);
    if (payment.storeOrderId) {
      const order = await tx.storeOrder.findUnique({
        where: { id: payment.storeOrderId },
        select: { agentTermsSnapshot: true },
      });
      const terms = readAgentTermsSnapshot(order?.agentTermsSnapshot);
      if (terms.currencyId !== payment.currencyId) {
        throw agentUnprocessable(
          'CURRENCY_MISMATCH',
          'عملة الدفعة تختلف عن عملة اتفاقية الوكيل',
          `Payment ${payment.paymentNumber} is not in the agent agreement currency — unlike currencies are never netted.`,
        );
      }
    }
  }

  /** COLLECTION_RECEIVED credit for a posted receipt (key: the receipt, so a corrected re-match credits again). */
  async onCompanyCollectionPosted(
    tx: Tx,
    paymentId: string,
    receipt: {
      id: string;
      transactionNumber: string;
      journalEntry: { id: string } | null;
    },
    userId?: string,
  ) {
    const payment = await tx.payment.findUniqueOrThrow({
      where: { id: paymentId },
      select: {
        id: true,
        paymentNumber: true,
        agentId: true,
        amount: true,
        currencyId: true,
        storeOrderId: true,
        verifiedAt: true,
        storeOrder: { select: { internalOrderId: true } },
      },
    });
    if (!payment.agentId || !payment.storeOrderId) return;
    // F-L1: the ledger line is dated like the Customer Receipt's journal
    // (statement and GL agree on the period of every collection).
    const posted = await tx.financialTransaction.findUnique({
      where: { id: receipt.id },
      select: { transactionDate: true },
    });
    const journal = receipt.journalEntry
      ? await tx.journalEntry.findUnique({
          where: { id: receipt.journalEntry.id },
          select: { entryDate: true },
        })
      : null;
    await this.ledger.append(
      tx,
      {
        agentId: payment.agentId,
        entryType: AgentLedgerEntryType.COLLECTION_RECEIVED,
        entryDate:
          journal?.entryDate ??
          posted?.transactionDate ??
          payment.verifiedAt ??
          new Date(),
        sourceType: AGENT_SOURCE.RECEIPT,
        sourceId: receipt.id,
        storeOrderId: payment.storeOrderId,
        paymentId: payment.id,
        currencyId: payment.currencyId,
        credit: Number(payment.amount),
        basis: {
          paymentNumber: payment.paymentNumber,
          receiptNumber: receipt.transactionNumber,
        },
        description: `Collection ${payment.paymentNumber} received by the company — order ${payment.storeOrder?.internalOrderId ?? ''}`,
        posting: { journalEntryId: receipt.journalEntry?.id ?? null },
      },
      userId,
    );
    await this.fulfillment.tryEarn(
      tx,
      payment.storeOrderId,
      'PAYMENT_VERIFIED',
      userId,
    );
    await this.ledger.refreshOrderAvailability(tx, payment.storeOrderId);
  }

  /** COLLECTION_REVERSAL debit when a verified agent collection's receipt is cancelled (reversal JE). */
  async onCollectionReceiptCancelled(
    tx: Tx,
    paymentId: string,
    receiptId: string,
    reason: string,
    userId?: string,
  ) {
    const credit = await this.ledger.findByKey(
      tx,
      AGENT_SOURCE.RECEIPT,
      receiptId,
      AgentLedgerEntryType.COLLECTION_RECEIVED,
    );
    if (!credit) return;
    const reversalJe = await tx.journalEntry.findFirst({
      where: {
        sourceType: 'CUSTOMER_RECEIPT',
        sourceId: receiptId,
        reversalOfEntryId: { not: null },
      },
      select: { id: true, entryDate: true },
      orderBy: { createdAt: 'desc' },
    });
    await this.ledger.append(
      tx,
      {
        agentId: credit.agentId,
        entryType: AgentLedgerEntryType.COLLECTION_REVERSAL,
        // F-L1: dated like the receipt's reversal journal.
        entryDate: reversalJe?.entryDate ?? new Date(),
        sourceType: AGENT_SOURCE.RECEIPT,
        sourceId: receiptId,
        storeOrderId: credit.storeOrderId,
        paymentId,
        currencyId: credit.currencyId,
        debit: Number(credit.credit),
        basis: { reverses: credit.entryNumber, reason },
        description: `Collection reversed (${credit.entryNumber}): ${reason}`,
        posting: { journalEntryId: reversalJe?.id ?? null },
      },
      userId,
    );
  }

  /**
   * After a settlement posts: refresh availability of the settled agent
   * collections and charge each agent-order payment its share of the
   * provider fee when the agreement says the agent bears it. The share is
   * the fee in the claim currency pro-rata to the line amounts (FX
   * differences are never part of the fee).
   */
  async onSettlementPosted(tx: Tx, settlementId: string, userId?: string) {
    const settlement = await tx.paymentSettlement.findUniqueOrThrow({
      where: { id: settlementId },
      select: {
        settlementNumber: true,
        settlementDate: true,
        feeAmount: true,
        currencyId: true,
        lines: {
          select: {
            id: true,
            amount: true,
            payment: {
              select: {
                id: true,
                paymentNumber: true,
                agentId: true,
                destinationOwnership: true,
                storeOrderId: true,
                storeOrder: {
                  select: { internalOrderId: true, agentTermsSnapshot: true },
                },
              },
            },
          },
        },
      },
    });
    const agentLines = settlement.lines.filter(
      (line) => line.payment.agentId && line.payment.storeOrderId,
    );
    if (agentLines.length === 0) return;
    const shares = allocateSettlementFee(
      Number(settlement.feeAmount),
      settlement.lines.map((line) => ({
        key: line.id,
        amount: Number(line.amount),
      })),
    );
    const gatewayConfigured =
      (await this.accountMapping.findPaymentGatewayFeeAccount(tx)) != null;
    for (const line of agentLines) {
      const terms = readAgentTermsSnapshot(
        line.payment.storeOrder?.agentTermsSnapshot,
      );
      const share = round2(shares.get(line.id) ?? 0);
      if (terms.providerFeesBorneBy === 'AGENT' && share > 0) {
        await this.appendProviderFee(tx, {
          agentId: line.payment.agentId!,
          lineId: line.id,
          paymentId: line.payment.id,
          storeOrderId: line.payment.storeOrderId!,
          currencyId: settlement.currencyId,
          share,
          entryDate: settlement.settlementDate,
          description: `Provider fee share — ${settlement.settlementNumber}, payment ${line.payment.paymentNumber}`,
          basis: {
            settlementNumber: settlement.settlementNumber,
            settlementFee: Number(settlement.feeAmount),
            lineAmount: Number(line.amount),
          },
          gatewayConfigured,
          userId,
        });
      }
      await this.ledger.refreshOrderAvailability(
        tx,
        line.payment.storeOrderId!,
      );
    }
  }

  private async appendProviderFee(
    tx: Tx,
    input: {
      agentId: string;
      lineId: string;
      paymentId: string;
      storeOrderId: string;
      currencyId: string;
      share: number;
      entryDate: Date;
      description: string;
      basis: Prisma.InputJsonValue;
      gatewayConfigured: boolean;
      userId?: string;
    },
  ) {
    await this.ledger.append(
      tx,
      {
        agentId: input.agentId,
        entryType: AgentLedgerEntryType.PROVIDER_FEE,
        entryDate: input.entryDate,
        sourceType: AGENT_SOURCE.SETTLEMENT_LINE,
        sourceId: input.lineId,
        storeOrderId: input.storeOrderId,
        paymentId: input.paymentId,
        currencyId: input.currencyId,
        debit: input.share,
        basis: input.basis,
        description: input.description,
        // Recovery account (gateway fees) not configured → keep pending.
        posting: {
          source: AGENT_POSTING_SOURCE.PROVIDER_FEE,
          deferPosting: !input.gatewayConfigured,
        },
      },
      input.userId,
    );
  }

  /**
   * F-L2: a POSTED provider-fee share is reversed by mirroring its own
   * journal (posting engine reverse — same amounts and rate as the original,
   * never a re-post at today's rate); the ledger credit carries that
   * reversal journal and its date (F-L1). A share still pending
   * configuration was never in the GL: its credit is recorded pending too
   * and posts (Dr gateway fee / Cr agent payable) with the rest.
   */
  private async reverseProviderFee(
    tx: Tx,
    fee: {
      id: string;
      entryNumber: string;
      agentId: string;
      storeOrderId: string | null;
      paymentId: string | null;
      currencyId: string;
      debit: Prisma.Decimal;
      journalEntryId: string | null;
    },
    lineId: string,
    settlement: { settlementNumber: string },
    reason: string,
    userId?: string,
  ) {
    const common = {
      agentId: fee.agentId,
      entryType: AgentLedgerEntryType.ADJUSTMENT,
      sourceType: AGENT_SOURCE.SETTLEMENT_LINE_REVERSAL,
      sourceId: lineId,
      storeOrderId: fee.storeOrderId,
      paymentId: fee.paymentId,
      currencyId: fee.currencyId,
      credit: Number(fee.debit),
      basis: {
        reverses: fee.entryNumber,
        counterAccount: 'PAYMENT_GATEWAY_FEE',
        reason,
      },
      description: `Provider fee reversed (${fee.entryNumber}) — settlement ${settlement.settlementNumber} reversed`,
    } as const;
    if (fee.journalEntryId) {
      const reversal = await this.postingEngine.reverse(
        AGENT_POSTING_SOURCE.PROVIDER_FEE,
        fee.id,
        userId,
        tx,
      );
      await this.ledger.append(
        tx,
        {
          ...common,
          entryDate: reversal?.entryDate ?? new Date(),
          posting: { journalEntryId: reversal?.id ?? null },
        },
        userId,
      );
      return;
    }
    await this.ledger.append(
      tx,
      {
        ...common,
        entryDate: new Date(),
        posting: {
          source: AGENT_POSTING_SOURCE.ADJUSTMENT,
          deferPosting:
            (await this.accountMapping.findPaymentGatewayFeeAccount(tx)) ==
            null,
        },
      },
      userId,
    );
  }

  /** Settlement reversed: provider-fee shares are credited back and availability is recomputed. */
  async onSettlementReversed(
    tx: Tx,
    settlementId: string,
    reason: string,
    userId?: string,
  ) {
    const settlement = await tx.paymentSettlement.findUniqueOrThrow({
      where: { id: settlementId },
      select: {
        settlementNumber: true,
        status: true,
        lines: {
          select: {
            id: true,
            payment: { select: { storeOrderId: true, agentId: true } },
          },
        },
      },
    });
    if (settlement.status === PaymentSettlementDocStatus.POSTED) return;
    for (const line of settlement.lines) {
      if (!line.payment.agentId) continue;
      const fee = await this.ledger.findByKey(
        tx,
        AGENT_SOURCE.SETTLEMENT_LINE,
        line.id,
        AgentLedgerEntryType.PROVIDER_FEE,
      );
      if (fee) {
        const already = await this.ledger.findByKey(
          tx,
          AGENT_SOURCE.SETTLEMENT_LINE_REVERSAL,
          line.id,
          AgentLedgerEntryType.ADJUSTMENT,
        );
        if (!already) {
          await this.reverseProviderFee(
            tx,
            fee,
            line.id,
            settlement,
            reason,
            userId,
          );
        }
      }
      if (line.payment.storeOrderId) {
        await this.ledger.refreshOrderAvailability(
          tx,
          line.payment.storeOrderId,
        );
      }
    }
  }
}
