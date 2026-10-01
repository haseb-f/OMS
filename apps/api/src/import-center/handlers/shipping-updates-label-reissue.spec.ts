import { isLabelReissue } from './shipping-updates-import.handler';

describe('isLabelReissue (Spec 1A label reissue via import / sheet sync)', () => {
  const current = {
    labelUrl: 'https://labels.test/old.pdf',
    trackingNumber: 'TRK-1',
  };

  it('a new label URL is a reissue', () => {
    expect(
      isLabelReissue(current, 'https://labels.test/new.pdf', undefined),
    ).toBe(true);
  });

  it('a new tracking number is a reissue', () => {
    expect(isLabelReissue(current, undefined, 'TRK-2')).toBe(true);
  });

  it('a synced row repeating the old label and tracking is not a reissue', () => {
    expect(
      isLabelReissue(current, 'https://labels.test/old.pdf', 'TRK-1'),
    ).toBe(false);
  });

  it('a row without label or tracking is not a reissue', () => {
    expect(isLabelReissue(current, undefined, undefined)).toBe(false);
  });

  it('the first label on a shipment without one counts', () => {
    expect(isLabelReissue(null, 'https://labels.test/new.pdf', undefined)).toBe(
      true,
    );
  });
});
