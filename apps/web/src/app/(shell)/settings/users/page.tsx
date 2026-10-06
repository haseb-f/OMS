"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { SelectFilter } from "@/components/shared/data-table";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { HeaderActions } from "@/components/shared/header-actions";
import { PermissionGate } from "@/components/shared/permission-gate";
import {
  EnterpriseDataTable,
  exportColumnsFromKeys,
} from "@/components/master-data/enterprise-data-table";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { GeneratedPasswordDialog } from "@/components/settings/generated-password-dialog";
import {
  ResetPasswordField,
  isResetPasswordAcceptable,
} from "@/components/settings/reset-password-field";
import { UserEditorModal } from "@/components/settings/user-editor-modal";
import { UserGridCard } from "@/components/settings/user-grid-card";
import {
  buildUserColumns,
  userExportColumns,
  type UserRowHandlers,
} from "@/config/settings/user-columns";
import { usersService, type UserRow } from "@/services/users-service";
import { usePathRestorableState } from "@/hooks/use-restorable-state";
import { useLocale } from "@/providers/locale-provider";
import { useUsersList } from "@/hooks/use-reference-data";
import { toast, reportApiError } from "@/lib/toast";
import { exportRowsToCsv } from "@/components/master-data/enterprise-data-table";
import { filterByArabicSearch } from "@/lib/arabic-search";

export default function SettingsUsersPage() {
  return (
    <PermissionGate permission="settings.manage">
      <UsersPageContent />
    </PermissionGate>
  );
}

