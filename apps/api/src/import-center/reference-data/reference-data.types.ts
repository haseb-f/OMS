/** One Master Data record, normalized for import/template purposes regardless of which underlying model produced it. */
export interface ReferenceRecord {
  id: string;
  /** The entity's stable code (SKU, ISO code, account code, ...) — `null` for entities with no separate code column (matched by `name` instead). */
  code: string | null;
  /** Human display name. */
  name: string;
  /** `false` for a real, existing-but-deactivated record (`isActive`/`status` off) — never for a soft-deleted one, which is excluded from `list()` entirely, exactly like every "not found" row today. */
  active: boolean;
}

/**
 * One registered Master Data type (Country, Currency, Product, ...) —
 * the plug-in contract `ReferenceDataRegistryService` collects, mirroring
 * `ImportTypeHandler`'s "register at boot, engine never knows the business
 * specifics" shape. `list()` always returns EVERY non-deleted row
 * (active and inactive) so a caller can tell "doesn't exist" apart from
 * "exists but inactive" — Excel/Google Sheets dropdowns filter to
 * `active` themselves; import validation needs both.
 */
export interface ReferenceDataSource {
  readonly type: string;
  /** Human label for docs/UI, e.g. "Country". */
  readonly label: string;
  /** Which `ReferenceRecord` field an `ImportFieldDef` matches against unless it sets `referenceMatchField` itself. */
  readonly defaultMatchField: 'code' | 'name';
  list(): Promise<ReferenceRecord[]>;
}
