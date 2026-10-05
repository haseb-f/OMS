import { Prisma } from '@prisma/client';
import { lockProductsForUpdate } from '../../inventory/inventory.service';
import { movementIdempotencyKey } from '../../inventory/dto/movement-trace';
import type {
  ResolvedStockLine,
  ResolvedStockLines,
  StockLineInput,
  StockLineResolver,
} from '../../inventory/stock-lines/stock-line-resolver';

/**
 * R13 — the one entry point every selling / reserving document uses before
 * it writes stock (B2B order confirm, sales invoice confirm, Store Order
 * invoice, agent dispatch):
 *  1. `StockLineResolver` turns the document lines into the stock lines they
 *     move (kits → components, services dropped);
 *  2. every affected product row — the lines' own products AND the kit
 *     components — is locked ONCE, in sorted order, before any writer runs
 *     (two documents touching the same products can never deadlock, and no
 *     concurrent receipt can move a component's average mid-document);
 *  3. the kit snapshots' component costs are re-read under that lock, so the
 *     snapshot is the moving average at posting time.
 */
export async function resolveAndLockStockLines(
  tx: Prisma.TransactionClient,
  resolver: StockLineResolver,
  lines: StockLineInput[],
): Promise<ResolvedStockLines> {
  if (lines.length === 0) return { stock: [], kitSnapshots: {} };
  const resolved = await resolver.resolve(tx, lines);
  await lockProductsForUpdate(tx, [
    ...lines.map((line) => line.productId),
    ...resolved.stock.map((line) => line.productId),
  ]);

  const componentIds = [
    ...new Set(
      Object.values(resolved.kitSnapshots).flatMap((snapshot) =>
        snapshot.components.map((component) => component.productId),
      ),
    ),
  ];
  if (componentIds.length === 0) return resolved;
  const costs = new Map(
    (
      await tx.product.findMany({
        where: { id: { in: componentIds } },
        select: { id: true, currentCost: true },
      })
    ).map((product) => [
      product.id,
      new Prisma.Decimal(product.currentCost ?? 0).toString(),
    ]),
  );
  const kitSnapshots: ResolvedStockLines['kitSnapshots'] = {};
  for (const [lineKey, snapshot] of Object.entries(resolved.kitSnapshots)) {
    kitSnapshots[lineKey] = {
      ...snapshot,
      components: snapshot.components.map((component) => ({
        ...component,
        unitCost: costs.get(component.productId) ?? component.unitCost,
      })),
    };
  }
  return { stock: resolved.stock, kitSnapshots };
}

/**
 * Idempotency key of the movement a resolved stock line writes:
 * `<referenceType>:<referenceId>:<lineKey>[:<componentId>]:<type>` — a kit's
 * component movements are keyed per document line AND component.
 */
export function stockLineMovementKey(
  referenceType: string,
  referenceId: string,
  line: Pick<ResolvedStockLine, 'lineKey' | 'productId' | 'parentProductId'>,
  type: string,
): string {
  return movementIdempotencyKey(
    referenceType,
    referenceId,
    line.parentProductId ? `${line.lineKey}:${line.productId}` : line.lineKey,
    type,
  );
}

/** The traceability fields a resolved component line stamps on its movement (none for a plain line). */
export function stockLineTrace(line: ResolvedStockLine): {
  parentProductId?: string;
  recipeId?: string;
} {
  return line.parentProductId
    ? { parentProductId: line.parentProductId, recipeId: line.recipeId }
    : {};
}