function UsersPageContent() {
  const { t } = useLocale();
  const router = useRouter();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [typeFilter, setTypeFilter] = usePathRestorableState<string>("userType", "");
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = usePathRestorableState("search", "");
  const [pendingAction, setPendingAction] = useState<
    "lock" | "unlock" | "reset" | "force" | "archive" | null
  >(null);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserRow | null>(null);
  const [lockTarget, setLockTarget] = useState<UserRow | null>(null);
  const [unlockTarget, setUnlockTarget] = useState<UserRow | null>(null);
  const [resetPasswordTarget, setResetPasswordTarget] = useState<UserRow | null>(null);
  const [forceChangeTarget, setForceChangeTarget] = useState<UserRow | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<UserRow | null>(null);
  const [generatedPassword, setGeneratedPassword] = useState<string | null>(null);
  // Optional admin-entered / generated password of the reset (empty → the server generates one).
  const [resetPasswordValue, setResetPasswordValue] = useState("");

  const load = useCallback(() => {
    setIsLoading(true);
    usersService
      // Every user type: agent users stay visible here (managed in their agent's team tab).
      .list(undefined, undefined, "ALL")
      .then(setUsers)
      .catch((error) => reportApiError(error, "common.loadFailed"))
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const typed = typeFilter ? users.filter((u) => (u.userType ?? "INTERNAL") === typeFilter) : users;
  const filtered = filterByArabicSearch(typed, search, (u) =>
    [u.fullName, u.username, u.email, u.mobile ?? ""].join(" "),
  );

  const openCreate = () => {
    setEditingUser(null);
    setEditorOpen(true);
  };
  const openEdit = (row: UserRow) => {
    setEditingUser(row);
    setEditorOpen(true);
  };

  // One handler set drives both the table's Actions cell and the Grid card.
  const handlers: UserRowHandlers = {
    onEdit: openEdit,
    onLock: setLockTarget,
    onUnlock: setUnlockTarget,
    onResetPassword: setResetPasswordTarget,
    onForcePasswordChange: setForceChangeTarget,
    onArchive: setArchiveTarget,
    onOpenAgentTeam: (row) => row.agent && router.push(`/agents/${row.agent.id}?tab=team`),
  };
  const columns = buildUserColumns(handlers);

  return (
    <PageWorkspace
      dense
      title={t("settings.users.title")}
      description={t("settings.users.description")}
      actions={
        <HeaderActions
          primary={{
            key: "primary",
            label: t("settings.users.newUser"),
            icon: Plus,
            onSelect: openCreate,
          }}
        />
      }
    >
      <EnterpriseDataTable
        tableId="settings-users"
        columns={columns}
        data={filtered}
        isLoading={isLoading}
        search={search}
        onSearchChange={setSearch}
        onRefresh={load}
        filterBar={
          <SelectFilter
            label={t("agents.users.type")}
            value={typeFilter}
            onChange={setTypeFilter}
            options={(["INTERNAL", "AGENT"] as const).map((value) => ({
              value,
              label: t(`agents.users.${value}`),
            }))}
          />
        }
        activeFilterCount={typeFilter ? 1 : 0}
        onClearFilters={() => setTypeFilter("")}
        exportColumns={exportColumnsFromKeys(columns, userExportColumns, t)}
        onExport={(keys, labels) =>
          exportRowsToCsv(
            filtered.map((row) => ({
              fullName: row.fullName,
              username: row.username,
              email: row.email,
              mobile: row.mobile ?? "",
              userType:
                row.userType === "AGENT"
                  ? `${t("agents.users.AGENT")}${row.agent ? ` — ${row.agent.name}` : ""}`
                  : t("agents.users.INTERNAL"),
              jobTitle: row.jobTitle?.name ?? "",
              department: row.department?.name ?? "",
              branch: row.branch?.name ?? "",
              status: row.isLocked
                ? t("settings.users.status.locked")
                : row.isActive
                  ? t("settings.users.status.active")
                  : t("settings.users.status.inactive"),
              lastLoginAt: row.lastLoginAt ?? "",
            })),
            keys,
            "users.csv",
            labels,
          )
        }
        emptyTitle={t("settings.users.empty")}
        renderGridCard={({ row, selected, onToggleSelected }) => (
          <UserGridCard
            user={row}
            handlers={handlers}
            selected={selected}
            onToggleSelected={onToggleSelected}
          />
        )}
      />

      <UserEditorModal
        open={editorOpen}
        onOpenChange={setEditorOpen}
        user={editingUser}
        allUsers={users}
        onSaved={(temporaryPassword) => {
          load();
          useUsersList.invalidate();
          if (temporaryPassword) setGeneratedPassword(temporaryPassword);
        }}
      />

      <GeneratedPasswordDialog
        password={generatedPassword}
        onOpenChange={(open) => {
          if (!open) setGeneratedPassword(null);
        }}
      />

      <ConfirmationDialog
        open={!!lockTarget}
        onOpenChange={(open) => !open && setLockTarget(null)}
        tone="destructive"
        title={t("settings.users.confirmLockTitle")}
        description={lockTarget?.fullName}
        confirmLabel={t("settings.users.actions.lock")}
        isConfirming={pendingAction === "lock"}
        onConfirm={async () => {
          if (!lockTarget) return;
          setPendingAction("lock");
          try {
            await usersService.lock(lockTarget.id);
            toast.success(t("settings.users.toasts.locked"));
            setLockTarget(null);
            load();
          } catch (error) {
            reportApiError(error, "errors.generic");
          } finally {
            setPendingAction(null);
          }
        }}
      />

      <ConfirmationDialog
        open={!!unlockTarget}
        onOpenChange={(open) => !open && setUnlockTarget(null)}
        title={t("settings.users.confirmUnlockTitle")}
        description={unlockTarget?.fullName}
        confirmLabel={t("settings.users.actions.unlock")}
        isConfirming={pendingAction === "unlock"}
        onConfirm={async () => {
          if (!unlockTarget) return;
          setPendingAction("unlock");
          try {
            await usersService.unlock(unlockTarget.id);
            toast.success(t("settings.users.toasts.unlocked"));
            setUnlockTarget(null);
            load();
          } catch (error) {
            reportApiError(error, "errors.generic");
          } finally {
            setPendingAction(null);
          }
        }}
      />

      <ConfirmationDialog
        open={!!resetPasswordTarget}
        onOpenChange={(open) => {
          if (open) return;
          setResetPasswordTarget(null);
          setResetPasswordValue("");
        }}
        tone="destructive"
        title={t("settings.users.confirmResetPasswordTitle")}
        description={t("settings.users.confirmResetPasswordDescription")}
        extra={
          <ResetPasswordField
            value={resetPasswordValue}
            onChange={setResetPasswordValue}
            disabled={pendingAction === "reset"}
          />
        }
        confirmDisabled={!isResetPasswordAcceptable(resetPasswordValue)}
        confirmLabel={t("settings.users.actions.resetPassword")}
        isConfirming={pendingAction === "reset"}
        onConfirm={async () => {
          if (!resetPasswordTarget) return;
          setPendingAction("reset");
          try {
            const result = await usersService.resetPassword(
              resetPasswordTarget.id,
              resetPasswordValue || undefined,
            );
            setResetPasswordTarget(null);
            setResetPasswordValue("");
            load();
            if (result.temporaryPassword) {
              setGeneratedPassword(result.temporaryPassword);
            }
          } catch (error) {
            reportApiError(error, "errors.generic");
          } finally {
            setPendingAction(null);
          }
        }}
      />

      <ConfirmationDialog
        open={!!forceChangeTarget}
        onOpenChange={(open) => !open && setForceChangeTarget(null)}
        title={t("settings.users.confirmForcePasswordChangeTitle")}
        description={forceChangeTarget?.fullName}
        confirmLabel={t("settings.users.actions.forcePasswordChange")}
        isConfirming={pendingAction === "force"}
        onConfirm={async () => {
          if (!forceChangeTarget) return;
          setPendingAction("force");
          try {
            await usersService.forcePasswordChange(forceChangeTarget.id);
            toast.success(t("settings.users.toasts.forcePasswordChangeSet"));
            setForceChangeTarget(null);
            load();
          } catch (error) {
            reportApiError(error, "errors.generic");
          } finally {
            setPendingAction(null);
          }
        }}
      />

      <ConfirmationDialog
        open={!!archiveTarget}
        onOpenChange={(open) => !open && setArchiveTarget(null)}
        tone="destructive"
        title={t("settings.users.confirmArchiveTitle")}
        description={archiveTarget?.fullName}
        confirmLabel={t("common.archive")}
        isConfirming={pendingAction === "archive"}
        onConfirm={async () => {
          if (!archiveTarget) return;
          setPendingAction("archive");
          try {
            await usersService.remove(archiveTarget.id);
            toast.success(t("settings.users.toasts.archived"));
            setArchiveTarget(null);
            load();
          } catch (error) {
            reportApiError(error, "errors.generic");
          } finally {
            setPendingAction(null);
          }
        }}
      />
    </PageWorkspace>
  );
}
