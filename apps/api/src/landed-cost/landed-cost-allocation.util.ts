/**
 * ADR-0017 (Cost Engine M1) — deterministic, zero-drift allocation of a
 * lump-sum amount across N bases (quantity or purchase value). Works
 * entirely in integer minor units (halalas/cents) so no floating-point
 * rounding can ever cause `sum(allocations) !== total` — the exact "no
 * lost halalas" requirement. Uses the largest-remainder method: divide
 * proportionally, truncate, then hand the leftover minor units one at a
 * time to the lines with the largest truncated remainder.
 */
export interface AllocationBasis {
  /** Opaque caller key (e.g. a Purchase Invoice Item id). */
  key: string;
  /** The proportional weight — a quantity, or a purchase value in major units. */
  weight: number;
}

export interface AllocationResult {
  key: string;
  amount: number;
}

/** @param totalAmount Major units (e.g. SAR, not halalas). */
export function allocateProportionally(
  totalAmount: number,
  bases: AllocationBasis[],
): AllocationResult[] {
  if (bases.length === 0) return [];
  const totalMinorUnits = Math.round(totalAmount * 100);
  const totalWeight = bases.reduce((sum, b) => sum + b.weight, 0);

  if (totalWeight <= 0) {
    // No valid basis to allocate against (e.g. every line has 0 qty/value)
    // — split evenly rather than silently allocating nothing.
    return allocateProportionally(
      totalAmount,
      bases.map((b) => ({ key: b.key, weight: 1 })),
    );
  }

  const shares = bases.map((b) => {
    const exact = (totalMinorUnits * b.weight) / totalWeight;
    const floor = Math.floor(exact);
    return { key: b.key, floor, remainder: exact - floor };
  });

  const allocatedMinorUnits = shares.reduce((sum, s) => sum + s.floor, 0);
  let leftover = totalMinorUnits - allocatedMinorUnits;

  // Largest remainder first; ties broken by input order (stable sort).
  const byRemainderDesc = [...shares].sort((a, b) => b.remainder - a.remainder);
  const bonusByKey = new Map<string, number>();
  for (let i = 0; i < byRemainderDesc.length && leftover > 0; i++, leftover--) {
    const key = byRemainderDesc[i].key;
    bonusByKey.set(key, (bonusByKey.get(key) ?? 0) + 1);
  }

  return shares.map((s) => ({
    key: s.key,
    amount: (s.floor + (bonusByKey.get(s.key) ?? 0)) / 100,
  }));
}
