import { ConflictException } from '@nestjs/common';
import type {
  DuplicateCheckResult,
  DuplicateResolution,
} from '../../store-orders/duplicates/duplicate-outcome';
import { ImportRowNeedsReviewError } from '../import-type.interface';

/** "Repeat customer = yes" (or a confirmed review row): the explicit "same customer, new order" answer. */
export function repeatOrderResolution(
  repeatCustomer: boolean,
): DuplicateResolution | undefined {
  return repeatCustomer ? { decision: 'INTENTIONAL_NEW_ORDER' } : undefined;
}

/**
 * R15 (spec §3) — the duplicate gate's 409 `DUPLICATE_ACKNOWLEDGEMENT_REQUIRED`
 * becomes a needs-review row that shows the matched customer (as masked as the
 * check itself returns it — never more than the importer may see). Any other
 * error is returned unchanged.
 */
export function duplicateNeedsReview(error: unknown): unknown {
  if (!(error instanceof ConflictException)) return error;
  const body = error.getResponse() as {
    code?: string;
    details?: { duplicate?: DuplicateCheckResult };
  };
  if (body?.code !== 'DUPLICATE_ACKNOWLEDGEMENT_REQUIRED') return error;
  const duplicate = body.details?.duplicate;
  if (duplicate?.kind === 'PHONE' && duplicate.crossScope) {
    return new ImportRowNeedsReviewError(
      'رقم الجوال مسجل لعميل خارج نطاقك — أكّد الصف لإنشاء الطلب لنفس العميل مع مراجعة التكرار داخليًا — The phone belongs to a customer outside your scope: confirm the row to create the order for that customer (flagged for internal duplicate review).',
    );
  }
  if (duplicate?.kind === 'PHONE') {
    const customer = `${duplicate.customer.name}${duplicate.customer.phoneMasked ? ` (${duplicate.customer.phoneMasked})` : ''}`;
    if (duplicate.alternatives?.length) {
      const records = [duplicate.customer, ...duplicate.alternatives]
        .map((record) => record.name)
        .join('، ');
      return new ImportRowNeedsReviewError(
        `رقم الجوال مسجل لأكثر من سجل عميل (${records}) — أنشئ الطلب من شاشة الطلبات لاختيار السجل الصحيح أو ارفض الصف — The phone matches several customer records (${records}): create the order from the order form to choose the right record, or reject the row.`,
      );
    }
    const orders = duplicate.orders
      .slice(0, 3)
      .map((order) => order.orderNumber)
      .join('، ');
    const ordersAr = orders ? ` — طلباته: ${orders}` : '';
    const ordersEn = orders ? `; orders: ${orders}` : '';
    return new ImportRowNeedsReviewError(
      `رقم الجوال مطابق للعميل ${customer}${ordersAr} — اكتب «نعم» في عمود «عميل متكرر» أو أكّد الصف كطلب جديد لنفس العميل — The phone matches existing customer ${customer}${ordersEn}: set Repeat Customer = yes, or confirm the row as a new order for this customer.`,
    );
  }
  return new ImportRowNeedsReviewError(
    'يوجد عميل مسجل بنفس البيانات — أكّد الصف كطلب جديد لنفس العميل أو ارفضه — A customer with these details exists: confirm the row as a new order for this customer, or reject it.',
  );
}
