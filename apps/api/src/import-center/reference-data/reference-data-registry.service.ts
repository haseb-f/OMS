import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  ReferenceDataSource,
  ReferenceRecord,
} from './reference-data.types';
import { getReferenceCache } from './reference-cache';

/**
 * Register-at-boot plug-in registry for Master Data reference types — the
 * same "engine never knows the business specifics" shape
 * `ImportTypeRegistryService` already established for Import Types.
 * `ReferenceDataSourcesService.onModuleInit()` is the one caller of
 * `register()`; every other consumer (the resolver in
 * `import-value.util.ts`, `ImportTemplateService`'s Excel dropdowns, the
 * Google Sheets reference worksheet, the `/import-center/reference-data`
 * API) only ever calls `get()`/`list()`.
 */
@Injectable()
export class ReferenceDataRegistryService {
  private readonly sources = new Map<string, ReferenceDataSource>();

  register(source: ReferenceDataSource) {
    this.sources.set(source.type, source);
  }

  get(type: string): ReferenceDataSource {
    const source = this.sources.get(type);
    if (!source) {
      throw new NotFoundException(
        `No reference data source registered for "${type}".`,
      );
    }
    return source;
  }

  list(): ReferenceDataSource[] {
    return [...this.sources.values()];
  }

  /**
   * Every record for `type`, cached for the lifetime of the current
   * `runWithReferenceCache()` scope (one Import Job `validate()`/`run()`
   * call) — see `reference-cache.ts`. Outside that scope (a direct API
   * call for the Excel/Google Sheets dropdown, or a unit test) this always
   * fetches fresh, since there's nothing to invalidate a longer-lived
   * cache on Master Data change.
   */
  async listCached(type: string): Promise<ReferenceRecord[]> {
    const cache = getReferenceCache();
    const cacheKey = `reference-data:${type}`;
    const cached = cache?.get(cacheKey);
    if (cached) return cached as ReferenceRecord[];

    const records = await this.get(type).list();
    cache?.set(cacheKey, records);
    return records;
  }

  /**
   * Resolves a spreadsheet/CSV display value (a code or name) to the
   * record's id — the Master-Data-aware replacement for
   * `resolveRequiredIdByField`. Never guesses/fuzzy-matches (spec: "The
   * import must NOT guess") and never auto-creates the referenced record
   * (spec: "MASTER DATA MUST EXIST FIRST") — an unrecognized value and an
   * existing-but-inactive one get distinct, actionable error codes so the
   * import report/UI can tell them apart (spec section 7 vs 8).
   */
  async resolveRequired(
    type: string,
    matchField: 'code' | 'name',
    value: string | undefined,
    label: string,
  ): Promise<string> {
    const trimmed = value?.trim();
    if (!trimmed) {
      throw new BadRequestException(`${label} is required.`);
    }
    return this.resolveValue(type, matchField, trimmed, label);
  }

  /** Same as `resolveRequired`, but an empty value resolves to `undefined` instead of throwing — for optional foreign keys. */
  async resolveOptional(
    type: string,
    matchField: 'code' | 'name',
    value: string | undefined,
    label: string,
  ): Promise<string | undefined> {
    const trimmed = value?.trim();
    if (!trimmed) return undefined;
    return this.resolveValue(type, matchField, trimmed, label);
  }

  private async resolveValue(
    type: string,
    matchField: 'code' | 'name',
    trimmed: string,
    label: string,
  ): Promise<string> {
    const source = this.get(type);
    const records = await this.listCached(type);
    const match = records.find((record) => {
      const candidate = matchField === 'code' ? record.code : record.name;
      return (
        candidate != null && candidate.toLowerCase() === trimmed.toLowerCase()
      );
    });
    if (!match) {
      throw new BadRequestException({
        code: 'MASTER_DATA_NOT_FOUND',
        message: `${label} "${trimmed}" is not a recognized ${source.label} — choose an existing ${source.label.toLowerCase()} instead of typing a new one.`,
        field: label,
      });
    }
    if (!match.active) {
      throw new BadRequestException({
        code: 'MASTER_DATA_INACTIVE',
        message: `${label} "${trimmed}" exists but is not active — choose an active ${source.label.toLowerCase()}, or activate it first.`,
        field: label,
      });
    }
    return match.id;
  }
}
