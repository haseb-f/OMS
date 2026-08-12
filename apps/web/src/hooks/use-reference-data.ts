"use client";

import { useEffect, useState } from "react";
import { createMasterDataService } from "@/services/master-data-service";
import type { CurrencyRow, CountryRow } from "@/config/master-data/entities";

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

  return function useReferenceData(): T[] {
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
  };
}

const currenciesService = createMasterDataService<CurrencyRow>("/currencies");
const countriesService = createMasterDataService<CountryRow>("/countries");

export const useCurrencies = createReferenceDataHook<CurrencyRow>(() =>
  currenciesService.list({ pageSize: 200 }).then((r) => r.items),
);

export const useCountries = createReferenceDataHook<CountryRow>(() =>
  countriesService.list({ pageSize: 300 }).then((r) => r.items),
);
