"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
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
import { partnersService, type PartnerPickerRow } from "@/services/partners-service";
import { useUserContext } from "@/providers/user-context";
import { fetchAllPages } from "@/lib/fetch-all-pages";
import {
  createScopedListCache,
  currentDataScope,
  subscribeDataScope,
} from "@/lib/client-data-scope";

/**
 * Session-lifetime cache for read-mostly reference data (currencies,
 * countries) that was independently fetched on mount by a dozen-plus
 * pages/dialogs across the app — every navigation between them re-fetched
 * the same rows from scratch. Each entity is fetched at most once per
 * identity: the first caller triggers the request, later callers reuse the
 * in-flight promise or the resolved cache, and every mounted hook instance
 * re-renders together once it resolves.
 *
 * SEC-02: the store is `createScopedListCache` — scoped to the signed-in
 * identity (user + company + permission set) and registered with the
 * central `resetClientDataCaches()` registry, so a logout → login in the
 * same tab can never hand the next user rows fetched for the previous one.
 * Mounted hooks re-run their load when the scope changes.
 *
 * Within one identity this trades a small amount of staleness (a currency
 * added via its own management page won't appear elsewhere until a reload)
 * for eliminating dozens of duplicate requests.
 */
const NO_ROWS: never[] = [];

function createReferenceDataHook<T>(name: string, fetcher: () => Promise<T[]>) {
  const store = createScopedListCache<T>(name, fetcher);

  /**
   * `enabled: false` subscribes without requesting — for data the current
   * user is not allowed to list (the request would only 403). A disabled
   * hook always returns `[]`, never rows cached by an earlier request.
   */
  function useReferenceData({ enabled = true }: { enabled?: boolean } = {}): T[] {
    const [, forceRender] = useState(0);
    const scope = useSyncExternalStore(subscribeDataScope, currentDataScope, currentDataScope);

    useEffect(() => {
      if (enabled) store.ensureLoaded();
      return store.subscribe(() => forceRender((n) => n + 1));
    }, [enabled, scope]);

    if (!enabled) return NO_ROWS;
    return store.read() ?? NO_ROWS;
  }

  /**
   * Cache invalidation (never a blanket "clear everything") — a quick-create
   * dialog appends the row it just created so it shows up immediately in
   * every mounted consumer without a full reload or a redundant refetch.
   */
  useReferenceData.add = store.add;

  /**
   * True until the first response arrives. Read it in a component that also
   * calls the hook (the hook's subscription re-renders it on resolve). A
   * failed/forbidden request is "not loading" — an empty list, never a
   * spinner that never ends.
   */
  useReferenceData.isLoading = store.isLoading;

  /** For a rarer full edit/archive from the entity's own management page — refetch so selectors pick up the change without a full reload. */
  useReferenceData.invalidate = store.invalidate;

  return useReferenceData;
}

const currenciesService = createMasterDataService<CurrencyRow>("/currencies");
const countriesService = createMasterDataService<CountryRow>("/countries");

/**
 * Every row of a paged master-data list — a picker must never silently stop
 * at the first page (a currency or payment method past row 200 would vanish
 * from every selector).
 */
function fetchAllRows<T>(service: {
  list: (params: { page: number; pageSize: number }) => Promise<{ items: T[]; total: number }>;
}): Promise<T[]> {
  return fetchAllPages((page, pageSize) => service.list({ page, pageSize })).then((r) => r.rows);
}

/** All currencies (paged until done) — the shared currency picker's source. */
export const fetchAllCurrencies = () => fetchAllRows(currenciesService);

export const useCurrencies = createReferenceDataHook<CurrencyRow>("currencies", fetchAllCurrencies);

/** The whole ISO list (~250 rows) — the page size must never truncate it, or a country silently vanishes from every picker. */
export const useCountries = createReferenceDataHook<CountryRow>("countries", () =>
  countriesService.list({ pageSize: 1000 }).then((r) => r.items),
);

/**
 * Paged until done (never a single capped page): a picker that loads only the first N rows and filters in the browser
 * silently hides every later category/unit/tax — found by the R13 UI journey with 400+ categories.
 *
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

export const fetchAllProductCategories = () => fetchAllRows(categoriesService);

export const useProductCategories = createReferenceDataHook<CategoryRow>(
  "productCategories",
  fetchAllProductCategories,
);

export const useProductBrands = createReferenceDataHook<BrandRow>("productBrands", () =>
  fetchAllRows(brandsService),
);

export const fetchAllUnits = () => fetchAllRows(unitsService);

export const useUnits = createReferenceDataHook<UnitRow>("units", fetchAllUnits);

export const useTaxes = createReferenceDataHook<TaxRow>("taxes", () => fetchAllRows(taxesService));

export const useAnalyticAccounts = createReferenceDataHook<AnalyticAccountRow>(
  "analyticAccounts",
  () => fetchAllRows(analyticAccountsService),
);

export const useWarehouses = createReferenceDataHook<WarehouseRow>("warehouses", () =>
  fetchAllRows(warehousesService).then((rows) =>
    rows.filter((row) => !row.deletedAt && row.isActive !== false),
  ),
);

/** Supplier-role Partners — same "preferred supplier" picker Products uses (spec section 10: Suppliers are a role view over Partner). */
export const useSuppliers = createReferenceDataHook<PartnerPickerRow>("suppliers", () =>
  partnersService.catalog({ pageSize: 200, role: ["SUPPLIER"] }).then((r) => r.items),
);

