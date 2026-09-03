"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Pencil, Archive } from "lucide-react";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { PermissionGate } from "@/components/shared/permission-gate";
import { EnterpriseButton } from "@/components/ui/button";
import {
  EnterpriseDataTable,
  exportColumnsFromKeys,
  exportRowsToCsv,
} from "@/components/master-data/enterprise-data-table";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { SalesTeamEditorModal } from "@/components/crm/sales-team-editor-modal";
import { salesTeamsService, type SalesTeamRow } from "@/services/sales-teams-service";
import { usePathRestorableState } from "@/hooks/use-restorable-state";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";
import type { ColumnDef } from "@tanstack/react-table";
import { StackedCell } from "@/components/shared/stacked-cell";
import { RowActionsMenu } from "@/components/shared/data-table";
import { useUserContext } from "@/providers/user-context";

export default function SalesTeamsPage() {
  return (
    <PermissionGate permission="crm.sales-teams.view">
      <SalesTeamsPageContent />
    </PermissionGate>
  );
}

function SalesTeamsPageContent() {
  const { t, locale } = useLocale();
  const { hasPermission } = useUserContext();
  const canCreate = hasPermission("crm.sales-teams.create");
  const canEdit = hasPermission("crm.sales-teams.edit");
  const canArchive = hasPermission("crm.sales-teams.archive");
  const [teams, setTeams] = useState<SalesTeamRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = usePathRestorableState("search", "");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<SalesTeamRow | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<SalesTeamRow | null>(null);
  const [archiving, setArchiving] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      setTeams(await salesTeamsService.list(search || undefined));
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("errors.generic"));
    } finally {
      setIsLoading(false);
    }
  }, [search, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const columns = useMemo<ColumnDef<SalesTeamRow, unknown>[]>(
    () => [
      {
        id: "code",
        meta: { titleKey: "crm.salesTeams.fields.code" },
        accessorFn: (row) => row.code,
      },
      {
        id: "name",
        meta: { titleKey: "crm.salesTeams.fields.name" },
        accessorFn: (row) => row.name,
      },
      {
        id: "department",
        meta: { titleKey: "crm.salesTeams.fields.department" },
        accessorFn: (row) =>
          locale === "en" && row.department.nameEn ? row.department.nameEn : row.department.name,
        cell: ({ row }) => (
          <StackedCell
            primary={
              locale === "en" && row.original.department.nameEn
                ? row.original.department.nameEn
                : row.original.department.name
            }
            secondary={
              row.original.department.deletedAt
                ? t("common.archived")
                : row.original.department.code
            }
          />
        ),
      },
      {
        id: "manager",
        meta: { titleKey: "crm.salesTeams.fields.manager" },
        accessorFn: (row) => row.manager.fullName,
      },
      {
        id: "members",
        meta: { titleKey: "crm.salesTeams.fields.members" },
        accessorFn: (row) => String(row.members.length),
      },
      {
        id: "__actions",
        meta: { titleKey: "common.actions" },
        enableHiding: false,
        enableSorting: false,
        cell: ({ row }) => (
          <RowActionsMenu
            label={t("common.actions")}
            actions={[
              {
                key: "edit",
                label: t("common.edit"),
                icon: Pencil,
                hidden: !canEdit,
                onSelect: () => {
                  setEditing(row.original);
                  setEditorOpen(true);
                },
              },
              {
                key: "archive",
                label: t("common.archive"),
                icon: Archive,
                destructive: true,
                separatorBefore: true,
                hidden: !canArchive,
                onSelect: () => setArchiveTarget(row.original),
              },
            ]}
          />
        ),
      },
    ],
    [canArchive, canEdit, locale, t],
  );

  return (
    <PageWorkspace
      title={t("crm.salesTeams.title")}
      description={t("crm.salesTeams.description")}
      actions={
        canCreate ? (
          <EnterpriseButton
            size="sm"
            onClick={() => {
              setEditing(null);
              setEditorOpen(true);
            }}
          >
            <Plus className="size-3.5" />
            {t("crm.salesTeams.new")}
          </EnterpriseButton>
        ) : undefined
      }
    >
      <EnterpriseDataTable
        tableId="sales-teams"
        columns={columns}
        data={teams}
        isLoading={isLoading}
        search={search}
        onSearchChange={setSearch}
        onRefresh={load}
        exportColumns={exportColumnsFromKeys(
          columns,
          ["code", "name", "department", "manager", "members"],
          t,
        )}
        onExport={(keys) =>
          exportRowsToCsv(
            teams.map((row) => ({
              code: row.code,
              name: row.name,
              department: row.department.name,
              manager: row.manager.fullName,
              members: String(row.members.length),
            })),
            keys,
            "sales-teams.csv",
          )
        }
        emptyTitle={t("crm.salesTeams.empty")}
      />

      <SalesTeamEditorModal
        open={editorOpen}
        onOpenChange={setEditorOpen}
        team={editing}
        onSaved={() => void load()}
      />

      <ConfirmationDialog
        open={!!archiveTarget}
        onOpenChange={(open) => {
          if (!open) setArchiveTarget(null);
        }}
        tone="destructive"
        title={t("crm.salesTeams.archiveTitle")}
        description={archiveTarget?.name}
        isConfirming={archiving}
        onConfirm={async () => {
          if (!archiveTarget) return;
          setArchiving(true);
          try {
            await salesTeamsService.archive(archiveTarget.id);
            toast.success(t("crm.salesTeams.toasts.archived"));
            setArchiveTarget(null);
            await load();
          } catch (error) {
            toast.error(error instanceof ApiError ? error.message : t("errors.generic"));
          } finally {
            setArchiving(false);
          }
        }}
      />
    </PageWorkspace>
  );
}
