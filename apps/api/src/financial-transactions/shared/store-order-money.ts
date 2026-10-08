import {
  FinancialTransactionStatus,
  FinancialTransactionType,
  Prisma,
  SalesDocumentStatus,
} from '@prisma/client';
import { storeOrderPayableTotal } from '../../store-orders/store-order-line-amount';
import { isStoreOrderActive } from '../../store-orders/store-order-active';
import {
  STORE_ORDER_PAYMENT_NOTE_PREFIX,
  storeOrderReceiptsWhere,
} from './store-order-receipts';

/**
 * R15 (D15-9 … D15-11) — the ONE money position of a store order, derived
 * from posted documents only (receipts, invoices, credit notes, refunds),
 * never from a declaration. Shared by the refund caps enforced at Confirm,
 * the order "Record refund" action and the order money panel, so the figure
 * the user sees is the figure the server enforces.
 *
 * - collected: money received FOR this order, read from where each posted
 *   receipt's money was applied (review H1): any receipt's allocations to the
 *   order's invoices + the order's own receipts' unallocated advance + the
 *   part of them paid back as the order's advance refunds — never a receipt
 *   in full when its money went to another order's invoice;
 * - invoiced / credited: posted sales invoices / sales returns of the order;
 * - refunded: posted Customer Refund lines paying back the order's advance or
 *   its returns' credit;
 * - expected: what the customer owes for the order — an active order still
 *   owes its payable total (or what was invoiced, if more), a cancelled order
 *   (`isStoreOrderActive`: archived or fulfillment CANCELLED — the stock
 *   lifecycle's rule) only what was delivered and kept; credit notes reduce it.
 *
 * balanceDue = expected − (collected − refunded) when positive; refundDue the
 * opposite. An active prepaid order before delivery therefore shows no refund
 * due — its advance pays for goods still to come. A COD order whose cash was
 * never collected has nothing to refund: its credit note only reduces AR.
 */

type Client = Prisma.TransactionClient;

/** Same rounding as every money figure of the matching engine. */
export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

const EPSILON = 0.005;

/** Sales documents whose posting stands (credit notes / invoices). */
export const POSTED_SALES_STATUSES: SalesDocumentStatus[] = [
  SalesDocumentStatus.CONFIRMED,
  SalesDocumentStatus.CLOSED,
];

export interface StoreOrderReturnCredit {
  salesReturnId: string;
  returnNumber: string;
  createdAt: Date;
  grandTotal: number;
  refunded: number;
  unrefunded: number;
}

export interface StoreOrderMoneyFigures {
  payable: number;
  collected: number;
  invoiced: number;
  credited: number;
  refunded: number;
  /** Part of `refunded` paid back against the order itself (advance / overpayment lines). */
  refundedAdvance: number;
  expected: number;
  balanceDue: number;
  refundDue: number;
  /** Σ unrefunded credit of the order's posted returns. */
  unrefundedReturnCredit: number;
  /** What an advance line (`storeOrderId`) may still pay back: refund due beyond the returns' own credit. */
  advanceRefundable: number;
}

export interface StoreOrderMoneyInputs {
  active: boolean;
  payable: number;
  collected: number;
  invoiced: number;
  returns: Array<{ grandTotal: number; refunded: number }>;
  refundedAdvance: number;
}

/** Pure arithmetic of the position (unit-tested on its own). */
export function computeStoreOrderMoney(
  input: StoreOrderMoneyInputs,
): StoreOrderMoneyFigures {
  const credited = roundMoney(
    input.returns.reduce((sum, row) => sum + row.grandTotal, 0),
  );
  const refundedToReturns = roundMoney(
    input.returns.reduce((sum, row) => sum + row.refunded, 0),
  );
  const unrefundedReturnCredit = roundMoney(
    input.returns.reduce(
      (sum, row) =>
        sum + Math.max(roundMoney(row.grandTotal - row.refunded), 0),
      0,
    ),
  );
  const refunded = roundMoney(refundedToReturns + input.refundedAdvance);
  const expectedGross = input.active
    ? Math.max(input.invoiced, input.payable)
    : input.invoiced;
  const expected = Math.max(roundMoney(expectedGross - credited), 0);
  const net = roundMoney(input.collected - refunded);
  const balanceDue = Math.max(roundMoney(expected - net), 0);
  const refundDue = Math.max(roundMoney(net - expected), 0);
  return {
    payable: roundMoney(input.payable),
    collected: roundMoney(input.collected),
    invoiced: roundMoney(input.invoiced),
    credited,
    refunded,
    refundedAdvance: roundMoney(input.refundedAdvance),
    expected,
    balanceDue: balanceDue <= EPSILON ? 0 : balanceDue,
    refundDue: refundDue <= EPSILON ? 0 : refundDue,
    unrefundedReturnCredit,
    advanceRefundable: Math.max(
      roundMoney(refundDue - unrefundedReturnCredit),
      0,
    ),
  };
}

