import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsObject,
  IsOptional,
  IsUUID,
  ValidateIf,
} from 'class-validator';

/**
 * Server-side bulk target — never require the browser to download every
 * matching ID when the operator chooses “all filtered results”.
 *
 * - `ids`: explicit inclusion list (page / manual selection).
 * - `filter`: re-apply the caller's list query on the server; optional
 *   `excludeIds` remove unchecked rows after a select-all.
 */
export class BulkSelectionDto {
  @IsIn(['ids', 'filter'])
  mode!: 'ids' | 'filter';

  @ValidateIf((dto: BulkSelectionDto) => dto.mode === 'ids')
  @IsArray()
  @ArrayMaxSize(10_000)
  @IsUUID('4', { each: true })
  ids?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10_000)
  @IsUUID('4', { each: true })
  excludeIds?: string[];

  /** Module-specific filter bag — validated by the receiving service. */
  @ValidateIf((dto: BulkSelectionDto) => dto.mode === 'filter')
  @IsOptional()
  @IsObject()
  filters?: Record<string, unknown>;
}

export interface BulkActionSkip {
  id: string;
  reason: string;
}

export interface BulkActionResult {
  successIds: string[];
  skipped: BulkActionSkip[];
  blocked: BulkActionSkip[];
}

export function emptyBulkActionResult(): BulkActionResult {
  return { successIds: [], skipped: [], blocked: [] };
}

/** Resolve concrete IDs for `mode: 'ids'`; callers resolve `filter` themselves. */
export function requireBulkIds(dto: BulkSelectionDto): string[] {
  if (dto.mode !== 'ids') {
    throw new Error('requireBulkIds only accepts mode=ids');
  }
  const exclude = new Set(dto.excludeIds ?? []);
  return (dto.ids ?? []).filter((id) => !exclude.has(id));
}

export function applyExcludeIds(
  ids: string[],
  excludeIds?: string[],
): string[] {
  if (!excludeIds?.length) return ids;
  const exclude = new Set(excludeIds);
  return ids.filter((id) => !exclude.has(id));
}
