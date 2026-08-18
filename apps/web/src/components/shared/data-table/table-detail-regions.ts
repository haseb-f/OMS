import type { ReactNode } from "react";

/**
 * One semantic detail region mapped onto the master table's column ids.
 * `endColumnId` may merge adjacent columns that share the same hide-class —
 * the engine never invents an independent grid.
 *
 * `grow: "until-next-region"` extends the region through following empty
 * non-utility columns (same hide-class) so unused master columns become
 * extra width for this content instead of a hole. The start column stays
 * the semantic owner.
 */
export interface TableDetailRegion {
  startColumnId: string;
  endColumnId?: string;
  grow?: "until-next-region";
  content: ReactNode;
}

export interface DetailColumnAxis {
  id: string;
  hideClass: string;
  utility?: boolean;
}

export interface LaidOutDetailCell {
  columnId: string;
  colSpan: number;
  hideClass: string;
  content: ReactNode | null;
}

function asAxis(column: string | DetailColumnAxis): DetailColumnAxis {
  return typeof column === "string" ? { id: column, hideClass: "" } : column;
}

function hasRegionContent(region: TableDetailRegion): boolean {
  return region.content != null && region.content !== false;
}

/**
 * Walks the same visible column id list the master row uses and emits one
 * cell per uncovered column. Regions become colspans clipped at hide-class
 * and utility boundaries; everything else is an empty continuation cell so
 * COLGROUP geometry is unchanged.
 */
export function layoutDetailRegions(
  columns: Array<string | DetailColumnAxis>,
  regions: TableDetailRegion[],
): LaidOutDetailCell[] {
  const axes = columns.map(asAxis);
  const ids = axes.map((column) => column.id);
  const covered = new Set<number>();
  const cells: LaidOutDetailCell[] = [];

  const starts = new Map<string, TableDetailRegion>();
  for (const region of regions) {
    if (!hasRegionContent(region)) continue;
    if (!starts.has(region.startColumnId)) starts.set(region.startColumnId, region);
  }

  for (let index = 0; index < axes.length; index++) {
    if (covered.has(index)) continue;
    const axis = axes[index];
    const region = starts.get(axis.id);
    if (!region) {
      covered.add(index);
      cells.push({
        columnId: axis.id,
        colSpan: 1,
        hideClass: axis.hideClass,
        content: null,
      });
      continue;
    }
    const requestedEnd = region.endColumnId ?? region.startColumnId;
    let endIndex = ids.indexOf(requestedEnd);
    if (endIndex < index) endIndex = index;
    for (let cursor = index + 1; cursor <= endIndex; cursor++) {
      if (axes[cursor].utility || axes[cursor].hideClass !== axis.hideClass) {
        endIndex = cursor - 1;
        break;
      }
    }
    if (region.grow === "until-next-region") {
      while (endIndex + 1 < axes.length) {
        const next = axes[endIndex + 1];
        if (next.utility) break;
        if (next.hideClass !== axis.hideClass) break;
        if (starts.has(next.id)) break;
        endIndex += 1;
      }
    }
    for (let cursor = index; cursor <= endIndex; cursor++) covered.add(cursor);
    cells.push({
      columnId: axis.id,
      colSpan: endIndex - index + 1,
      hideClass: axis.hideClass,
      content: region.content,
    });
  }

  return cells;
}

export function hasTableDetailContent(regions: TableDetailRegion[]): boolean {
  return regions.some(hasRegionContent);
}