/**
 * Users were the other systemic duplicate: 14 list pages independently
 * fetched the entire user table just to build an id -> fullName map for a
 * "created by" column. `GET /users` requires `settings.manage` and no
 * lighter user-listing endpoint exists for other roles, so the request is
 * only ever sent for a user who holds that permission — everyone else gets
 * an empty list (not loading) instead of a 403 on every document page.
 */
const usersListCache = createReferenceDataHook<UserRow>("users", () => usersService.list());

export const USERS_LIST_PERMISSION = "settings.manage";

/** Users + whether they are still loading, permission-aware (see `usersListCache`). */
export function useUsersListState(): { users: UserRow[]; loading: boolean; canList: boolean } {
  const { status, hasPermission } = useUserContext();
  const canList = status === "authenticated" && hasPermission(USERS_LIST_PERMISSION);
  const users = usersListCache({ enabled: canList });
  const loading = status === "loading" || (canList && usersListCache.isLoading());
  return { users, loading, canList };
}

export const useUsersList = Object.assign(
  function useUsersList(): UserRow[] {
    return useUsersListState().users;
  },
  // Loading state lives in `useUsersListState` (permission-aware).
  { invalidate: usersListCache.invalidate },
);

const departmentsService = createMasterDataService<DepartmentRow>("/departments");

/** Active Departments for selectors — one request per session, never per table row. */
export const useDepartments = createReferenceDataHook<DepartmentRow>("departments", () =>
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

export const useCustomerClassifications = createReferenceDataHook<CustomerClassificationRow>(
  "customerClassifications",
  () =>
    customerClassificationsService
      .list({ pageSize: 200, sortBy: "sortOrder" })
      .then((r) => r.items.filter((row) => !row.deletedAt && row.isActive)),
);

export const useNoPurchaseReasons = createReferenceDataHook<NoPurchaseReasonRow>(
  "noPurchaseReasons",
  () =>
    noPurchaseReasonsService
      .list({ pageSize: 200, sortBy: "sortOrder" })
      .then((r) => r.items.filter((row) => !row.deletedAt && row.isActive)),
);

export const useLeadFollowUpTypes = createReferenceDataHook<LeadFollowUpTypeRow>(
  "leadFollowUpTypes",
  () =>
    leadFollowUpTypesService
      .list({ pageSize: 200, sortBy: "sortOrder" })
      .then((r) => r.items.filter((row) => !row.deletedAt && row.isActive)),
);

/** All non-deleted payment methods (paged until done) — the shared payment-method picker's source. */
export const fetchAllPaymentMethods = () =>
  fetchAllRows(paymentMethodsRefService).then((rows) => rows.filter((row) => !row.deletedAt));

export const usePaymentMethods = createReferenceDataHook<PaymentMethodRow>(
  "paymentMethods",
  fetchAllPaymentMethods,
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
export const useInvestorTypes = createReferenceDataHook<InvestorTypeRow>("investorTypes", () =>
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
export const usePayrollComponents = createReferenceDataHook<PayrollComponentRow>(
  "payrollComponents",
  () =>
    payrollComponentsService
      .list({ pageSize: 200, sortBy: "sortOrder" })
      .then((r) => r.items.filter((row) => !row.deletedAt && row.isActive)),
);

/** Active Job Titles for selectors (Employee wizard, KPI Template assignment). */
export const useJobTitles = createReferenceDataHook<JobTitleRow>("jobTitles", () =>
  jobTitlesService.listActive(),
);

/** Active Sales Teams for selectors (Employee wizard, Target/Commission scope). */
export const useSalesTeams = createReferenceDataHook<SalesTeamRow>("salesTeams", () =>
  salesTeamsService.list().then((rows) => rows.filter((row) => !row.deletedAt)),
);

/** Active Employees for selectors (KPI/Target/Commission employee pickers) — a bounded first page, refined further via `EntityCombobox`'s async `onSearch`. */
export const useEmployees = createReferenceDataHook<EmployeeRow>("employees", () =>
  employeesService.list({ pageSize: 200, sortBy: "employeeCode" }).then((r) => r.items),
);

export function useUsersLookup(): Record<string, string> {
  const users = useUsersList();
  return useMemo(() => Object.fromEntries(users.map((u) => [u.id, u.fullName])), [users]);
}
