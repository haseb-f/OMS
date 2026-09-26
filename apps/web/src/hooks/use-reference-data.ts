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
  DepartmentRow,
  CustomerClassificationRow,
  NoPurchaseReasonRow,
  LeadFollowUpTypeRow,
  PaymentMethodRow,
  InvestorTypeRow,
} from "@/config/master-data/entities";
import { usersService, type UserRow } from "@/services/users-service";
import { partnersService, type PartnerRow } from "@/services/partners-service";

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
  // Last request failed (or was forbidden) — callers show "empty", not a spinner.
  let failed = false;
  const listeners = new Set<() => void>();

  function ensureLoaded() {
    if (cache || inFlight) return;
    const request = fetcher()
      .then((data) => {
        if (inFlight !== request) return data;
        cache = data;
        inFlight = null;
        failed = false;
        listeners.forEach((listener) => listener());
        return data;
      })
      .catch(() => {
        if (inFlight !== request) return cache ?? [];
        // Do not cache failures as a permanent empty list — leave cache
        // unset so the next mount/invalidate can retry.
        inFlight = null;
        failed = true;
        listeners.forEach((listener) => listener());
        return cache ?? [];
      });
    inFlight = request;
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

  /**
   * True until the first response arrives. Read it in a component that also
   * calls the hook (the hook's subscription re-renders it on resolve). A
   * failed/forbidden request is "not loading" — an empty list, never a
   * spinner that never ends.
   */
  useReferenceData.isLoading = () => cache === null && !failed;

  /** For a rarer full edit/archive from the entity's own management page — refetch so selectors pick up the change without a full reload. */
  useReferenceData.invalidate = () => {
    cache = null;
    inFlight = null;
    failed = false;
    ensureLoaded();
  };

  return useReferenceData;
}

const currenciesService = createMasterDataService<CurrencyRow>("/currencies");
const countriesService = createMasterDataService<CountryRow>("/countries");

export const useCurrencies = createReferenceDataHook<CurrencyRow>(() =>
  currenciesService.list({ pageSize: 200 }).then((r) => r.items),
);

/** The whole ISO list (~250 rows) — the page size must never truncate it, or a country silently vanishes from every picker. */
export const useCountries = createReferenceDataHook<CountryRow>(() =>
  countriesService.list({ pageSize: 1000 }).then((r) => r.items),
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
  warehousesService
    .list({ pageSize: 200 })
    .then((r) => r.items.filter((row) => !row.deletedAt && row.isActive !== false)),
);

/** Supplier-role Partners — same "preferred supplier" picker Products uses (spec section 10: Suppliers are a role view over Partner). */
export const useSuppliers = createReferenceDataHook<PartnerRow>(() =>
  partnersService.catalog({ pageSize: 200, role: ["SUPPLIER"] }).then((r) => r.items),
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

const departmentsService = createMasterDataService<DepartmentRow>("/departments");

/** Active Departments for selectors — one request per session, never per table row. */
export const useDepartments = createReferenceDataHook<DepartmentRow>(() =>
  departmentsService
    .list({ pageSize: 200, sortBy: "sortOrder" })
    .then((r) => r.items.filter((row) => !row.deletedAt && row.isActive)),
);

const customerClassificationsService = createMasterDataService<CustomerClassificationRow>(
  "/customer-classifications",
);
const noPurchaseReasonsService =
  createMasterDataService<NoPurchaseReasonRow>("/no-purchase-reasons");
const leadFollowUpTypesService =
  createMasterDataService<LeadFollowUpTypeRow>("/lead-follow-up-types");
const paymentMethodsRefService = createMasterDataService<PaymentMethodRow>("/payment-methods");

export const useCustomerClassifications = createReferenceDataHook<CustomerClassificationRow>(() =>
  customerClassificationsService
    .list({ pageSize: 200, sortBy: "sortOrder" })
    .then((r) => r.items.filter((row) => !row.deletedAt && row.isActive)),
);

export const useNoPurchaseReasons = createReferenceDataHook<NoPurchaseReasonRow>(() =>
  noPurchaseReasonsService
    .list({ pageSize: 200, sortBy: "sortOrder" })
    .then((r) => r.items.filter((row) => !row.deletedAt && row.isActive)),
);

export const useLeadFollowUpTypes = createReferenceDataHook<LeadFollowUpTypeRow>(() =>
  leadFollowUpTypesService
    .list({ pageSize: 200, sortBy: "sortOrder" })
    .then((r) => r.items.filter((row) => !row.deletedAt && row.isActive)),
);

export const usePaymentMethods = createReferenceDataHook<PaymentMethodRow>(() =>
  paymentMethodsRefService
    .list({ pageSize: 200 })
    .then((r) => r.items.filter((row) => !row.deletedAt)),
);

const investorTypesService = createMasterDataService<InvestorTypeRow>("/investor-types");

/**
 * Every non-deleted Investor Type (active AND inactive) — unlike most
 * reference-data hooks, this deliberately does NOT filter to active-only.
 * The Investor form's select needs inactive types too, so an existing
 * Investor whose type was later deactivated still renders its historical
 * value (mission Part A #4/#69) instead of going blank; the page consuming
 * this hook is responsible for labeling/ordering inactive entries and the
 * backend (`InvestorTypesService.assertAssignable`) is the one and only
 * place that actually blocks assigning an inactive type.
 */
export const useInvestorTypes = createReferenceDataHook<InvestorTypeRow>(() =>
  investorTypesService.list({ pageSize: 200, sortBy: "sortOrder" }).then((r) => r.items),
);

import { jobTitlesService, type JobTitleRow } from "@/services/job-titles-service";
import { salesTeamsService, type SalesTeamRow } from "@/services/sales-teams-service";
import { employeesService, type EmployeeRow } from "@/services/employees-service";
import {
  payrollComponentsService,
  type PayrollComponentRow,
} from "@/services/payroll-components-service";

/** Active Payroll Components for selectors (Compensation lines, Payroll Line one-off components). */
export const usePayrollComponents = createReferenceDataHook<PayrollComponentRow>(() =>
  payrollComponentsService
    .list({ pageSize: 200, sortBy: "sortOrder" })
    .then((r) => r.items.filter((row) => !row.deletedAt && row.isActive)),
);

/** Active Job Titles for selectors (Employee wizard, KPI Template assignment). */
export const useJobTitles = createReferenceDataHook<JobTitleRow>(() =>
  jobTitlesService.listActive(),
);

/** Active Sales Teams for selectors (Employee wizard, Target/Commission scope). */
export const useSalesTeams = createReferenceDataHook<SalesTeamRow>(() =>
  salesTeamsService.list().then((rows) => rows.filter((row) => !row.deletedAt)),
);

/** Active Employees for selectors (KPI/Target/Commission employee pickers) — a bounded first page, refined further via `EntityCombobox`'s async `onSearch`. */
export const useEmployees = createReferenceDataHook<EmployeeRow>(() =>
  employeesService.list({ pageSize: 200, sortBy: "employeeCode" }).then((r) => r.items),
);

export function useUsersLookup(): Record<string, string> {
  const users = useUsersList();
  return useMemo(() => Object.fromEntries(users.map((u) => [u.id, u.fullName])), [users]);
}
