import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  FinancialTransactionStatus,
  FinancialTransactionType,
  PaymentStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { CompanyContext } from '../../common/decorators/current-company-context.decorator';
import { partnerLedgerBalances } from '../../accounting/reports/partner-ledger-balance';
import { lockStoreOrderRow } from '../../store-orders/store-order-payment-settlement.util';
import { FinancialTransactionsService } from '../financial-transactions.service';
import {
  advanceRateOf,
  loadStoreOrderMoneyPosition,
  roundMoney,
  type StoreOrderMoneyPosition,
  type StoreOrderReturnCredit,
} from '../shared/store-order-money';
import type { RecordStoreOrderRefundDto } from './dto/record-store-order-refund.dto';

const TYPE = FinancialTransactionType.CUSTOMER_REFUND;
const EPSILON = 0.005;
/** Bound of the "orders with money to refund" list of one customer. */
const OPEN_ORDERS_SCAN_LIMIT = 200;

type Client = Prisma.TransactionClient | PrismaService;

/** One planned refund line: a credit note's unrefunded credit, or the order's advance. */
export interface StoreOrderRefundLine {
  salesReturnId: string | null;
  returnNumber: string | null;
  storeOrderId: string | null;
  amount: number;
}

/** What can be refunded on one order now (all figures in the order currency). */
export interface StoreOrderRefundable {
  storeOrderId: string;
  internalOrderId: string;
  partnerId: string;
  currencyId: string;
  active: boolean;
  collected: number;
  invoiced: number;
  credited: number;
  refunded: number;
  expected: number;
  balanceDue: number;
  refundDue: number;
  advanceRefundable: number;
  returnCredits: StoreOrderReturnCredit[];
  /** The customer's credit on the posted AR ledger (0 when they owe us). */
  customerCreditBalance: number;
  /** min(refund due, ledger credit) — the most "Record refund" accepts now. */
  refundable: number;
}

/**
 * Splits a refund over the order's documents: the unrefunded credit of its
 * posted returns first (oldest first — a credit note is refunded against
 * itself), then its advance (collected beyond what the order owes). Null
 * when the amount does not fit.
 */
export function planStoreOrderRefund(
  position: Pick<
    StoreOrderMoneyPosition,
    'storeOrderId' | 'returnCredits' | 'advanceRefundable'
  >,
  amount: number,
): StoreOrderRefundLine[] | null {
  const lines: StoreOrderRefundLine[] = [];
  let left = roundMoney(amount);
  for (const credit of position.returnCredits) {
    if (left <= EPSILON) break;
    const part = roundMoney(Math.min(left, credit.unrefunded));
    if (part <= EPSILON) continue;
    lines.push({
      salesReturnId: credit.salesReturnId,
      returnNumber: credit.returnNumber,
      storeOrderId: null,
      amount: part,
    });
    left = roundMoney(left - part);
  }
  if (left > EPSILON) {
    const part = roundMoney(Math.min(left, position.advanceRefundable));
    if (part > EPSILON) {
      lines.push({
        salesReturnId: null,
        returnNumber: null,
        storeOrderId: position.storeOrderId,
        amount: part,
      });
      left = roundMoney(left - part);
    }
  }
  return left > EPSILON ? null : lines;
}

/**
 * R15 (D15-11) — refunds of store orders: money actually returned to the
 * customer, recorded manually (no payment-gateway integration — the money is
 * returned through the gateway / bank first). A credit note alone never
 * marks anything refunded; until a refund is recorded the order shows
 * "Refund pending". Works for archived (cancelled) orders: a cancelled
 * prepaid order's advance is refunded after cancellation.
 */