export interface StoreOrderPositionReceipt {
  id: string;
  transactionNumber: string;
  /** amount + fee: what the receipt credited the customer. */
  settled: number;
  exchangeRate: number | null;
  paymentId: string | null;
  /** Still unallocated: neither applied to an invoice nor paid back by an advance refund. */
  unallocated: number;
  /** What this receipt counts as collected for THIS order (own invoices + unallocated + own advance refunds). */
  contribution: number;
}

export interface StoreOrderMoneyPosition extends StoreOrderMoneyFigures {
  storeOrderId: string;
  internalOrderId: string;
  partnerId: string;
  currencyId: string;
  agentId: string | null;
  active: boolean;
  receipts: StoreOrderPositionReceipt[];
  invoices: Array<{
    id: string;
    invoiceNumber: string;
    grandTotal: number;
    shipmentId: string | null;
    createdAt: Date;
  }>;
  returnCredits: StoreOrderReturnCredit[];
}

/** The order's posted returns: raised from the order, or against one of its invoices. */
export function storeOrderReturnsWhere(
  storeOrderId: string,
): Prisma.SalesReturnWhereInput {
  return {
    deletedAt: null,
    OR: [{ storeOrderId }, { salesInvoice: { storeOrderId } }],
  };
}

/**
 * Loads and computes the position of one order (cancelled orders included —
 * a cancelled order's advance is refunded after cancellation). Null when the
 * order does not exist.
 */
