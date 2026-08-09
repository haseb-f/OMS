"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { KeyRound, Lock, Pencil, ShieldAlert, Unlock } from "lucide-react";
import { StatusBadge } from "@/components/business/status-badge";
import { SalesDocumentRowActionsMenu, type SalesDocumentRowAction } from "@/components/sales";
import { formatDateTime } from "@/lib/date";
import { useLocale } from "@/providers/locale-provider";
import type { UserRow } from "@/services/users-service";

export interface UserRowHandlers {
  onEdit: (row: UserRow) => void;
  onLock: (row: UserRow) => void;
  onUnlock: (row: UserRow) => void;
  onResetPassword: (row: UserRow) => void;
  onForcePasswordChange: (row: UserRow) => void;
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
  const actions: SalesDocumentRowAction[] = [
    { key: "edit", label: t("common.edit"), icon: Pencil, onSelect: () => handlers.onEdit(row) },
    {
      key: "lock",
      label: t("settings.users.actions.lock"),
      icon: Lock,
      hidden: row.isLocked,
      separatorBefore: true,
      onSelect: () => handlers.onLock(row),
    },
    {
      key: "unlock",
      label: t("settings.users.actions.unlock"),
      icon: Unlock,
      hidden: !row.isLocked,
      separatorBefore: true,
      onSelect: () => handlers.onUnlock(row),
    },
    {
      key: "resetPassword",
      label: t("settings.users.actions.resetPassword"),
      icon: KeyRound,
      onSelect: () => handlers.onResetPassword(row),
    },
    {
      key: "forcePasswordChange",
      label: t("settings.users.actions.forcePasswordChange"),
      icon: ShieldAlert,
      hidden: row.mustChangePassword,
      onSelect: () => handlers.onForcePasswordChange(row),
    },
  ];
  return <SalesDocumentRowActionsMenu actions={actions} label={t("common.actions")} />;
}

export function buildUserColumns(handlers: UserRowHandlers): ColumnDef<UserRow, unknown>[] {
  return [
    {
      id: "fullName",
      meta: { titleKey: "settings.users.fields.fullName" },
      accessorFn: (row) => row.fullName,
      cell: (info) => <span className="font-medium">{info.getValue() as string}</span>,
    },
    {
      id: "username",
      meta: { titleKey: "settings.users.fields.username" },
      accessorFn: (row) => row.username,
      cell: (info) => (
        <code dir="ltr" className="rounded bg-muted px-1.5 py-0.5 text-xs">
          {info.getValue() as string}
        </code>
      ),
    },
    {
      id: "email",
      meta: { titleKey: "settings.users.fields.email" },
      accessorFn: (row) => row.email,
      cell: (info) => (
        <span dir="ltr" className="text-caption">
          {info.getValue() as string}
        </span>
      ),
    },
    {
      id: "mobile",
      meta: { titleKey: "settings.users.fields.mobile" },
      accessorFn: (row) => row.mobile ?? "—",
    },
    {
      id: "jobTitle",
      meta: { titleKey: "settings.users.fields.jobTitle" },
      accessorFn: (row) => row.jobTitle?.name ?? "—",
    },
    {
      id: "department",
      meta: { titleKey: "settings.users.fields.department" },
      accessorFn: (row) => row.department ?? "—",
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
