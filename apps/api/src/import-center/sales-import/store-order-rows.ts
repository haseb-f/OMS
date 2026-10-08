import { BadRequestException } from '@nestjs/common';
import { normalizePhoneDigits } from '../../common/phone/phone-number.service';
import { normalizeExternalOrderId } from '../sync/store-orders-sync.lifecycle';

/** One product line of an imported order, price explicit from the row. */
export interface ImportedOrderLine {
  /** The Product cell as typed (SKU or display name), resolved later in the importer's catalogue. */
  productValue: string;
  quantity: number;
  /** quantity × unit price, rounded to cents. */
  lineAmount: number;
}

/** A group of rows (one order) parsed with the one-time import rules. */
export interface ImportedOrderRows {
  first: Record<string, string>;
  externalOrderId: string | null;
  /** ISO timestamp of the order date. */
  orderDate: string;
  /** `YYYY-MM-DD` — part of the row key. */
  orderDay: string;
  lines: ImportedOrderLine[];
  /** Σ Paid Amount of the rows; null when no row states a paid amount. */
  paidAmount: number | null;
  /** ISO timestamp — the payment date column, else the order date. */
  paymentDate: string;
  /** "Repeat customer" = yes: the caller acknowledges an existing customer of this phone. */
  repeatCustomer: boolean;
}

const YES = new Set(['yes', 'y', 'true', '1', 'نعم', 'ن', 'مكرر']);
const NO = new Set(['', 'no', 'n', 'false', '0', 'لا']);

function bad(ar: string, en: string): never {
  throw new BadRequestException(`${ar} — ${en}`);
}

/** A cell as a number: Arabic-Indic digits and the Arabic decimal separator accepted; blank → null. */
export function parseImportAmount(
  value: string | undefined,
  labelAr: string,
  label: string,
): number | null {
  const text = normalizePhoneDigits(value ?? '')
    .replace(/٫/g, '.')
    .trim();
  if (!text) return null;
  const amount = Number(text);
  if (!Number.isFinite(amount) || amount < 0) {
    bad(
      `${labelAr} «${value}» ليس رقمًا موجبًا`,
      `${label} "${value}" is not a non-negative number.`,
    );
  }
  return amount;
}

export function parseImportDate(
  value: string | undefined,
  labelAr: string,
  label: string,
): string | null {
  const trimmed = normalizePhoneDigits(value ?? '').trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    bad(
      `${labelAr} «${value}» ليس تاريخًا صحيحًا`,
      `${label} "${value}" is not a valid date (YYYY-MM-DD).`,
    );
  }
  return parsed.toISOString();
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * R15 (spec §3) — the one-time import reading of an order's rows: prices are
 * explicit (Unit Price or Line Amount, never derived from a payment), Paid
 * Amount is only what the customer reportedly paid (a declaration), and
 * "Repeat customer" is the explicit duplicate acknowledgement.
 */
export function parseImportedOrderRows(
  rows: Record<string, string>[],
): ImportedOrderRows {
  const first = rows[0];
  if (!first.customerName?.trim()) {
    bad('اسم العميل مطلوب', 'Customer Name is required.');
  }
  if (!first.customerPhone?.trim()) bad('الجوال مطلوب', 'Phone is required.');
  const orderDate = parseImportDate(
    first.orderDate,
    'تاريخ الطلب',
    'Order Date',
  );
  if (!orderDate) bad('تاريخ الطلب مطلوب', 'Order Date is required.');
  const paymentDate =
    parseImportDate(first.paymentDate, 'تاريخ الدفع', 'Payment Date') ??
    orderDate;

  const repeatText = (first.repeatCustomer ?? '').trim().toLocaleLowerCase();
  if (!YES.has(repeatText) && !NO.has(repeatText)) {
    bad(
      `قيمة «عميل متكرر» يجب أن تكون نعم أو لا`,
      `Repeat Customer must be yes or no (got "${first.repeatCustomer}").`,
    );
  }

  let paidAmount: number | null = null;
  const lines: ImportedOrderLine[] = rows.map((row) => {
    const productValue = row.productSku?.trim();
    if (!productValue) bad('المنتج مطلوب', 'Product is required.');
    const quantity = Number(normalizePhoneDigits(row.quantity ?? '').trim());
    if (!Number.isInteger(quantity) || quantity < 1) {
      bad(
        `الكمية يجب أن تكون عددًا صحيحًا ≥ 1 (${productValue})`,
        `Quantity must be a whole number of at least 1 (${productValue}).`,
      );
    }
    const unitPrice = parseImportAmount(
      row.unitPrice,
      'سعر الوحدة',
      'Unit Price',
    );
    const lineAmount = parseImportAmount(
      row.lineAmount,
      'إجمالي السطر',
      'Line Amount',
    );
    if (unitPrice === null && lineAmount === null) {
      bad(
        `السعر مطلوب: أدخل سعر الوحدة أو إجمالي السطر (${productValue})`,
        `A price is required: fill Unit Price or Line Amount (${productValue}).`,
      );
    }
    if (
      unitPrice !== null &&
      lineAmount !== null &&
      Math.abs(round2(unitPrice * quantity) - lineAmount) > 0.01
    ) {
      bad(
        `سعر الوحدة × الكمية لا يساوي إجمالي السطر (${productValue})`,
        `Unit Price × Quantity does not equal Line Amount (${productValue}).`,
      );
    }
    const paid = parseImportAmount(
      row.paidAmount,
      'المبلغ المدفوع',
      'Paid Amount',
    );
    if (paid !== null) paidAmount = round2((paidAmount ?? 0) + paid);
    return {
      productValue,
      quantity,
      lineAmount: lineAmount ?? round2(unitPrice! * quantity),
    };
  });

  const externalOrderId = first.externalOrderId?.trim()
    ? normalizeExternalOrderId(first.externalOrderId)
    : null;
  return {
    first,
    externalOrderId,
    orderDate,
    orderDay: orderDate.slice(0, 10),
    lines,
    paidAmount,
    paymentDate,
    repeatCustomer: YES.has(repeatText),
  };
}

/**
 * The declaration a stated Paid Amount means against the order total: 0 →
 * UNPAID, the total → FULL, less → PARTIAL; more than the total is refused.
 * Never a verified payment and never a receipt (requirement 2.10).
 */
export function declarationKindFor(
  paidAmount: number,
  total: number,
): { kind: 'UNPAID' | 'FULL' | 'PARTIAL'; amount?: number } {
  if (paidAmount <= 0) return { kind: 'UNPAID' };
  if (paidAmount > total + 0.005) {
    bad(
      `المبلغ المدفوع ${paidAmount} أكبر من إجمالي الطلب ${total}`,
      `Paid Amount ${paidAmount} exceeds the order total ${total}.`,
    );
  }
  if (paidAmount >= total - 0.005) return { kind: 'FULL' };
  return { kind: 'PARTIAL', amount: paidAmount };
}