export async function loadStoreOrderMoneyPosition(
  client: Client,
  storeOrderId: string,
): Promise<StoreOrderMoneyPosition | null> {
  const order = await client.storeOrder.findUnique({
    where: { id: storeOrderId },
    select: {
      id: true,
      internalOrderId: true,
      partnerId: true,
      currencyId: true,
      agentId: true,
      deletedAt: true,
      fulfillmentStatus: { select: { code: true } },
      payableTotal: true,
      items: {
        where: { deletedAt: null },
        select: { quantity: true, unitPrice: true, agreedAmount: true },
      },
      payments: { where: { deletedAt: null }, select: { id: true } },
    },
  });
  if (!order) return null;

  const paymentIds = order.payments.map((payment) => payment.id);
  const [receiptRows, orderInvoices, appliedToInvoices, returnRows] =
    await Promise.all([
      client.financialTransaction.findMany({
        where: storeOrderReceiptsWhere(storeOrderId, paymentIds),
        select: {
          id: true,
          transactionNumber: true,
          amount: true,
          feeAmount: true,
          exchangeRate: true,
          notes: true,
          paymentReceiptLink: { select: { paymentId: true } },
          allocations: {
            select: {
              allocatedAmount: true,
              salesInvoiceId: true,
              storeOrderId: true,
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      }),
      client.salesInvoice.findMany({
        where: { storeOrderId, deletedAt: null },
        select: {
          id: true,
          invoiceNumber: true,
          status: true,
          grandTotal: true,
          shipmentId: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: 'asc' }, { invoiceNumber: 'asc' }],
      }),
      // Any posted receipt's money applied to this order's invoices (its own
      // or, by manual matching, another order's receipt).
      client.financialTransactionAllocation.aggregate({
        where: {
          salesInvoice: { storeOrderId },
          transaction: {
            type: FinancialTransactionType.CUSTOMER_RECEIPT,
            status: FinancialTransactionStatus.CONFIRMED,
            deletedAt: null,
          },
        },
        _sum: { allocatedAmount: true },
      }),
      client.salesReturn.findMany({
        where: {
          ...storeOrderReturnsWhere(storeOrderId),
          status: { in: POSTED_SALES_STATUSES },
        },
        select: {
          id: true,
          returnNumber: true,
          grandTotal: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: 'asc' }, { returnNumber: 'asc' }],
      }),
    ]);
  const ownInvoiceIds = new Set(orderInvoices.map((invoice) => invoice.id));
  const receipts: StoreOrderPositionReceipt[] = receiptRows.map((row) => {
    const settled = roundMoney(Number(row.amount) + Number(row.feeAmount ?? 0));
    let allocated = 0;
    let forThisOrder = 0;
    for (const allocation of row.allocations) {
      const amount = Number(allocation.allocatedAmount);
      allocated += amount;
      if (
        (allocation.salesInvoiceId &&
          ownInvoiceIds.has(allocation.salesInvoiceId)) ||
        allocation.storeOrderId === storeOrderId
      ) {
        forThisOrder += amount;
      }
    }
    const unallocated = Math.max(roundMoney(settled - allocated), 0);
    return {
      id: row.id,
      transactionNumber: row.transactionNumber,
      settled,
      exchangeRate: row.exchangeRate == null ? null : Number(row.exchangeRate),
      paymentId:
        row.paymentReceiptLink?.paymentId ??
        row.notes?.slice(STORE_ORDER_PAYMENT_NOTE_PREFIX.length) ??
        null,
      unallocated,
      contribution: roundMoney(forThisOrder + unallocated),
    };
  });
  const invoiceRows = orderInvoices.filter((invoice) =>
    POSTED_SALES_STATUSES.includes(invoice.status),
  );
  // The order's own receipts' money not applied to its invoices: still
  // unallocated, or paid back as its advance refunds (review H1).
  const ownUnappliedAndRefunded = receiptRows.reduce(
    (sum, row) =>
      sum +
      row.allocations
        .filter((allocation) => allocation.storeOrderId === storeOrderId)
        .reduce(
          (part, allocation) => part + Number(allocation.allocatedAmount),
          0,
        ),
    receipts.reduce((sum, receipt) => sum + receipt.unallocated, 0),
  );

  const refundLines = await client.financialTransactionAllocation.findMany({
    where: {
      transaction: {
        type: FinancialTransactionType.CUSTOMER_REFUND,
        status: FinancialTransactionStatus.CONFIRMED,
        deletedAt: null,
      },
      OR: [
        { storeOrderId },
        ...(returnRows.length
          ? [{ salesReturnId: { in: returnRows.map((row) => row.id) } }]
          : []),
      ],
    },
    select: { storeOrderId: true, salesReturnId: true, allocatedAmount: true },
  });
  let refundedAdvance = 0;
  const refundedByReturn = new Map<string, number>();
  for (const line of refundLines) {
    const amount = Number(line.allocatedAmount);
    if (line.salesReturnId) {
      refundedByReturn.set(
        line.salesReturnId,
        (refundedByReturn.get(line.salesReturnId) ?? 0) + amount,
      );
    } else if (line.storeOrderId === storeOrderId) {
      refundedAdvance += amount;
    }
  }

  const returnCredits: StoreOrderReturnCredit[] = returnRows.map((row) => {
    const grandTotal = roundMoney(Number(row.grandTotal));
    const refunded = roundMoney(refundedByReturn.get(row.id) ?? 0);
    return {
      salesReturnId: row.id,
      returnNumber: row.returnNumber,
      createdAt: row.createdAt,
      grandTotal,
      refunded,
      unrefunded: Math.max(roundMoney(grandTotal - refunded), 0),
    };
  });
  const invoices = invoiceRows.map((row) => ({
    id: row.id,
    invoiceNumber: row.invoiceNumber,
    grandTotal: roundMoney(Number(row.grandTotal)),
    shipmentId: row.shipmentId,
    createdAt: row.createdAt,
  }));
  const active = isStoreOrderActive(order);
  const figures = computeStoreOrderMoney({
    active,
    payable: storeOrderPayableTotal(order),
    collected:
      Number(appliedToInvoices._sum.allocatedAmount ?? 0) +
      ownUnappliedAndRefunded,
    invoiced: invoices.reduce((sum, invoice) => sum + invoice.grandTotal, 0),
    returns: returnCredits,
    refundedAdvance,
  });
  return {
    storeOrderId: order.id,
    internalOrderId: order.internalOrderId,
    partnerId: order.partnerId,
    currencyId: order.currencyId,
    agentId: order.agentId,
    active,
    receipts,
    invoices,
    returnCredits,
    ...figures,
  };
}

/**
 * The rate at which the order's advance credited the customer's AR: the
 * amount-weighted frozen rate of its posted receipts (null when it has none —
 * the refund then values the line at its own rate). A refund of that advance
 * debits AR back at this rate, so the customer's balance clears exactly; any
 * difference to the cash paid out is realized FX.
 */
export function advanceRateOf(
  receipts: Pick<StoreOrderPositionReceipt, 'settled' | 'exchangeRate'>[],
): number | null {
  const rated = receipts.filter(
    (receipt) => receipt.exchangeRate != null && receipt.settled > 0,
  );
  const total = rated.reduce((sum, receipt) => sum + receipt.settled, 0);
  if (total <= 0) return null;
  const weighted = rated.reduce(
    (sum, receipt) => sum + receipt.settled * (receipt.exchangeRate as number),
    0,
  );
  return Math.round((weighted / total) * 1e8) / 1e8;
}
