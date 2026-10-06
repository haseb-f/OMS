/**
 * Visible inheritance of a new product's unit and tax from its category
 * (spec §2). Picking a category pre-fills the unit / tax the category defines;
 * the user may override either, and from then on the value is theirs: a later
 * category change no longer touches it. Pure and unit-tested.
 */
export interface CategoryDefaults {
  defaultUnitId?: string | null;
  defaultTaxId?: string | null;
}

export interface InheritedFlags {
  unit: boolean;
  tax: boolean;
}

export const NOT_INHERITED: InheritedFlags = { unit: false, tax: false };

export interface CategoryDefaultsResult {
  unitId: string;
  taxId: string;
  inherited: InheritedFlags;
}

/**
 * A field is (re)filled only while it is empty or still the previous category's
 * inherited value — a manual choice is never overwritten. A category without a
 * default leaves the field as it is (an inherited value is kept as the user's).
 */
export function applyCategoryDefaults(
  current: { unitId: string; taxId: string },
  inherited: InheritedFlags,
  category: CategoryDefaults | undefined,
): CategoryDefaultsResult {
  const next: CategoryDefaultsResult = { ...current, inherited: { ...inherited } };
  const unit = category?.defaultUnitId;
  if (unit && (!current.unitId || inherited.unit)) {
    next.unitId = unit;
    next.inherited.unit = true;
  } else if (!unit && inherited.unit) {
    // The previous category's unit stays, but is no longer "from the category".
    next.inherited.unit = false;
  }
  const tax = category?.defaultTaxId;
  if (tax && (!current.taxId || inherited.tax)) {
    next.taxId = tax;
    next.inherited.tax = true;
  } else if (!tax && inherited.tax) {
    next.inherited.tax = false;
  }
  return next;
}
