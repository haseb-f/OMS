/**
 * Arabic sheet-facing Store Order sync messages.
 *
 * The OMS review UI humanizes English handler errors on the web. The Google
 * Sheet is the operator's working copy, so write-back must already be Arabic
 * and grouped — one concise cell per row, never duplicated phone/order values.
 */
export interface SheetErrorIssue {
  field?: string | null;
  code?: string;
  message: string;
}

const FIELD_AR: Record<string, string> = {
  customerPhone: 'رقم الجوال',
  Phone: 'رقم الجوال',
  'Customer Phone': 'رقم الجوال',
  customerName: 'اسم العميل',
  'Customer Name': 'اسم العميل',
  countryName: 'الدولة',
  Country: 'الدولة',
  productSku: 'المنتج',
  Product: 'المنتج',
  externalOrderId: 'رقم الطلب الخارجي',
  'External Order ID': 'رقم الطلب الخارجي',
  address: 'العنوان',
  'Detailed Address': 'العنوان',
  orderDate: 'تاريخ الطلب',
  'Order Date': 'تاريخ الطلب',
  quantity: 'الكمية',
  Quantity: 'الكمية',
  paidAmount: 'المبلغ المدفوع',
  'Paid Amount': 'المبلغ المدفوع',
  currencyCode: 'العملة',
  Currency: 'العملة',
  paymentMethodLabel: 'طريقة الدفع',
  'Payment Method': 'طريقة الدفع',
  agentEmail: 'الموظف',
  'Employee Email': 'الموظف',
};

function fieldLabel(field: string | null | undefined): string | null {
  if (!field) return null;
  return FIELD_AR[field] ?? field;
}

function inferField(message: string): string | null {
  if (/phone|mobile|جوال/i.test(message)) return 'رقم الجوال';
  if (/country|دول/i.test(message)) return 'الدولة';
  if (/product|منتج/i.test(message)) return 'المنتج';
  if (/external order|طلب خارجي/i.test(message)) return 'رقم الطلب الخارجي';
  if (/customer name|اسم العميل/i.test(message)) return 'اسم العميل';
  if (/address|عنوان/i.test(message)) return 'العنوان';
  if (/currency|عمل/i.test(message)) return 'العملة';
  if (/payment method|طريقة الدفع/i.test(message)) return 'طريقة الدفع';
  if (/employee|موظف/i.test(message)) return 'الموظف';
  if (/quantity|كمي/i.test(message)) return 'الكمية';
  if (/paid amount|المبلغ/i.test(message)) return 'المبلغ المدفوع';
  if (/order date|تاريخ/i.test(message)) return 'تاريخ الطلب';
  return null;
}

function arabicReason(issue: SheetErrorIssue): string {
  const message = issue.message.trim();
  if (/does not match the selected country/i.test(message)) {
    return 'رقم الجوال لا يتطابق مع الدولة';
  }
  if (/too short/i.test(message)) {
    return 'رقم الجوال أقصر من المطلوب للدولة';
  }
  if (/too long/i.test(message)) {
    return 'رقم الجوال أطول من المسموح للدولة';
  }
  if (/does not look like a phone/i.test(message)) {
    return 'القيمة ليست رقم جوال صالحاً';
  }
  if (
    /phone number is invalid/i.test(message) ||
    /phone number length is invalid/i.test(message)
  ) {
    return 'رقم الجوال غير صالح للدولة';
  }
  if (/phone is required|phone number is required/i.test(message)) {
    return 'رقم الجوال مطلوب';
  }
  if (
    /not a recognized Country|not found/i.test(message) &&
    /country/i.test(message)
  ) {
    return 'الدولة غير معروفة';
  }
  if (/already exists/i.test(message)) {
    return 'الطلب مستورد مسبقاً';
  }
  if (/duplicate /i.test(message)) {
    return 'قيمة مكررة في الملف';
  }
  if (/existing customer found by phone/i.test(message)) {
    return 'يوجد عميل بنفس رقم الجوال — يحتاج مراجعة';
  }
  if (/is required/i.test(message)) {
    const field = fieldLabel(issue.field) ?? inferField(message);
    return field ? `${field} مطلوب` : 'حقل مطلوب';
  }
  if (/not a valid date/i.test(message)) {
    return 'تاريخ الطلب غير صالح';
  }
  if (/must be a whole number/i.test(message)) {
    return 'الكمية يجب أن تكون عدداً صحيحاً أكبر من صفر';
  }
  if (/must be a non-negative number/i.test(message)) {
    return 'المبلغ المدفوع غير صالح';
  }
  if (/not a valid URL/i.test(message)) {
    return 'رابط الإيصال غير صالح';
  }
  if (/not found/i.test(message)) {
    const field = fieldLabel(issue.field) ?? inferField(message);
    return field ? `${field} غير معروفة` : 'قيمة غير معروفة';
  }
  return message;
}

/**
 * One grouped Arabic cell for a failed sheet row. Deduplicates by reason
 * (not by raw English text), so two phone issues never appear twice.
 */
export function formatStoreOrderSheetError(issues: SheetErrorIssue[]): string {
  const reasons: string[] = [];
  const seen = new Set<string>();
  for (const issue of issues) {
    const reason = arabicReason(issue);
    if (!reason || seen.has(reason)) continue;
    seen.add(reason);
    reasons.push(reason);
  }
  return reasons.join('؛ ');
}
