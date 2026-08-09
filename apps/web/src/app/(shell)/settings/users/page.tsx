"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { PermissionGate } from "@/components/shared/permission-gate";
import { EnterpriseButton } from "@/components/ui/button";
import {
  EnterpriseDataTable,
  exportColumnsFromKeys,
} from "@/components/master-data/enterprise-data-table";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { UserEditorModal } from "@/components/settings/user-editor-modal";
import { buildUserColumns, userExportColumns } from "@/config/settings/user-columns";
import { usersService, type UserRow } from "@/services/users-service";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";
import { exportRowsToCsv } from "@/components/master-data/enterprise-data-table";

export default function SettingsUsersPage() {
  return (
    <PermissionGate permission="settings.manage">
      <UsersPageContent />
    </PermissionGate>
  );
}

function UsersPageContent() {
  const { t } = useLocale();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserRow | null>(null);
  const [lockTarget, setLockTarget] = useState<UserRow | null>(null);
  const [unlockTarget, setUnlockTarget] = useState<UserRow | null>(null);
  const [resetPasswordTarget, setResetPasswordTarget] = useState<UserRow | null>(null);
  const [forceChangeTarget, setForceChangeTarget] = useState<UserRow | null>(null);

  const load = useCallback(() => {
    setIsLoading(true);
    usersService
      .list()
      .then(setUsers)
      .catch((error) =>
        toast.error(error instanceof ApiError ? error.message : "Failed to load users."),
      )
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const filtered = search.trim()
    ? users.filter((u) =>
        [u.fullName, u.username, u.email, u.mobile ?? ""].some((field) =>
          field.toLowerCase().includes(search.trim().toLowerCase()),
        ),
      )
    : users;

  const openCreate = () => {
    setEditingUser(null);
    setEditorOpen(true);
  };
  const openEdit = (row: UserRow) => {
    setEditingUser(row);
    setEditorOpen(true);
  };

  const columns = buildUserColumns({
    onEdit: openEdit,
    onLock: setLockTarget,
    onUnlock: setUnlockTarget,
    onResetPassword: setResetPasswordTarget,
    onForcePasswordChange: setForceChangeTarget,
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("settings.users.title")}
        subtitle={t("settings.users.description")}
        actions={
          <EnterpriseButton type="button" size="sm" className="gap-1.5" onClick={openCreate}>
            <Plus className="size-3.5" />
            {t("settings.users.newUser")}
          </EnterpriseButton>
        }
      />

      <EnterpriseDataTable
        tableId="settings-users"
        columns={columns}
        data={filtered}
        isLoading={isLoading}
        search={search}
        onSearchChange={setSearch}
        onRefresh={load}
        exportColumns={exportColumnsFromKeys(columns, userExportColumns, t)}
        onExport={(keys) =>
          exportRowsToCsv(
            filtered.map((row) => ({
              fullName: row.fullName,
              username: row.username,
              email: row.email,
              mobile: row.mobile ?? "",
              jobTitle: row.jobTitle?.name ?? "",
              department: row.department ?? "",
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
          )
        }
        emptyTitle={t("settings.users.empty")}
      />

      <UserEditorModal
        open={editorOpen}
        onOpenChange={setEditorOpen}
        user={editingUser}
        allUsers={users}
        onSaved={load}
      />

      <ConfirmationDialog
        open={!!lockTarget}
        onOpenChange={(open) => !open && setLockTarget(null)}
        tone="destructive"
        title={t("settings.users.confirmLockTitle")}
        description={lockTarget?.fullName}
        confirmLabel={t("settings.users.actions.lock")}
        onConfirm={async () => {
          if (!lockTarget) return;
          try {
            await usersService.lock(lockTarget.id);
            toast.success(t("settings.users.toasts.locked"));
            setLockTarget(null);
            load();
          } catch (error) {
            toast.error(error instanceof ApiError ? error.message : "Something went wrong.");
          }
        }}
      />

      <ConfirmationDialog
        open={!!unlockTarget}
        onOpenChange={(open) => !open && setUnlockTarget(null)}
        title={t("settings.users.confirmUnlockTitle")}
        description={unlockTarget?.fullName}
        confirmLabel={t("settings.users.actions.unlock")}
        onConfirm={async () => {
          if (!unlockTarget) return;
          try {
            await usersService.unlock(unlockTarget.id);
            toast.success(t("settings.users.toasts.unlocked"));
            setUnlockTarget(null);
            load();
          } catch (error) {
            toast.error(error instanceof ApiError ? error.message : "Something went wrong.");
          }
        }}
      />

      <ConfirmationDialog
        open={!!resetPasswordTarget}
        onOpenChange={(open) => !open && setResetPasswordTarget(null)}
        tone="destructive"
        title={t("settings.users.confirmResetPasswordTitle")}
        description={t("settings.users.confirmResetPasswordDescription")}
        confirmLabel={t("settings.users.actions.resetPassword")}
        onConfirm={async () => {
          if (!resetPasswordTarget) return;
          try {
            const temp = Math.random().toString(36).slice(2, 10) + "A1!";
            await usersService.resetPassword(resetPasswordTarget.id, temp);
            toast.success(t("settings.users.toasts.passwordReset", { password: temp }));
            setResetPasswordTarget(null);
            load();
          } catch (error) {
            toast.error(error instanceof ApiError ? error.message : "Something went wrong.");
          }
        }}
      />

      <ConfirmationDialog
        open={!!forceChangeTarget}
        onOpenChange={(open) => !open && setForceChangeTarget(null)}
        title={t("settings.users.confirmForcePasswordChangeTitle")}
        description={forceChangeTarget?.fullName}
        confirmLabel={t("settings.users.actions.forcePasswordChange")}
        onConfirm={async () => {
          if (!forceChangeTarget) return;
          try {
            await usersService.forcePasswordChange(forceChangeTarget.id);
            toast.success(t("settings.users.toasts.forcePasswordChangeSet"));
            setForceChangeTarget(null);
            load();
          } catch (error) {
            toast.error(error instanceof ApiError ? error.message : "Something went wrong.");
          }
        }}
      />
    </div>
  );
}
