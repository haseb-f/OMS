"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Per-user, per-table view preferences of `EnterpriseDataTable` (R7 A):
 * row density (compact / comfortable) and the list's presentation (table /
 * grid). Same convention as `column-width-preferences.ts` — the key carries
 * the user id, so two people sharing a browser never inherit each other's
 * layout, and nothing is written until the user is known.
 */
export type TablePreferenceName = "density" | "view";

export const TABLE_DENSITIES = ["compact", "comfortable"] as const;
export type TableDensityValue = (typeof TABLE_DENSITIES)[number];

export const TABLE_VIEWS = ["table", "grid"] as const;
export type TableViewValue = (typeof TABLE_VIEWS)[number];

type PreferenceStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** `oms.table.<userId>.<tableId>.<name>` — per user, per table. */
export function tablePreferenceKey(
  userId: string,
  tableId: string,
  name: TablePreferenceName,
): string {
  return `oms.table.${userId}.${tableId}.${name}`;
}

/**
 * The pre-R7 device-wide density key (stored as a JSON string by
 * `useLocalStorage`). Only density ever had one; the table/grid view is new.
 */
export function legacyDensityStorageKey(tableId: string): string {
  return `oms.table.${tableId}.density`;
}

/** Accepts `compact` and the JSON-encoded `"compact"` the legacy key held. */
function parseChoice<T extends string>(raw: string | null, allowed: readonly T[]): T | null {
  if (raw === null) return null;
  let value: unknown = raw;
  try {
    value = JSON.parse(raw);
  } catch {
    // A bare (non-JSON) value is read as is.
  }
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null;
}

/**
 * The user's saved density for one table. When the per-user key does not
 * exist, the old device-wide value is adopted ONCE (copied to the per-user
 * key and removed, so the next user on the device starts from the default).
 * Corrupt or inaccessible storage reads as "nothing saved" (`null`).
 */
export function readDensityPreference(
  storage: PreferenceStorage,
  userId: string,
  tableId: string,
): TableDensityValue | null {
  try {
    const key = tablePreferenceKey(userId, tableId, "density");
    const own = parseChoice(storage.getItem(key), TABLE_DENSITIES);
    if (own) return own;
    const legacyKey = legacyDensityStorageKey(tableId);
    const legacy = parseChoice(storage.getItem(legacyKey), TABLE_DENSITIES);
    if (!legacy) return null;
    storage.setItem(key, legacy);
    storage.removeItem(legacyKey);
    return legacy;
  } catch {
    return null;
  }
}

export function readViewPreference(
  storage: PreferenceStorage,
  userId: string,
  tableId: string,
): TableViewValue | null {
  try {
    return parseChoice(storage.getItem(tablePreferenceKey(userId, tableId, "view")), TABLE_VIEWS);
  } catch {
    return null;
  }
}

export function writeTablePreference(
  storage: PreferenceStorage,
  userId: string,
  tableId: string,
  name: TablePreferenceName,
  value: string,
): void {
  try {
    storage.setItem(tablePreferenceKey(userId, tableId, name), value);
  } catch {
    // Storage unavailable (private browsing, quota) — the choice still applies in memory.
  }
}

function browserStorage(): PreferenceStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function useStoredChoice<T extends string>(
  tableId: string,
  userId: string | null | undefined,
  name: TablePreferenceName,
  fallback: T,
  read: (storage: PreferenceStorage, userId: string, tableId: string) => T | null,
) {
  const scope = userId ? `${userId}\u0000${tableId}` : null;
  const [state, setState] = useState<{ scope: string | null; value: T }>({
    scope: null,
    value: fallback,
  });

  useEffect(() => {
    const storage = browserStorage();
    const saved = storage && userId ? read(storage, userId, tableId) : null;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState({ scope, value: saved ?? fallback });
    // `read` and `fallback` are module-level constants at every call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, userId, tableId]);

  const value = state.scope === scope ? state.value : fallback;

  const setValue = useCallback(
    (next: T) => {
      setState({ scope, value: next });
      const storage = browserStorage();
      if (storage && userId) writeTablePreference(storage, userId, tableId, name, next);
    },
    [scope, userId, tableId, name],
  );

  return [value, setValue] as const;
}

/** Row density of one table, remembered per user (falls back to the old device-wide value once). */
export function useTableDensityPreference(
  tableId: string,
  userId: string | null | undefined,
  fallback: TableDensityValue = "compact",
) {
  return useStoredChoice<TableDensityValue>(
    tableId,
    userId,
    "density",
    fallback,
    readDensityPreference,
  );
}

/** Table vs grid presentation of one list, remembered per user. */
export function useTableViewPreference(
  tableId: string,
  userId: string | null | undefined,
  fallback: TableViewValue = "table",
) {
  return useStoredChoice<TableViewValue>(tableId, userId, "view", fallback, readViewPreference);
}
