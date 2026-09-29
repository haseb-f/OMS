import type { CarrierChargeKind } from '@prisma/client';

const toMinor = (value: number) => Math.round(Number(value) * 100);

/**
 * Net actual carrier cost of a shipment's CONFIRMED charges
 * (commission-policy.md A6): base + surcharges − credits, or null when
 * nothing is confirmed. Amounts are stored positive; the kind gives the sign.
 */
export function netConfirmedCarrierCost(
  charges: Array<{ chargeAmount: unknown; chargeKind: CarrierChargeKind }>,
): number | null {
  if (charges.length === 0) return null;
  const minor = charges.reduce(
    (sum, charge) =>
      sum +
      (charge.chargeKind === 'CREDIT' ? -1 : 1) *
        toMinor(Number(charge.chargeAmount)),
    0,
  );
  return minor / 100;
}
