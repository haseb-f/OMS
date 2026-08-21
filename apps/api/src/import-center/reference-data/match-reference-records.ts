import {
  normalizeReferenceValue,
  referenceValueKey,
} from '../list-sheet/list-sheet.normalize';
import type { ReferenceRecord } from './reference-data.types';

/**
 * Matches spreadsheet display values against cached master-data records.
 * One implementation for every List Sheet column — Product, Country,
 * Currency, Payment Method, Employee, Shipping Company, Shipping Status.
 * Never fuzzy-matches, never auto-creates, never treats a UUID as required.
 */
export function matchReferenceRecords(
  records: ReferenceRecord[],
  matchField: 'code' | 'name',
  rawValue: string,
): ReferenceRecord[] {
  const needle = referenceValueKey(rawValue);
  if (!needle) return [];
  return records.filter((record) => {
    const candidate = matchField === 'code' ? record.code : record.name;
    if (candidate == null || candidate === '') return false;
    return referenceValueKey(candidate) === needle;
  });
}

/**
 * Documented `Name (CODE)` suffix fallback used by Country dropdowns
 * (`referenceDisplayWithCode`). Not a silent SKU/name swap — the code
 * inside the parentheses must still match exactly.
 */
export function matchCodeSuffix(
  records: ReferenceRecord[],
  rawValue: string,
): ReferenceRecord[] {
  const codeSuffix = /\(([^()]+)\)\s*$/.exec(
    normalizeReferenceValue(rawValue),
  )?.[1];
  if (!codeSuffix) return [];
  return matchReferenceRecords(records, 'code', codeSuffix);
}

export function masterDataNotFoundMessage(type: string, value: string): string {
  const display = normalizeReferenceValue(value);
  switch (type) {
    case 'PRODUCT':
      return `المنتج «${display}» غير موجود في المنتجات الأساسية.`;
    case 'COUNTRY':
      return `الدولة «${display}» غير موجودة في البيانات الأساسية.`;
    case 'CURRENCY':
      return `العملة «${display}» غير موجودة في البيانات الأساسية.`;
    case 'PAYMENT_METHOD':
      return `طريقة الدفع «${display}» غير موجودة في البيانات الأساسية.`;
    case 'EMPLOYEE':
      return `الموظف «${display}» غير موجود في البيانات الأساسية.`;
    case 'SHIPPING_COMPANY':
      return `شركة الشحن «${display}» غير موجودة في البيانات الأساسية.`;
    case 'SHIPPING_STATUS':
      return `حالة الشحن «${display}» غير موجودة في البيانات الأساسية.`;
    default:
      return `«${display}» غير موجودة في البيانات الأساسية.`;
  }
}

export function masterDataAmbiguousMessage(
  type: string,
  value: string,
): string {
  const display = normalizeReferenceValue(value);
  switch (type) {
    case 'PRODUCT':
      return `يوجد أكثر من منتج مطابق للقيمة «${display}». يرجى اختيار المنتج الصحيح من البيانات الأساسية.`;
    case 'COUNTRY':
      return `يوجد أكثر من دولة مطابقة للقيمة «${display}». يرجى اختيار القيمة الصحيحة من البيانات الأساسية.`;
    case 'CURRENCY':
      return `يوجد أكثر من عملة مطابقة للقيمة «${display}». يرجى اختيار القيمة الصحيحة من البيانات الأساسية.`;
    case 'PAYMENT_METHOD':
      return `يوجد أكثر من طريقة دفع مطابقة للقيمة «${display}». يرجى اختيار القيمة الصحيحة من البيانات الأساسية.`;
    case 'EMPLOYEE':
      return `يوجد أكثر من موظف مطابق للقيمة «${display}». يرجى اختيار القيمة الصحيحة من البيانات الأساسية.`;
    case 'CUSTOMER':
      return `يوجد أكثر من عميل مطابق للقيمة «${display}». يرجى اختيار العميل الصحيح من البيانات الأساسية.`;
    case 'SHIPPING_COMPANY':
      return `يوجد أكثر من شركة شحن مطابقة للقيمة «${display}». يرجى اختيار القيمة الصحيحة من البيانات الأساسية.`;
    case 'SHIPPING_STATUS':
      return `يوجد أكثر من حالة شحن مطابقة للقيمة «${display}». يرجى اختيار القيمة الصحيحة من البيانات الأساسية.`;
    default:
      return `يوجد أكثر من سجل مطابق للقيمة «${display}». يرجى اختيار القيمة الصحيحة من البيانات الأساسية.`;
  }
}

export function masterDataInactiveMessage(
  sourceLabel: string,
  value: string,
): string {
  const display = normalizeReferenceValue(value);
  return `«${display}» موجودة لكنها غير نشطة — اختر ${sourceLabel} نشطة، أو فعّلها أولاً.`;
}
