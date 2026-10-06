import { Prisma } from '@prisma/client';

/**
 * Pure recipe rules (R13 spec §3, §6) — no I/O, so they are unit-tested on their
 * own and the services only feed them data.
 */

/** Rounding of the whole-number test: stock quantities are integers, recipe quantities carry at most 6 decimals. */
const WHOLE_NUMBER_SCALE = 9;

/**
 * A stock quantity that must be a whole number of units (stock is stored as an
 * integer). Returns the integer, or `null` when the value is fractional, zero or
 * negative. The value is rounded to 9 decimals first so a quotient such as
 * `3 × (1 ÷ 3)` (0.99999999999999999999) still reads as the whole number it is.
 */
export function toWholeUnits(value: Prisma.Decimal): number | null {
  const rounded = value.toDecimalPlaces(
    WHOLE_NUMBER_SCALE,
    Prisma.Decimal.ROUND_HALF_UP,
  );
  if (!rounded.isInteger() || rounded.lte(0)) return null;
  const units = rounded.toNumber();
  return Number.isSafeInteger(units) ? units : null;
}

/**
 * Cycle detection over the ACTIVE recipes plus the candidate (spec §3: "full
 * walk through the components' active recipes"). `activeEdges` maps a product to
 * the components of its ACTIVE recipe; the candidate's own edges are
 * `rootComponents` (they replace whatever the graph holds for the root, which is
 * the version being replaced). Returns the path that closes a cycle through the
 * root (`[root, …, root]`), or `null` when the candidate is acyclic.
 */
export function findRecipeCycle(
  rootId: string,
  rootComponents: readonly string[],
  activeEdges: ReadonlyMap<string, readonly string[]>,
): string[] | null {
  const visited = new Set<string>();

  const visit = (node: string, path: string[]): string[] | null => {
    const children =
      node === rootId ? rootComponents : (activeEdges.get(node) ?? []);
    for (const child of children) {
      if (child === rootId) return [...path, child];
      if (visited.has(child)) continue;
      visited.add(child);
      const found = visit(child, [...path, child]);
      if (found) return found;
    }
    return null;
  };

  return visit(rootId, [rootId]);
}

export interface OwnedProduct {
  id: string;
  label: string;
  ownerAgentId: string | null;
}

/**
 * The ONE-owner rule (spec §6): the finished product and every component are all
 * company stock, or all belong to the same agent. Returns the message of the
 * first violation (naming the offenders), or `null` when the owner is uniform.
 */
export function ownerViolation(
  finished: OwnedProduct,
  components: readonly OwnedProduct[],
): string | null {
  const offenders = components.filter(
    (component) => component.ownerAgentId !== finished.ownerAgentId,
  );
  if (offenders.length === 0) return null;
  const ownerOf = (product: OwnedProduct) =>
    product.ownerAgentId ? `agent ${product.ownerAgentId}` : 'the company';
  return (
    `${finished.label} belongs to ${ownerOf(finished)} but ${offenders
      .map((product) => `${product.label} belongs to ${ownerOf(product)}`)
      .join(', ')}. ` +
    'A finished product and all its components must have the same owner — all company stock, or all the same agent.'
  );
}

const MAXIMUM_SCAN_STEPS = 10_000;

/**
 * Largest number of finished units that the available component stock allows,
 * counting only quantities for which EVERY component consumption is a whole
 * number (`perUnit × n`). `perUnit` is the component quantity per one finished
 * unit in stock units (may be fractional for a multi-unit recipe batch).
 * Scans downwards from the stock bound, so a recipe of "3 per 2 units" yields an
 * even count; a bounded scan keeps a pathological ratio from looping forever.
 */
export function maximumAssemblableQuantity(
  lines: readonly { perUnit: Prisma.Decimal; available: number }[],
): number {
  if (lines.length === 0) return 0;
  const bound = Math.min(
    ...lines.map((line) =>
      line.perUnit.lte(0)
        ? Number.POSITIVE_INFINITY
        : new Prisma.Decimal(Math.max(line.available, 0))
            .div(line.perUnit)
            .floor()
            .toNumber(),
    ),
  );
  if (!Number.isFinite(bound)) return 0;
  const lowest = Math.max(1, bound - MAXIMUM_SCAN_STEPS);
  for (let units = bound; units >= lowest; units -= 1) {
    if (lines.every((line) => toWholeUnits(line.perUnit.mul(units)) !== null)) {
      return units;
    }
  }
  return 0;
}
