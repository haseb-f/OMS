/**
 * Investor Engine Milestone 1 — the one capital/participation calculation
 * used by InvestmentOpportunitiesService/InvestorSubscriptionsService, same
 * per-domain `round2` convention as sales-totals.util.ts/
 * invoice-payment.util.ts. Server-computed only — the frontend may preview
 * these numbers but never supplies them.
 */

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export interface OpportunityProductCapitalInput {
  fundedUnits: number;
  fundedUnitCost: number;
}

/** Target Capital = SUM(fundedUnits * fundedUnitCost) across every Opportunity Product (Phase 7). */
export function computeTargetCapital(
  products: OpportunityProductCapitalInput[],
): number {
  return round2(
    products.reduce((sum, p) => sum + p.fundedUnits * p.fundedUnitCost, 0),
  );
}

export interface SubscriptionFundingInput {
  id: string;
  committedAmount: number;
  fundedAmount: number;
}

/**
 * Participation % (Phase 10/11) — each Investor's share of the investor pool
 * is their confirmed funded amount divided by the total confirmed funded
 * amount across every subscription on the Opportunity. Zero total funding
 * means zero participation for everyone (never divide by zero, never 100%
 * for a single not-yet-funded investor).
 */
export function computeParticipationPercents(
  subscriptions: SubscriptionFundingInput[],
): Map<string, number> {
  const totalFunded = subscriptions.reduce((sum, s) => sum + s.fundedAmount, 0);
  const result = new Map<string, number>();
  for (const s of subscriptions) {
    const percent = totalFunded > 0 ? (s.fundedAmount / totalFunded) * 100 : 0;
    result.set(s.id, Math.round(percent * 10000) / 10000);
  }
  return result;
}
