import { formatStoreOrderSheetError } from './store-orders-sync.messages';

describe('formatStoreOrderSheetError', () => {
  it('groups multiple validation errors into one Arabic cell without repeating values', () => {
    const message = formatStoreOrderSheetError([
      {
        field: 'Phone',
        message: 'Phone number does not match the selected country.',
      },
      {
        field: 'Phone',
        message: 'Phone number does not match the selected country.',
      },
      {
        field: 'Country',
        message: 'Country "XYZ" is not a recognized Country.',
      },
      {
        field: 'Country',
        message: 'Country "XYZ" is not a recognized Country.',
      },
    ]);
    expect(message).toBe('رقم الجوال لا يتطابق مع الدولة؛ الدولة غير معروفة');
    expect(message).not.toMatch(/Phone number/i);
    expect(message).not.toMatch(/XYZ/);
  });

  it('does not duplicate the same Arabic reason', () => {
    const message = formatStoreOrderSheetError([
      { message: 'Phone number is too short for the selected country.' },
      { message: 'Phone number is too short for the selected country.' },
    ]);
    expect(message).toBe('رقم الجوال أقصر من المطلوب للدولة');
  });
});