@Injectable()
export class StoreOrderRefundsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: FinancialTransactionsService,
  ) {}

  async refundable(storeOrderId: string): Promise<StoreOrderRefundable> {
    const position = await loadStoreOrderMoneyPosition(
      this.prisma,
      storeOrderId,
    );
    if (!position) {
      throw new NotFoundException(`Store Order ${storeOrderId} not found`);
    }
    return this.describe(position, this.prisma);
  }

  /** The customer's company orders (archived included) with money to refund now. */
  async openOrders(partnerId: string): Promise<StoreOrderRefundable[]> {
    const orders = await this.prisma.storeOrder.findMany({
      where: {
        partnerId,
        agentId: null,
        payments: {
          some: { deletedAt: null, status: PaymentStatus.VERIFIED },
        },
      },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
      take: OPEN_ORDERS_SCAN_LIMIT,
    });
    const rows: StoreOrderRefundable[] = [];
    for (const order of orders) {
      const position = await loadStoreOrderMoneyPosition(this.prisma, order.id);
      if (!position || position.refundDue <= EPSILON) continue;
      rows.push(await this.describe(position, this.prisma));
    }
    return rows.filter((row) => row.refundable > EPSILON);
  }

  /**
   * "Record refund": create + confirm + post ONE Customer Refund (Dr AR /
   * Cr the cash-bank account) in one transaction. The customer row, then the
   * order row are locked before anything is read, so concurrent refunds of
   * the order (or of the customer) serialize and can never exceed what is
   * due; a retried submit with the same key returns the first refund.
   */
  async record(
    storeOrderId: string,
    dto: RecordStoreOrderRefundDto,
    userId: string,
    context: CompanyContext,
  ) {
    const refundId = await this.prisma.$transaction(
      async (tx) => {
        const order = await tx.storeOrder.findUnique({
          where: { id: storeOrderId },
          select: { partnerId: true, agentId: true, currencyId: true },
        });
        if (!order) {
          throw new NotFoundException(`Store Order ${storeOrderId} not found`);
        }
        if (order.agentId) {
          throw new BadRequestException({
            code: 'AGENT_ORDER_REFUND_NOT_SUPPORTED',
            message:
              'طلبات الوكلاء تُسوّى عبر حساب الوكيل — Agent orders are settled through the agent ledger; their collections are not refunded from the order.',
          });
        }
        await tx.$queryRaw`
          SELECT id FROM partners WHERE id = ${order.partnerId}::uuid FOR UPDATE
        `;
        await lockStoreOrderRow(tx, storeOrderId);

        const replay = await tx.financialTransaction.findUnique({
          where: { idempotencyKey: dto.idempotencyKey },
          select: {
            id: true,
            type: true,
            status: true,
            partnerId: true,
            deletedAt: true,
            transactionNumber: true,
          },
        });
        if (replay) {
          if (
            replay.type !== TYPE ||
            replay.partnerId !== order.partnerId ||
            replay.deletedAt ||
            replay.status === FinancialTransactionStatus.DRAFT
          ) {
            throw new ConflictException({
              code: 'IDEMPOTENCY_KEY_REUSED',
              message: `This form was already submitted as ${replay.transactionNumber} — reopen the dialog to record a new refund.`,
            });
          }
          return replay.id;
        }

        const position = await loadStoreOrderMoneyPosition(tx, storeOrderId);
        const view = await this.describe(position!, tx);
        const amount = roundMoney(dto.amount);
        const lines =
          amount <= view.refundable + EPSILON
            ? planStoreOrderRefund(position!, amount)
            : null;
        if (!lines) {
          throw new BadRequestException({
            code: 'REFUND_EXCEEDS_DUE',
            message: `لا يمكن رد ${amount.toFixed(2)} — المتاح للرد على الطلب ${view.internalOrderId} هو ${view.refundable.toFixed(2)} فقط — Cannot refund ${amount.toFixed(2)}: only ${view.refundable.toFixed(2)} can be refunded on Store Order ${view.internalOrderId} now (refund due ${view.refundDue.toFixed(2)}, customer credit ${view.customerCreditBalance.toFixed(2)}).`,
            details: {
              refundable: view.refundable,
              refundDue: view.refundDue,
              customerCreditBalance: view.customerCreditBalance,
            },
          });
        }

        const created = await this.transactions.create(
          TYPE,
          {
            partnerId: order.partnerId,
            currencyId: order.currencyId,
            transactionDate: dto.transactionDate,
            paymentSourceId: dto.paymentSourceId,
            receivingAccountId: dto.receivingAccountId,
            amount,
            referenceNumber: dto.referenceNumber?.trim() || undefined,
            notes: dto.notes?.trim() || undefined,
            idempotencyKey: dto.idempotencyKey,
            allocations: lines.map((line) =>
              line.salesReturnId
                ? {
                    invoiceId: line.salesReturnId,
                    allocatedAmount: line.amount,
                  }
                : {
                    storeOrderId: storeOrderId,
                    allocatedAmount: line.amount,
                  },
            ),
          },
          userId,
          context,
          tx,
        );
        const confirmed = await this.transactions.confirm(
          created.id,
          userId,
          tx,
        );
        const describe = lines
          .map((line) =>
            line.returnNumber
              ? `${line.amount.toFixed(2)} against credit note ${line.returnNumber}`
              : `${line.amount.toFixed(2)} of the order's advance`,
          )
          .join(', ');
        await tx.storeOrderActivity.create({
          data: {
            storeOrderId,
            action: 'REFUND_RECORDED',
            details: `Customer Refund ${confirmed.transactionNumber} recorded: ${amount.toFixed(2)} paid back to the customer (${describe})${dto.referenceNumber?.trim() ? `, reference ${dto.referenceNumber.trim()}` : ''} — recorded manually, the money was returned outside OMS`,
            performedById: userId,
          },
        });
        return confirmed.id;
      },
      { maxWait: 10_000, timeout: 30_000 },
    );
    return this.transactions.findOne(TYPE, refundId);
  }

  /** The position plus the customer's ledger credit and what "Record refund" accepts now. */
  async describe(
    position: StoreOrderMoneyPosition,
    client: Client,
  ): Promise<StoreOrderRefundable> {
    const balances = await partnerLedgerBalances(client, [position.partnerId]);
    const receivable = balances.get(position.partnerId)?.receivable ?? 0;
    const rate = advanceRateOf(position.receipts) ?? 1;
    const customerCreditBalance =
      receivable < 0 && rate > 0 ? roundMoney(-receivable / rate) : 0;
    return {
      storeOrderId: position.storeOrderId,
      internalOrderId: position.internalOrderId,
      partnerId: position.partnerId,
      currencyId: position.currencyId,
      active: position.active,
      collected: position.collected,
      invoiced: position.invoiced,
      credited: position.credited,
      refunded: position.refunded,
      expected: position.expected,
      balanceDue: position.balanceDue,
      refundDue: position.refundDue,
      advanceRefundable: position.advanceRefundable,
      returnCredits: position.returnCredits,
      customerCreditBalance,
      refundable: position.agentId
        ? 0
        : roundMoney(Math.min(position.refundDue, customerCreditBalance)),
    };
  }
}
