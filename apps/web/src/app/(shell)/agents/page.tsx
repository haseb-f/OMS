"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { HeaderActions } from "@/components/shared/header-actions";
import { PermissionGate } from "@/components/shared/permission-gate";
import {
  EnterpriseDataTable,
  exportColumnsFromKeys,
  exportRowsToCsv,
} from "@/components/master-data/enterprise-data-table";
import { SelectFilter } from "@/components/shared/data-table";
import { AgentFormDialog } from "@/components/agents/agent-form-dialog";
import { AgentsOverviewPanel } from "@/components/agents/overview/agents-overview-panel";
import {
  agentExportColumns,
  agentExportRow,
  buildAgentColumns,
} from "@/config/agents/agent-columns";
import { agentsService, type AgentRow, type AgentStatus } from "@/services/agents-service";
import { usePathRestorableState } from "@/hooks/use-restorable-state";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { apiErrorMessage } from "@/lib/toast";
import { fetchAllPages } from "@/lib/fetch-all-pages";
import type { MessageKey } from "@/i18n/translate";

const STATUSES: AgentStatus[] = ["ACTIVE", "INACTIVE"];

export default function AgentsPage() {
  return (
    <PermissionGate permission="agents.view">
      <AgentsPageContent />
    </PermissionGate>
  );
}

function AgentsPageContent() {
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const [items, setItems] = useState<AgentRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = usePathRestorableState("page", 1);
  const [pageSize, setPageSize] = usePathRestorableState("pageSize", 20);
  const [search, setSearch] = usePathRestorableState("search", "");
  const [status, setStatus] = usePathRestorableState<string>("status", "");
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const filters = useMemo(
    () => ({
      search: search || undefined,
      status: (status || undefined) as AgentStatus | undefined,
    }),
    [search, status],
  );

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const result = await agentsService.list({ ...filters, page, pageSize });
      setItems(result.items);
      setTotal(result.total);
    } catch (error) {
      setLoadError(apiErrorMessage(error, "errors.loadFailed"));
    } finally {
      setIsLoading(false);
    }
  }, [filters, page, pageSize]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // Print: every agent matching the filters, not only the loaded page (API page cap: 200).
  const fetchAllRows = useCallback(
    () =>
      fetchAllPages((nextPage, nextPageSize) =>
        agentsService.list({ ...filters, page: nextPage, pageSize: Math.min(nextPageSize, 200) }),
      ),
    [filters],
  );

  const columns = useMemo(() => buildAgentColumns(), []);
  const pageAgentIds = useMemo(() => items.map((row) => row.id), [items]);

  return (
    <PageWorkspace
      dense
      title={t("agents.list.title")}
      description={t("agents.list.description")}
      // R15 W1 — the cross-agent overview of the agents on this page (supporting panel).
      secondary={<AgentsOverviewPanel agentIds={pageAgentIds} ready={!isLoading && !loadError} />}
      actions={
        <HeaderActions
          primary={{
            key: "create",
            label: t("agents.list.new"),
            icon: Plus,
            hidden: !hasPermission("agents.create"),
            onSelect: () => setCreateOpen(true),
          }}
        />
      }
    >
      <EnterpriseDataTable
        tableId="agents"
        printTitle={t("agents.list.title")}
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
        search={search}
        onSearchChange={(value) => {
          setSearch(value);
          setPage(1);
        }}
        searchPlaceholder={t("agents.list.searchPlaceholder")}
        isLoading={isLoading}
        error={loadError}
        onRetry={() => void load()}
        onRefresh={() => void load()}
        fetchAllRows={fetchAllRows}
        filterBar={
          <SelectFilter
            label={t("agents.list.statusFilter")}
            value={status}
            onChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
            options={STATUSES.map((value) => ({
              value,
              label: t(`agents.status.${value}` as MessageKey),
            }))}
          />
        }
        activeFilterCount={status ? 1 : 0}
        onClearFilters={() => {
          setStatus("");
          setPage(1);
        }}
        exportColumns={exportColumnsFromKeys(columns, agentExportColumns, t)}
        onExport={(keys, labels) =>
          exportRowsToCsv(
            items.map((row) => agentExportRow(row, t)),
            keys,
            "agents.csv",
            labels,
          )
        }
        emptyTitle={t("agents.list.empty")}
        getRowId={(row) => row.id}
        getRowHref={(row) => `/agents/${row.id}`}
      />

      {createOpen ? (
        <AgentFormDialog agent={null} onOpenChange={setCreateOpen} onSaved={() => void load()} />
      ) : null}
    </PageWorkspace>
  );
}
