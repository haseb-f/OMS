"use client";

import { useEffect, useMemo, useState } from "react";
import { createMasterDataService } from "@/services/master-data-service";
import type {
  CurrencyRow,
  CountryRow,
  CategoryRow,
  BrandRow,
  UnitRow,
  TaxRow,
  AnalyticAccountRow,
  WarehouseRow,
} from "@/config/master-data/entities";
import { usersService, type UserRow } from "@/services/users-service";
import { suppliersService, type SupplierRow } from "@/services/suppliers-service";

/**
 * Session-lifetime cache for read-mostly reference data (currencies,
 * countries) that was independently fetched on mount by a dozen-plus
 * pages/dialogs across the app — every navigation between them re-fetched
 * the same rows from scratch. Each entity is fetched at most once per
 * browser session: the first caller triggers the request, later callers
 * reuse the in-flight promise or the resolved cache, and every mounted
 * hook instance re-renders together once it resolves.
 *
 * This trades a small amount of staleness (a currency/country added via
 * its own management page won't appear elsewhere until a full reload) for
 * eliminating dozens of duplicate requests — the same tradeoff any
 * reference-data cache makes, appropriate here since neither list changes
 * during normal day-to-day use.
 */
function createReferenceDataHook<T>(fetcher: () => Promise<T[]>) {
  let cache: T[] | null = null;
  let inFlight: Promise<T[]> | null = null;
  const listeners = new Set<() => void>();

  function ensureLoaded() {
    if (cache || inFlight) return;
    inFlight = fetcher()
      .then((data) => {
        cache = data;
        inFlight = null;
        listeners.forEach((listener) => listener());
        return data;
      })
      .catch(() => {
        cache = [];
        inFlight = null;
        listeners.forEach((listener) => listener());
        return [];
      });
  }

  function useReferenceData(): T[] {
    const [, forceRender] = useState(0);

    useEffect(() => {
      ensureLoaded();
      const listener = () => forceRender((n) => n + 1);
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }, []);

    return cache ?? [];
  }

  /**
   * Cache invalidation (never a blanket "clear everything") — a quick-create
   * dialog appends the row it just created so it shows up immediately in
   * every mounted consumer without a full reload or a redundant refetch.
   */
  useReferenceData.add = (item: T) => {
    cache = cache ? [...cache, item] : [item];
    listeners.forEach((listener) => listener());
  };

  /** For a rarer full edit/archive from the entity's own management page — refetch on next read instead of trying to patch the cached array in place. */
  useReferenceData.invalidate = () => {
    cache = null;
    inFlight = null;
    listeners.forEach((listener) => listener());
  };

  return useReferenceData;
}

const currenciesService = createMasterDataService<CurrencyRow>("/currencies");
const countriesService = createMasterDataService<CountryRow>("/countries");

export const useCurrencies = createReferenceDataHook<CurrencyRow>(() =>
  currenciesService.list({ pageSize: 200 }).then((r) => r.items),
);

export const useCountries = createReferenceDataHook<CountryRow>(() =>
  countriesService.list({ pageSize: 300 }).then((r) => r.items),
);

/**
 * Same duplication proven for currencies/countries above, found again
 * verbatim between the Products list page and Product detail page: both
 * independently fetched Category/Brand/Unit/Tax/AnalyticAccount/Warehouse/
 * Supplier on every mount (7 requests each way, every navigation between
 * the two screens). Centralized here rather than left as two copies of the
 * same six `useState`+`useEffect` blocks.
 */
const categoriesService = createMasterDataService<CategoryRow>("/product-categories");
const brandsService = createMasterDataService<BrandRow>("/product-brands");
const unitsService = createMasterDataService<UnitRow>("/units");
const taxesService = createMasterDataService<TaxRow>("/taxes");
const analyticAccountsService = createMasterDataService<AnalyticAccountRow>("/analytic-accounts");
const warehousesService = createMasterDataService<WarehouseRow>("/warehouses");

export const useProductCategories = createReferenceDataHook<CategoryRow>(() =>
  categoriesService.list({ pageSize: 200 }).then((r) => r.items),
);

export const useProductBrands = createReferenceDataHook<BrandRow>(() =>
  brandsService.list({ pageSize: 200 }).then((r) => r.items),
);

export const useUnits = createReferenceDataHook<UnitRow>(() =>
  unitsService.list({ pageSize: 200 }).then((r) => r.items),
);

export const useTaxes = createReferenceDataHook<TaxRow>(() =>
  taxesService.list({ pageSize: 200 }).then((r) => r.items),
);

export const useAnalyticAccounts = createReferenceDataHook<AnalyticAccountRow>(() =>
  analyticAccountsService.list({ pageSize: 200 }).then((r) => r.items),
);

export const useWarehouses = createReferenceDataHook<WarehouseRow>(() =>
  warehousesService.list({ pageSize: 200 }).then((r) => r.items),
);

export const useSuppliers = createReferenceDataHook<SupplierRow>(() =>
  suppliersService.list({ pageSize: 200 }).then((r) => r.items),
);

/**
 * Users were the other systemic duplicate: 14 list pages independently
 * fetched the entire user table just to build an id -> fullName map for a
 * "created by" column. Note: `GET /users` requires the `settings.manage`
 * permission (unchanged here, not something this refactor alters) — a user
 * without it gets the same empty map today as before, just without
 * re-attempting the request on every page navigation.
 */
export const useUsersList = createReferenceDataHook<UserRow>(() => usersService.list());

export function useUsersLookup(): Record<string, string> {
  const users = useUsersList();
  return useMemo(() => Object.fromEntries(users.map((u) => [u.id, u.fullName])), [users]);
}
