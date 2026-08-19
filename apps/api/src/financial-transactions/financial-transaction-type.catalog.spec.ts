import { FinancialTransactionType } from '@prisma/client';
import {
  FINANCIAL_TRANSACTION_TYPE_CATALOG,
  FINANCIAL_TRANSACTION_TYPE_SHEET_LABELS,
  resolveFinancialTransactionType,
  typesForDirection,
} from './financial-transaction-type.catalog';

describe('financial-transaction-type catalog', () => {
  it('exposes the three closed Prisma enum values with Arabic sheet labels', () => {
    expect(FINANCIAL_TRANSACTION_TYPE_CATALOG.map((type) => type.code)).toEqual(
      [
        FinancialTransactionType.CUSTOMER_RECEIPT,
        FinancialTransactionType.SUPPLIER_PAYMENT,
        FinancialTransactionType.EXPENSE_PAYMENT,
      ],
    );
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
    expect(resolveFinancialTransactionType('uuid-not-a-type')).toBeNull();
    expect(resolveFinancialTransactionType(undefined)).toBeNull();
  });

  it('filters receipts to IN and payments to OUT', () => {
    expect(typesForDirection('IN').map((type) => type.code)).toEqual([
      'CUSTOMER_RECEIPT',
    ]);
    expect(typesForDirection('OUT').map((type) => type.code)).toEqual([
      'SUPPLIER_PAYMENT',
      'EXPENSE_PAYMENT',
    ]);
  });
});
