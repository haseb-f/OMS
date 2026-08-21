import { columnLetterToIndex } from '../google-sheets.managed-columns';
import {
  SHIPPING_INPUT_COLUMN_NAMES,
  SHIPPING_RESULT_COLUMN_NAMES,
  STORE_ORDER_RESULT_COLUMN_NAMES,
  STORE_ORDERS_SHEET_LAYOUT,
  isEmptyShippingInput,
  shippingColumnMappingFromStoreOrders,
} from './store-orders-sheet.columns';

describe('Store Orders shared Google Sheet columns', () => {
  it('reserves Q:R:S after the 16 source fields', () => {
    expect(STORE_ORDERS_SHEET_LAYOUT.sourceFieldCount).toBe(16);
    expect(STORE_ORDERS_SHEET_LAYOUT.storeOrderResultStartColumn).toBe('Q');
    expect(columnLetterToIndex('Q')).toBe(16);
    expect(STORE_ORDER_RESULT_COLUMN_NAMES).toEqual([
      'Sync Status',
      'System Order ID',
      'Error Message',
    ]);
  });

  it('reserves T:W as employee shipping input, not OMS write-back', () => {
    expect(STORE_ORDERS_SHEET_LAYOUT.shippingInputStartColumn).toBe('T');
    expect(columnLetterToIndex('T')).toBe(19);
    expect(columnLetterToIndex('W')).toBe(22);
    expect(SHIPPING_INPUT_COLUMN_NAMES).toEqual([
      'Status',
      'Tracking Number',
      'Shipping Company',
      'Shipping Label URL',
    ]);
  });

  it('reserves X and following for Shipping Sync results', () => {
    expect(STORE_ORDERS_SHEET_LAYOUT.shippingResultStartColumn).toBe('X');
    expect(columnLetterToIndex('X')).toBe(23);
    expect(SHIPPING_RESULT_COLUMN_NAMES).toEqual([
      'Shipping Sync Status',
      'Shipping Sync Message',
      'Shipment ID',
    ]);
  });

  it('maps shipping fields from the Store Orders source without creating a second source', () => {
    const mapping = shippingColumnMappingFromStoreOrders({
      externalOrderId: 'External Order ID',
      customerName: 'Customer Name',
    });
    expect(mapping.externalOrderId).toBe('External Order ID');
    expect(mapping.status).toBe('Status');
    expect(mapping.trackingNumber).toBe('Tracking Number');
    expect(mapping.shippingCompanyName).toBe('Shipping Company');
    expect(mapping.labelUrl).toBe('Shipping Label URL');
    expect(mapping).not.toHaveProperty('customerName');
  });

  it('treats empty T:W as nothing to shipping-sync', () => {
    expect(isEmptyShippingInput({})).toBe(true);
    expect(isEmptyShippingInput({ status: '  ', trackingNumber: '' })).toBe(
      true,
    );
    expect(isEmptyShippingInput({ status: 'تم الشحن' })).toBe(false);
  });
});
