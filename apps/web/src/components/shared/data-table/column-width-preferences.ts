"use client";

import { useCallback, useEffect, useState } from "react";

export type ColumnWidths = Record<string, number>;

/** One stable empty value, so memoized layout math does not recompute every render. */
const NO_WIDTHS: ColumnWidths = Object.freeze({}) as ColumnWidths;

/** Per user, per table (R6 B4): `oms.table.<userId>.<tableId>.columnWidths`. */
export function columnWidthsStorageKey(userId: string, tableId: string): string {
  return `oms.table.${userId}.${tableId}.columnWidths`;
}

/** The pre-R6 device-wide key, read once and migrated to the per-user key. */
export function legacyColumnWidthsStorageKey(tableId: string): string {
  return `oms.table.${tableId}.columnWidths`;
}

type WidthStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function parseWidths(raw: string | null): ColumnWidths | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const widths: ColumnWidths = {};
    for (const [id, width] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof width === "number" && Number.isFinite(width) && width > 0) widths[id] = width;
    }
    return widths;
  } catch {
    return null;
  }
}

/**
 * Reads a user's saved widths for one table. When the per-user key does not
 * exist yet, the legacy device-wide key is adopted ONCE: copied to the
 * per-user key and removed, so the next user on the device starts clean.
 * Corrupt or inaccessible storage reads as "no saved widths".
 */
export function readColumnWidths(
  storage: WidthStorage,
  userId: string,
  tableId: string,
): ColumnWidths {
  try {
    const own = parseWidths(storage.getItem(columnWidthsStorageKey(userId, tableId)));
    if (own) return own;
    const legacyKey = legacyColumnWidthsStorageKey(tableId);
    const legacy = parseWidths(storage.getItem(legacyKey));
    if (!legacy) return {};
    storage.setItem(columnWidthsStorageKey(userId, tableId), JSON.stringify(legacy));
    storage.removeItem(legacyKey);
    return legacy;
  } catch {
    return {};
  }
}

export function writeColumnWidths(
  storage: WidthStorage,
  userId: string,
  tableId: string,
  widths: ColumnWidths,
): void {
  try {
    const key = columnWidthsStorageKey(userId, tableId);
    if (Object.keys(widths).length === 0) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify(widths));
  } catch {
    // Storage unavailable (private browsing, quota) — widths still apply in memory.
  }
}

function browserStorage(): WidthStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Column-width preference for `EnterpriseDataTable`, keyed per user. Until
 * the user is known (`userId` null) widths live in memory only — nothing is
 * written under an anonymous or wrong identity.
 */
export function useColumnWidthPreference(tableId: string, userId: string | null | undefined) {
  const [state, setState] = useState<{ scope: string | null; widths: ColumnWidths }>({
    scope: null,
    widths: NO_WIDTHS,
  });
  const scope = userId ? `${userId}\u0000${tableId}` : null;

  useEffect(() => {
    const storage = browserStorage();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState({
      scope,
      widths: storage && userId ? readColumnWidths(storage, userId, tableId) : NO_WIDTHS,
    });
  }, [scope, userId, tableId]);

  const widths = state.scope === scope ? state.widths : NO_WIDTHS;

  const setWidths = useCallback(
    (next: ColumnWidths | ((previous: ColumnWidths) => ColumnWidths)) => {
      setState((previous) => {
        const base = previous.scope === scope ? previous.widths : NO_WIDTHS;
        const resolved = typeof next === "function" ? next(base) : next;
        const storage = browserStorage();
        if (storage && userId) writeColumnWidths(storage, userId, tableId, resolved);
        return { scope, widths: resolved };
      });
    },
    [scope, userId, tableId],
  );

  return [widths, setWidths] as const;
}
