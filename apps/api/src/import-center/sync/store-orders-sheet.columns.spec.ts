import { columnLetterToIndex } from '../google-sheets.managed-columns';
import {
  SHIPPING_INPUT_COLUMN_NAMES,
  SHIPPING_RESULT_COLUMN_NAMES,
  STORE_ORDER_RESULT_COLUMN_NAMES,
  STORE_ORDERS_SHEET_LAYOUT,
  isEmptyShippingInput,
  missingShippingInputColumnNames,
  resolveShippingStatusHeader,
  shippingColumnMappingFromStoreOrders,
  shippingStatusHeaderRename,
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
      'Shipping Status',
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

  it('maps shipping fields preferring Shipping Status over legacy Status', () => {
    const mapping = shippingColumnMappingFromStoreOrders(
      {
        externalOrderId: 'External Order ID',
        customerName: 'Customer Name',
      },
      ['External Order ID', 'Shipping Status', 'Tracking Number'],
    );
    expect(mapping.externalOrderId).toBe('External Order ID');
    expect(mapping.status).toBe('Shipping Status');
    expect(mapping.trackingNumber).toBe('Tracking Number');
    expect(mapping.shippingCompanyName).toBe('Shipping Company');
    expect(mapping.labelUrl).toBe('Shipping Label URL');
    expect(mapping).not.toHaveProperty('customerName');
  });

  it('accepts legacy Status header as a Shipping Status alias', () => {
    expect(resolveShippingStatusHeader(['Status', 'Tracking Number'])).toBe(
      'Status',
    );
    expect(resolveShippingStatusHeader(['Shipping Status', 'Status'])).toBe(
      'Shipping Status',
    );
  });

  it('renames legacy Status in place and does not treat it as missing', () => {
    expect(shippingStatusHeaderRename(['Status', 'Tracking Number'])).toEqual({
      from: 'Status',
      to: 'Shipping Status',
    });
    expect(
      shippingStatusHeaderRename(['Shipping Status', 'Tracking Number']),
    ).toBeNull();
    expect(missingShippingInputColumnNames(['Status'])).toEqual([
      'Tracking Number',
      'Shipping Company',
      'Shipping Label URL',
    ]);
    expect(
      missingShippingInputColumnNames([
        'Shipping Status',
        'Tracking Number',
        'Shipping Company',
        'Shipping Label URL',
      ]),
    ).toEqual([]);
  });

  it('maps status to Shipping Status so setMapping never requires legacy Status', () => {
    const headers = [
      'External Order ID',
      'Shipping Status',
      'Tracking Number',
      'Shipping Company',
      'Shipping Label URL',
    ];
    const mapping = shippingColumnMappingFromStoreOrders(
      { externalOrderId: 'External Order ID' },
      headers,
    );
    expect(mapping.status).toBe('Shipping Status');
    expect(mapping.status).not.toBe('Status');
    expect(headers).toContain(mapping.status);
  });

  it('treats empty T:W as nothing to shipping-sync', () => {
    expect(isEmptyShippingInput({})).toBe(true);
    expect(isEmptyShippingInput({ status: '  ', trackingNumber: '' })).toBe(
      true,
    );
    expect(isEmptyShippingInput({ status: 'تم الشحن' })).toBe(false);
  });
});
