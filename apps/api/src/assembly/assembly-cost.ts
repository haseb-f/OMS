import { Prisma } from '@prisma/client';
import {
  round2,
  round4,
} from '../accounting/inventory-valuation/inventory-valuation.service';

type DecimalInput = Prisma.Decimal | string | number;

export interface AssemblyCostLineInput {
  componentProductId: string;
  /** Whole stock units consumed. */
  quantity: number;
  /** Moving-average cost at consumption. */
  unitCost: DecimalInput;
}

export interface AssemblyCostLine {
  componentProductId: string;
  quantity: number;
  /** 4 dp — as recorded on the movement and the order line. */
  unitCost: Prisma.Decimal;
  /** `round2(quantity × unitCost)` — the amount credited to the component's inventory account. */
  value: Prisma.Decimal;
}

export interface AssemblyCost {
  lines: AssemblyCostLine[];
  componentCost: Prisma.Decimal;
  directCost: Prisma.Decimal;
  /** Σ line values + direct cost — by construction what the journal debits and credits. */
  totalCost: Prisma.Decimal;
  /** `totalCost ÷ quantity`, 4 dp. The moving average blends the TOTAL, so the value stays exact. */
  unitCost: Prisma.Decimal;
}

/**
 * Assembly cost (R13 spec §4): each component line is valued at the moving
 * average it was consumed at (2-dp per line — the GL precision), the approved
 * direct cost is added, and the finished unit cost is the total over the
 * quantity at 4 dp. Pure arithmetic on `Prisma.Decimal` — never a float.
 */
export function computeAssemblyCost(input: {
  lines: AssemblyCostLineInput[];
  directCost: DecimalInput;
  quantity: number;
}): AssemblyCost {
  const lines = input.lines.map((line) => {
    const unitCost = round4(line.unitCost);
    return {
      componentProductId: line.componentProductId,
      quantity: line.quantity,
      unitCost,
      value: round2(unitCost.mul(line.quantity)),
    };
  });
  const componentCost = lines.reduce(
    (sum, line) => sum.add(line.value),
    new Prisma.Decimal(0),
  );
  const directCost = round2(input.directCost);
  const totalCost = componentCost.add(directCost);
  return {
    lines,
    componentCost,
    directCost,
    totalCost,
    unitCost: round4(totalCost.div(input.quantity)),
  };
}
