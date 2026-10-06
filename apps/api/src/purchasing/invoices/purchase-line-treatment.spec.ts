import { BadRequestException } from '@nestjs/common';
import { PurchaseLineTreatment } from '@prisma/client';
import {
  assertLineTreatments,
  lineTaxIsCapitalized,
  lineTreatmentData,
  recognizedLineAmount,
} from './purchase-line-treatment';

describe('capitalized line amount (R13b, O-2 / IAS 16)', () => {
  const base = { lineTotal: 11400, taxAmount: 1400 };

  it('adds non-recoverable tax to a fixed asset line', () => {
    const item = {
      ...base,
      treatment: PurchaseLineTreatment.FIXED_ASSET,
      tax: { isRecoverable: false },
    };
    expect(lineTaxIsCapitalized(item)).toBe(true);
    expect(recognizedLineAmount(item)).toBe(11400);
  });

  it('keeps recoverable tax out of the asset (VAT Input)', () => {
    const item = {
      ...base,
      treatment: PurchaseLineTreatment.FIXED_ASSET,
      tax: { isRecoverable: true },
    };
    expect(lineTaxIsCapitalized(item)).toBe(false);
    expect(recognizedLineAmount(item)).toBe(10000);
  });

  it('never capitalizes tax on a prepaid or standard line', () => {
    for (const treatment of [
      PurchaseLineTreatment.PREPAID_EXPENSE,
      PurchaseLineTreatment.STANDARD,
    ]) {
      const item = { ...base, treatment, tax: { isRecoverable: false } };
      expect(lineTaxIsCapitalized(item)).toBe(false);
      expect(recognizedLineAmount(item)).toBe(10000);
    }
  });
});

describe('cost-addition lines (R13b, O-2)', () => {
  const line = {
    productId: 'p',
    unitId: 'u',
    quantity: 1,
    unitPrice: 400,
    treatment: PurchaseLineTreatment.FIXED_ASSET,
    linkedFixedAssetId: 'asset-1',
  };

  it('needs no useful life of its own and stores no schedule', () => {
    expect(() => assertLineTreatments([line], () => false)).not.toThrow();
    expect(lineTreatmentData(line)).toMatchObject({
      linkedFixedAssetId: 'asset-1',
      assetUsefulLifeMonths: null,
      scheduleStartDate: null,
    });
  });

  it('is refused on a line that is not recorded as a fixed asset', () => {
    expect(() =>
      assertLineTreatments(
        [{ ...line, treatment: PurchaseLineTreatment.STANDARD }],
        () => false,
      ),
    ).toThrow(BadRequestException);
  });
});
