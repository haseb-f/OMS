"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { EnterpriseButton } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import {
  EnterpriseDataTable,
  exportColumnsFromKeys,
  exportRowsToCsv,
} from "@/components/master-data/enterprise-data-table";
import { MultiSelectFilter } from "@/components/shared/data-table";
import {
  investmentOpportunitiesService,
  type InvestmentOpportunityRow,
  type InvestmentOpportunityStatus,
} from "@/services/investment-opportunities-service";
import {
  buildOpportunityColumns,
  opportunityExportColumns,
} from "@/config/investors/opportunity-columns";
import { usePathRestorableState } from "@/hooks/use-restorable-state";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { toast, reportApiError } from "@/lib/toast";
import { formatDate } from "@/lib/date";

const OPPORTUNITY_STATUSES: InvestmentOpportunityStatus[] = [
  "DRAFT",
  "OPEN",
  "FUNDED",
  "ACTIVE",
  "ENDED",
  "SETTLED",
  "CLOSED",
  "CANCELLED",
];

export default function InvestmentOpportunitiesPage() {
  const { t } = useLocale();
  const router = useRouter();
  const { hasPermission } = useUserContext();

  const [items, setItems] = useState<InvestmentOpportunityRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = usePathRestorableState("page", 1);
  const [pageSize, setPageSize] = usePathRestorableState("pageSize", 20);
  const [search, setSearch] = usePathRestorableState("search", "");
  const [sortBy, setSortBy] = usePathRestorableState("sortBy", "createdAt");
  const [sortOrder, setSortOrder] = usePathRestorableState<"asc" | "desc">("sortOrder", "desc");
  const [statusFilter, setStatusFilter] = usePathRestorableState<string[]>("status", []);
  const [isLoading, setIsLoading] = useState(true);
  const [cancelTarget, setCancelTarget] = useState<InvestmentOpportunityRow | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<InvestmentOpportunityRow | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await investmentOpportunitiesService.list({
        search: search || undefined,
        status: statusFilter as InvestmentOpportunityStatus[],
        page,
        pageSize,
        sortBy,
        sortOrder,
      });
      setItems(result.items);
      setTotal(result.total);
    } catch (error) {
      reportApiError(error, t("common.loadFailed"));
    } finally {
      setIsLoading(false);
    }
  }, [search, statusFilter, page, pageSize, sortBy, sortOrder, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const canCreate = hasPermission("investment-opportunities.create");

  const columns = useMemo(
    () =>
      buildOpportunityColumns({
        onView: (row) => router.push(`/investors/opportunities/${row.id}`),
        onCancel: setCancelTarget,
        onArchive: setArchiveTarget,
      }),
    [router],
  );

  async function handleCancelConfirmed() {
    if (!cancelTarget) return;
    try {
      await investmentOpportunitiesService.cancel(cancelTarget.id);
      toast.success(t("common.saved"));
      void load();
    } catch (error) {
      reportApiError(error, t("common.failedToSave"));
    } finally {
      setCancelTarget(null);
    }
  }

  async function handleArchiveConfirmed() {
    if (!archiveTarget) return;
    try {
      await investmentOpportunitiesService.archive(archiveTarget.id);
      toast.success(t("common.saved"));
      void load();
    } catch (error) {
      reportApiError(error, t("common.failedToSave"));
    } finally {
      setArchiveTarget(null);
    }
  }

  const toPrintRow = (item: InvestmentOpportunityRow): Record<string, string> => ({
    code: item.code,
    startDate: formatDate(item.startDate),
    endDate: formatDate(item.endDate),
    status: t(`investors.opportunities.status.${item.status}`),
    productsCount: String(item.productsCount),
    targetCapital: item.targetCapital.toFixed(2),
    confirmedFundedCapital: item.confirmedFundedCapital.toFixed(2),
    investorsCount: String(item.investorsCount),
  });

  return (
    <PageWorkspace
      dense
      title={t("investors.opportunities.title")}
      description={t("investors.opportunities.description")}
      actions={
        canCreate ? (
          <EnterpriseButton
            type="button"
            onClick={() => router.push("/investors/opportunities/new")}
          >
            <Plus />
            {t("investors.opportunities.addNew")}
          </EnterpriseButton>
        ) : undefined
      }
    >
      <EnterpriseDataTable
        filterBar={
          <MultiSelectFilter
            label={t("investors.opportunities.fields.status")}
            values={statusFilter}
            onChange={(values) => {
              setStatusFilter(values);
              setPage(1);
            }}
            options={OPPORTUNITY_STATUSES.map((status) => ({
              value: status,
              label: t(`investors.opportunities.status.${status}`),
            }))}
          />
        }
        tableId="investment-opportunities"
        printTitle={t("investors.opportunities.title")}
        columns={columns}
        data={items}
        totalCount={total}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        sortBy={sortBy}
        sortOrder={sortOrder}
        onSortChange={(nextSortBy, nextSortOrder) => {
          setSortBy(nextSortBy);
          setSortOrder(nextSortOrder);
        }}
        search={search}
        onSearchChange={(value) => {
          setSearch(value);
          setPage(1);
        }}
        isLoading={isLoading}
        onRefresh={load}
        exportColumns={exportColumnsFromKeys(columns, opportunityExportColumns, t)}
        onExport={(selectedKeys) =>
          exportRowsToCsv(
            items.map((item) => toPrintRow(item)) as unknown as Record<string, unknown>[],
            selectedKeys,
            "investment-opportunities.csv",
          )
        }
        getRowId={(row) => row.id}
        getRowHref={(row) => `/investors/opportunities/${row.id}`}
      />

      <ConfirmationDialog
        open={!!cancelTarget}
        onOpenChange={(open) => !open && setCancelTarget(null)}
        tone="destructive"
        title={t("investors.opportunities.actions.cancel")}
        description={cancelTarget?.code}
        onConfirm={handleCancelConfirmed}
      />

      <ConfirmationDialog
        open={!!archiveTarget}
        onOpenChange={(open) => !open && setArchiveTarget(null)}
        tone="destructive"
        title={t("investors.opportunities.actions.archive")}
        description={archiveTarget?.code}
        onConfirm={handleArchiveConfirmed}
      />
    </PageWorkspace>
  );
}
