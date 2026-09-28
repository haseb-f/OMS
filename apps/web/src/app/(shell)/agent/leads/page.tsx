"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { UserPlus } from "lucide-react";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { HeaderActions } from "@/components/shared/header-actions";
import { EnterpriseDataTable } from "@/components/master-data/enterprise-data-table";
import { SelectFilter } from "@/components/shared/data-table";
import { SemanticValue } from "@/components/shared/semantic-value";
import { StackedCell } from "@/components/shared/stacked-cell";
import { LeadCreateDialog } from "@/components/agent-portal/lead-create-dialog";
import { LeadStatusBadge } from "@/components/agent-portal/portal-badges";
import { usePortalProfile } from "@/components/agent-portal/use-portal-profile";
import { LEAD_STATUS_CODES, localizedName } from "@/config/agent-portal/labels";
import { agentPortalService, type PortalLead } from "@/services/agent-portal-service";
import { usePathRestorableState } from "@/hooks/use-restorable-state";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { apiErrorMessage, reportSuccess } from "@/lib/toast";
import { formatDate } from "@/lib/date";

function ProductCell({ lead }: { lead: PortalLead }) {
  const { locale } = useLocale();
  if (!lead.product) return <span className="text-muted-foreground">—</span>;
  return (
    <StackedCell
      primary={localizedName(lead.product, locale)}
      secondary={lead.quantity ? <span className="num">× {lead.quantity}</span> : undefined}
    />
  );
}

function MethodCell({ lead }: { lead: PortalLead }) {
  const { t } = useLocale();
  return lead.fulfillmentMethod ? (
    <>{t(`agentPortal.status.method.${lead.fulfillmentMethod}`)}</>
  ) : (
    <span className="text-muted-foreground">—</span>
  );
}

function OrderCell({ lead }: { lead: PortalLead }) {
  return lead.storeOrder ? (
    <SemanticValue kind="id">{lead.storeOrder.internalOrderId}</SemanticValue>
  ) : (
    <span className="text-muted-foreground">—</span>
  );
}

function buildLeadColumns(): ColumnDef<PortalLead, unknown>[] {
  return [
    {
      id: "number",
      meta: {
        titleKey: "agentPortal.leads.fields.number",
        type: "code",
        identity: true,
        importance: "critical",
      },
      enableSorting: false,
      accessorFn: (row) => row.leadNumber,
    },
    {
      id: "customer",
      meta: {
        titleKey: "agentPortal.leads.fields.customerName",
        type: "name",
        stacked: true,
        importance: "critical",
      },
      enableSorting: false,
      accessorFn: (row) => row.customerName,
      cell: ({ row }) => (
        <StackedCell
          primary={row.original.customerName}
          secondary={<SemanticValue kind="phone">{row.original.mobileNumber}</SemanticValue>}
        />
      ),
    },
    {
      id: "product",
      meta: { titleKey: "agentPortal.leads.fields.product", type: "name", stacked: true },
      enableSorting: false,
      accessorFn: (row) => row.product?.name ?? "",
      cell: ({ row }) => <ProductCell lead={row.original} />,
    },
    {
      id: "status",
      meta: { titleKey: "agentPortal.leads.fields.status", type: "status", importance: "high" },
      enableSorting: false,
      accessorFn: (row) => row.status.code,
      cell: ({ row }) => <LeadStatusBadge status={row.original.status} />,
    },
    {
      id: "order",
      meta: { titleKey: "agentPortal.leads.fields.order", type: "reference" },
      enableSorting: false,
      accessorFn: (row) => row.storeOrder?.internalOrderId ?? "",
      cell: ({ row }) => <OrderCell lead={row.original} />,
    },
    {
      id: "method",
      meta: { titleKey: "agentPortal.leads.fields.fulfillmentMethod", importance: "medium" },
      enableSorting: false,
      accessorFn: (row) => row.fulfillmentMethod ?? "",
      cell: ({ row }) => <MethodCell lead={row.original} />,
    },
    {
      id: "owner",
      meta: { titleKey: "agentPortal.leads.fields.owner", defaultHidden: true },
      enableSorting: false,
      accessorFn: (row) => row.salesEmployee?.fullName ?? "",
    },
    {
      id: "createdAt",
      meta: { titleKey: "agentPortal.leads.fields.createdAt", type: "date" },
      enableSorting: false,
      accessorFn: (row) => formatDate(row.createdAt),
    },
  ];
}

/** The agent's own leads — never distributed to internal staff (spec §6.1). */
export default function AgentLeadsPage() {
  const { t } = useLocale();
  const router = useRouter();
  const { hasPermission } = useUserContext();
  const { countries } = usePortalProfile();
  const [items, setItems] = useState<PortalLead[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = usePathRestorableState("page", 1);
  const [pageSize, setPageSize] = usePathRestorableState("pageSize", 20);
  const [search, setSearch] = usePathRestorableState("search", "");
  const [status, setStatus] = usePathRestorableState<string>("status", "");
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const canConvert = hasPermission("agent.leads.convert") && hasPermission("agent.orders.create");

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const result = await agentPortalService.leads.list({
        search: search || undefined,
        statusCode: status || undefined,
        page,
        pageSize,
      });
      setItems(result.items);
      setTotal(result.total);
    } catch (error) {
      setLoadError(apiErrorMessage(error, "agentPortal.common.loadFailed"));
    } finally {
      setIsLoading(false);
    }
  }, [search, status, page, pageSize]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const columns = useMemo(() => buildLeadColumns(), []);

  return (
    <PageWorkspace
      dense
      title={t("agentPortal.leads.title")}
      description={t("agentPortal.leads.description")}
      actions={
        <HeaderActions
          primary={{
            key: "create",
            label: t("agentPortal.leads.new"),
            icon: UserPlus,
            hidden: !hasPermission("agent.leads.create"),
            onSelect: () => setCreateOpen(true),
          }}
        />
      }
    >
      <EnterpriseDataTable
        tableId="agent-portal-leads"
        printTitle={t("agentPortal.leads.title")}
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
        searchPlaceholder={t("agentPortal.leads.searchPlaceholder")}
        isLoading={isLoading}
        error={loadError}
        onRetry={() => void load()}
        onRefresh={() => void load()}
        filterBar={
          <SelectFilter
            label={t("agentPortal.leads.filters.status")}
            value={status}
            onChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
            options={LEAD_STATUS_CODES.map((value) => ({
              value,
              label: t(`agentPortal.status.leadCodes.${value}`),
            }))}
          />
        }
        activeFilterCount={status ? 1 : 0}
        onClearFilters={() => {
          setStatus("");
          setPage(1);
        }}
        emptyTitle={t("agentPortal.leads.empty")}
        getRowId={(row) => row.id}
        getRowHref={(row) => `/agent/leads/${row.id}`}
      />

      <LeadCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        countries={countries}
        onCreated={(lead) => {
          const convertHref = `/agent/orders/new?leadId=${lead.id}`;
          reportSuccess(t("agentPortal.leads.toasts.created", { number: lead.leadNumber }), {
            href: canConvert ? convertHref : `/agent/leads/${lead.id}`,
            linkLabel: canConvert ? t("agentPortal.leads.detail.convert") : undefined,
            navigate: router.push,
          });
          void load();
        }}
      />
    </PageWorkspace>
  );
}
