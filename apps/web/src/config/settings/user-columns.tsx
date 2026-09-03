"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Archive, KeyRound, Lock, Pencil, ShieldAlert, Unlock } from "lucide-react";
import { StatusBadge } from "@/components/business/status-badge";
import { RowActionsMenu, type RowAction } from "@/components/shared/data-table";
import { SemanticValue } from "@/components/shared/semantic-value";
import { StackedCell } from "@/components/shared/stacked-cell";
import { formatDateTime } from "@/lib/date";
import { useAuth } from "@/providers/auth-provider";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import type { UserRow } from "@/services/users-service";

export interface UserRowHandlers {
  onEdit: (row: UserRow) => void;
  onLock: (row: UserRow) => void;
  onUnlock: (row: UserRow) => void;
  onResetPassword: (row: UserRow) => void;
  onForcePasswordChange: (row: UserRow) => void;
  onArchive: (row: UserRow) => void;
}

function StatusCell({ row }: { row: UserRow }) {
  const { t } = useLocale();
  if (row.isLocked) {
    return <StatusBadge label={t("settings.users.status.locked")} tone="destructive" />;
  }
  return row.isActive ? (
    <StatusBadge label={t("settings.users.status.active")} tone="success" />
  ) : (
    <StatusBadge label={t("settings.users.status.inactive")} tone="neutral" />
  );
}

function ActionsCell({ row, handlers }: { row: UserRow; handlers: UserRowHandlers }) {
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const { user } = useAuth();
  const canManage = hasPermission("settings.manage");
  const isSelf = user?.id === row.id;
  const actions: RowAction[] = [
    {
      key: "edit",
      label: t("common.edit"),
      icon: Pencil,
      hidden: !canManage,
      onSelect: () => handlers.onEdit(row),
    },
    {
      key: "lock",
      label: t("settings.users.actions.lock"),
      icon: Lock,
      hidden: row.isLocked || !canManage,
      separatorBefore: true,
      onSelect: () => handlers.onLock(row),
    },
    {
      key: "unlock",
      label: t("settings.users.actions.unlock"),
      icon: Unlock,
      hidden: !row.isLocked || !canManage,
      separatorBefore: true,
      onSelect: () => handlers.onUnlock(row),
    },
    {
      key: "resetPassword",
      label: t("settings.users.actions.resetPassword"),
      icon: KeyRound,
      hidden: !canManage,
      onSelect: () => handlers.onResetPassword(row),
    },
    {
      key: "forcePasswordChange",
      label: t("settings.users.actions.forcePasswordChange"),
      icon: ShieldAlert,
      hidden: row.mustChangePassword || !canManage,
      onSelect: () => handlers.onForcePasswordChange(row),
    },
    {
      key: "archive",
      label: t("common.archive"),
      icon: Archive,
      hidden: !canManage || isSelf,
      destructive: true,
      separatorBefore: true,
      onSelect: () => handlers.onArchive(row),
    },
  ];
  return <RowActionsMenu actions={actions} label={t("common.actions")} />;
}

export function buildUserColumns(handlers: UserRowHandlers): ColumnDef<UserRow, unknown>[] {
  return [
    {
      id: "fullName",
      meta: { titleKey: "settings.users.fields.fullName" },
      accessorFn: (row) => row.fullName,
      cell: ({ row }) => (
        <StackedCell
          primary={row.original.fullName}
          secondary={<SemanticValue kind="id">{row.original.username}</SemanticValue>}
        />
      ),
    },
    {
      id: "username",
      meta: { titleKey: "settings.users.fields.username", defaultHidden: true },
      accessorFn: (row) => row.username,
      cell: (info) => <SemanticValue kind="id">{info.getValue() as string}</SemanticValue>,
    },
    {
      id: "email",
      meta: { titleKey: "settings.users.fields.email" },
      accessorFn: (row) => row.email,
      cell: ({ row }) => (
        <StackedCell
          primary={
            row.original.email ? (
              <SemanticValue kind="email">{row.original.email}</SemanticValue>
            ) : (
              "—"
            )
          }
          secondary={
            row.original.mobile ? (
              <SemanticValue kind="phone">{row.original.mobile}</SemanticValue>
            ) : undefined
          }
        />
      ),
    },
    {
      id: "mobile",
      meta: { titleKey: "settings.users.fields.mobile", defaultHidden: true },
      accessorFn: (row) => row.mobile ?? "—",
      cell: ({ row }) =>
        row.original.mobile ? (
          <SemanticValue kind="phone">{row.original.mobile}</SemanticValue>
        ) : (
          "—"
        ),
    },
    {
      id: "jobTitle",
      meta: { titleKey: "settings.users.fields.jobTitle" },
      accessorFn: (row) => row.jobTitle?.name ?? "—",
      cell: ({ row }) => (
        <StackedCell
          primary={row.original.jobTitle?.name ?? "—"}
          secondary={row.original.department?.name ?? undefined}
        />
      ),
    },
    {
      id: "department",
      meta: { titleKey: "settings.users.fields.department", defaultHidden: true },
      accessorFn: (row) => row.department?.name ?? "—",
    },
    {
      id: "branch",
      meta: { titleKey: "settings.users.fields.branch" },
      accessorFn: (row) => row.branch?.name ?? "—",
    },
    {
      id: "status",
      meta: { titleKey: "settings.users.fields.status" },
      cell: ({ row }) => <StatusCell row={row.original} />,
    },
    {
      id: "lastLoginAt",
      meta: { titleKey: "settings.users.fields.lastLogin" },
      accessorFn: (row) => (row.lastLoginAt ? formatDateTime(row.lastLoginAt) : "—"),
    },
    {
      id: "__actions",
      meta: { titleKey: "common.actions" },
      enableHiding: false,
      enableSorting: false,
      cell: ({ row }) => <ActionsCell row={row.original} handlers={handlers} />,
    },
  ];
}

export const userExportColumns = [
  "fullName",
  "username",
  "email",
  "mobile",
  "jobTitle",
  "department",
  "branch",
  "status",
  "lastLoginAt",
];
