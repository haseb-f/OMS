import { FinancialTransactionType } from '@prisma/client';
import {
  FINANCIAL_TRANSACTION_TYPE_CATALOG,
  FINANCIAL_TRANSACTION_TYPE_SHEET_LABELS,
  resolveFinancialTransactionType,
  typesForDirection,
} from './financial-transaction-type.catalog';

describe('financial-transaction-type catalog', () => {
  it('exposes the closed Prisma enum values with Arabic labels; only the first three are sheet-importable', () => {
    expect(FINANCIAL_TRANSACTION_TYPE_CATALOG.map((type) => type.code)).toEqual(
      [
        FinancialTransactionType.CUSTOMER_RECEIPT,
        FinancialTransactionType.SUPPLIER_PAYMENT,
        FinancialTransactionType.EXPENSE_PAYMENT,
        FinancialTransactionType.CUSTOMER_REFUND,
        FinancialTransactionType.OTHER_RECEIPT,
        FinancialTransactionType.OTHER_PAYMENT,
        FinancialTransactionType.INTERNAL_TRANSFER,
      ],
    );
    expect(
      FINANCIAL_TRANSACTION_TYPE_CATALOG.map((type) => type.code).sort(),
    ).toEqual(Object.values(FinancialTransactionType).sort());
    expect(FINANCIAL_TRANSACTION_TYPE_SHEET_LABELS).toEqual({
      CUSTOMER_RECEIPT: 'تحصيل من عميل',
      SUPPLIER_PAYMENT: 'سداد مورد',
      EXPENSE_PAYMENT: 'مصروف تشغيلي',
    });
  });

  it('resolves enum codes and Arabic labels, never UUIDs', () => {
    expect(resolveFinancialTransactionType('CUSTOMER_RECEIPT')).toBe(
      'CUSTOMER_RECEIPT',
    );
    expect(resolveFinancialTransactionType('تحصيل من عميل')).toBe(
      'CUSTOMER_RECEIPT',
    );
    expect(resolveFinancialTransactionType('سداد مورد')).toBe(
      'SUPPLIER_PAYMENT',
    );
    expect(resolveFinancialTransactionType('مصروف تشغيلي')).toBe(
      'EXPENSE_PAYMENT',
    );
    expect(resolveFinancialTransactionType('رد مبلغ لعميل')).toBe(
      'CUSTOMER_REFUND',
    );
    expect(resolveFinancialTransactionType('تحصيل آخر')).toBe('OTHER_RECEIPT');
    expect(resolveFinancialTransactionType('صرف آخر')).toBe('OTHER_PAYMENT');
    expect(resolveFinancialTransactionType('تحويل بين الحسابات')).toBe(
      'INTERNAL_TRANSFER',
    );
    expect(resolveFinancialTransactionType('uuid-not-a-type')).toBeNull();
    expect(resolveFinancialTransactionType(undefined)).toBeNull();
  });

  it('filters receipts to IN and payments to OUT', () => {
    expect(typesForDirection('IN').map((type) => type.code)).toEqual([
      'CUSTOMER_RECEIPT',
      'OTHER_RECEIPT',
    ]);
    expect(typesForDirection('OUT').map((type) => type.code)).toEqual([
      'SUPPLIER_PAYMENT',
      'EXPENSE_PAYMENT',
      'CUSTOMER_REFUND',
      'OTHER_PAYMENT',
    ]);
    expect(typesForDirection('TRANSFER').map((type) => type.code)).toEqual([
      'INTERNAL_TRANSFER',
    ]);
  });
});
