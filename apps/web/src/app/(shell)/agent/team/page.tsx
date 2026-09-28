"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { KeyRound, Power, PowerOff, ShieldCheck, UserPlus, Users } from "lucide-react";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { HeaderActions } from "@/components/shared/header-actions";
import { DetailSection } from "@/components/shared/detail-workspace";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { PageLoading } from "@/components/shared/page-loading";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { CreateOperationFooter } from "@/components/shared/create-operation";
import {
  FormCardField,
  FormCardRow,
  FormCardSection,
  FormCardStack,
} from "@/components/shared/form-card/form-card";
import { StackedCell } from "@/components/shared/stacked-cell";
import { SemanticValue } from "@/components/shared/semantic-value";
import { RowActionsMenu } from "@/components/shared/data-table";
import {
  CompactDetailTable,
  type CompactDetailColumn,
} from "@/components/shared/data-table/compact-detail-table";
import { StatusBadge } from "@/components/business/status-badge";
import { GeneratedPasswordDialog } from "@/components/settings/generated-password-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { FieldMessage } from "@/components/ui/form";
import {
  AGENT_PORTAL_PERMISSIONS,
  AGENT_ROLE_PRESETS,
  agentPermissionLabelKey,
} from "@/config/agents/agent-permissions";
import { agentPortalService, type PortalTeamUser } from "@/services/agent-portal-service";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { formatDateTime } from "@/lib/date";
import { apiErrorMessage, reportApiError, toast } from "@/lib/toast";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Permissions an Agent Admin may hand to a sales user: ones they hold, never team management. */
function useDelegablePermissions(): string[] {
  const { permissions } = useUserContext();
  return useMemo(
    () =>
      AGENT_PORTAL_PERMISSIONS.filter(
        (name) => name !== "agent.team.manage" && permissions.includes(name),
      ),
    [permissions],
  );
}

function PermissionChecklist({
  choices,
  value,
  onChange,
}: {
  choices: readonly string[];
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const { t } = useLocale();
  const granted = new Set(value);
  return (
    <div className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
      {choices.map((name) => (
        <label key={name} className="flex items-center gap-2 text-body select-none">
          <Checkbox
            checked={granted.has(name)}
            onCheckedChange={(checked) => {
              const next = new Set(value);
              if (checked) next.add(name);
              else next.delete(name);
              onChange(choices.filter((choice) => next.has(choice)));
            }}
          />
          {t(agentPermissionLabelKey(name))}
        </label>
      ))}
    </div>
  );
}

/**
 * Agent team (spec §3): the agent's users; an Agent Admin with
 * `agent.team.manage` adds SALES users, delegates only permissions they hold,
 * activates / deactivates and resets passwords. The API enforces every
 * delegation rule and its refusal is shown as is.
 */
export default function AgentTeamPage() {
  const { t } = useLocale();
  const { hasPermission, user } = useUserContext();
  const canManage = hasPermission("agent.team.manage");
  const [users, setUsers] = useState<PortalTeamUser[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [permissionsTarget, setPermissionsTarget] = useState<PortalTeamUser | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<PortalTeamUser | null>(null);
  const [resetTarget, setResetTarget] = useState<PortalTeamUser | null>(null);
  const [password, setPassword] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setUsers(await agentPortalService.team.list());
    } catch (error) {
      setLoadError(apiErrorMessage(error, "agentPortal.common.loadFailed"));
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const setActive = async (row: PortalTeamUser, active: boolean) => {
    setIsBusy(true);
    try {
      if (active) await agentPortalService.team.activate(row.id);
      else await agentPortalService.team.deactivate(row.id);
      toast.success(
        t(active ? "agentPortal.team.toasts.activated" : "agentPortal.team.toasts.deactivated"),
      );
      setDeactivateTarget(null);
      await load();
    } catch (error) {
      reportApiError(error, "errors.generic");
    } finally {
      setIsBusy(false);
    }
  };

  const resetPassword = async () => {
    if (!resetTarget) return;
    setIsBusy(true);
    try {
      const result = await agentPortalService.team.resetPassword(resetTarget.id);
      setResetTarget(null);
      toast.success(t("agentPortal.team.toasts.passwordReset"));
      if (result.temporaryPassword) setPassword(result.temporaryPassword);
    } catch (error) {
      reportApiError(error, "errors.generic");
    } finally {
      setIsBusy(false);
    }
  };

  if (loadError) return <ErrorState description={loadError} onRetry={() => void load()} />;
  if (!users) return <PageLoading />;

  // Only SALES users other than yourself are managed from the portal (the API refuses the rest).
  const manageable = (row: PortalTeamUser) =>
    canManage && row.agentRole === "SALES" && row.id !== user?.id;

  const columns: CompactDetailColumn<PortalTeamUser>[] = [
    {
      id: "name",
      header: t("agentPortal.team.fields.fullName"),
      cell: (row) => (
        <StackedCell
          primary={row.fullName}
          secondary={<SemanticValue kind="email">{row.email}</SemanticValue>}
        />
      ),
    },
    {
      id: "role",
      header: t("agentPortal.team.fields.role"),
      cell: (row) =>
        row.agentRole ? (
          <StatusBadge
            label={t(`agentPortal.status.role.${row.agentRole}`)}
            tone={row.agentRole === "ADMIN" ? "info" : "neutral"}
          />
        ) : (
          "—"
        ),
    },
    {
      id: "status",
      header: t("agentPortal.team.fields.status"),
      cell: (row) =>
        row.isLocked ? (
          <StatusBadge label={t("agentPortal.status.user.locked")} tone="destructive" />
        ) : row.isActive ? (
          <StatusBadge label={t("agentPortal.status.user.active")} tone="success" />
        ) : (
          <StatusBadge label={t("agentPortal.status.user.inactive")} tone="neutral" />
        ),
    },
    {
      id: "lastLogin",
      header: t("agentPortal.team.fields.lastLogin"),
      cell: (row) =>
        row.lastLoginAt ? (
          <span className="num">{formatDateTime(row.lastLoginAt)}</span>
        ) : (
          <span className="text-muted-foreground">{t("agentPortal.team.neverSignedIn")}</span>
        ),
    },
    ...(canManage
      ? [
          {
            id: "actions",
            header: "",
            align: "end" as const,
            cell: (row: PortalTeamUser) =>
              manageable(row) ? (
                <RowActionsMenu
                  label={t("common.actions")}
                  actions={[
                    {
                      key: "permissions",
                      label: t("agentPortal.team.actions.permissions"),
                      icon: ShieldCheck,
                      onSelect: () => setPermissionsTarget(row),
                    },
                    {
                      key: "reset",
                      label: t("agentPortal.team.actions.resetPassword"),
                      icon: KeyRound,
                      onSelect: () => setResetTarget(row),
                    },
                    {
                      key: "activate",
                      label: t("agentPortal.team.actions.activate"),
                      icon: Power,
                      hidden: row.isActive,
                      separatorBefore: true,
                      onSelect: () => void setActive(row, true),
                    },
                    {
                      key: "deactivate",
                      label: t("agentPortal.team.actions.deactivate"),
                      icon: PowerOff,
                      hidden: !row.isActive,
                      destructive: true,
                      separatorBefore: true,
                      onSelect: () => setDeactivateTarget(row),
                    },
                  ]}
                />
              ) : null,
          },
        ]
      : []),
  ];

  return (
    <PageWorkspace
      title={t("agentPortal.team.title")}
      description={t("agentPortal.team.description")}
      actions={
        <HeaderActions
          primary={{
            key: "create",
            label: t("agentPortal.team.new"),
            icon: UserPlus,
            hidden: !canManage,
            onSelect: () => setCreateOpen(true),
          }}
        />
      }
    >
      <DetailSection>
        {users.length === 0 ? (
          <EmptyState icon={Users} title={t("agentPortal.team.empty")} />
        ) : (
          <CompactDetailTable columns={columns} rows={users} rowKey={(row) => row.id} />
        )}
      </DetailSection>

      {createOpen ? (
        <CreateSalesUserDialog
          onOpenChange={setCreateOpen}
          onCreated={(temporaryPassword) => {
            void load();
            if (temporaryPassword) setPassword(temporaryPassword);
          }}
        />
      ) : null}

      {permissionsTarget ? (
        <EditPermissionsDialog
          user={permissionsTarget}
          onOpenChange={(open) => !open && setPermissionsTarget(null)}
          onSaved={() => void load()}
        />
      ) : null}

      <GeneratedPasswordDialog
        password={password}
        onOpenChange={(open) => {
          if (!open) setPassword(null);
        }}
      />

      <ConfirmationDialog
        open={!!deactivateTarget}
        onOpenChange={(open) => !open && setDeactivateTarget(null)}
        tone="destructive"
        title={t("agentPortal.team.confirm.deactivateTitle", {
          name: deactivateTarget?.fullName ?? "",
        })}
        description={t("agentPortal.team.confirm.deactivateDescription")}
        confirmLabel={t("agentPortal.team.actions.deactivate")}
        isConfirming={isBusy}
        onConfirm={() => deactivateTarget && void setActive(deactivateTarget, false)}
      />

      <ConfirmationDialog
        open={!!resetTarget}
        onOpenChange={(open) => !open && setResetTarget(null)}
        tone="warning"
        title={t("agentPortal.team.confirm.resetTitle", { name: resetTarget?.fullName ?? "" })}
        description={t("agentPortal.team.confirm.resetDescription")}
        confirmLabel={t("agentPortal.team.actions.resetPassword")}
        isConfirming={isBusy}
        onConfirm={() => void resetPassword()}
      />
    </PageWorkspace>
  );
}

function CreateSalesUserDialog({
  onOpenChange,
  onCreated,
}: {
  onOpenChange: (open: boolean) => void;
  onCreated: (temporaryPassword: string | undefined) => void;
}) {
  const { t } = useLocale();
  const fieldId = useId();
  const delegable = useDelegablePermissions();
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [mobile, setMobile] = useState("");
  const [permissions, setPermissions] = useState<string[]>(() =>
    delegable.filter((name) => (AGENT_ROLE_PRESETS.SALES as string[]).includes(name)),
  );
  const [showErrors, setShowErrors] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const required = t("agentPortal.team.errors.required");
  const emailValid = EMAIL_PATTERN.test(email.trim());
  const valid = !!fullName.trim() && !!username.trim() && emailValid;

  const submit = async () => {
    if (!valid) {
      setShowErrors(true);
      return;
    }
    setIsSaving(true);
    try {
      const created = await agentPortalService.team.create({
        fullName: fullName.trim(),
        username: username.trim(),
        email: email.trim(),
        mobile: mobile.trim() || undefined,
        permissionNames: permissions,
      });
      toast.success(t("agentPortal.team.toasts.created", { name: created.fullName }));
      onCreated(created.temporaryPassword);
      onOpenChange(false);
    } catch (error) {
      reportApiError(error, "common.failedToSave");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <EnterpriseModal
      open
      onOpenChange={onOpenChange}
      size="md"
      layout="form-card"
      title={t("agentPortal.team.createTitle")}
      isDirty={!!(fullName || username || email || mobile)}
      footer={(requestClose) => (
        <CreateOperationFooter
          requestClose={requestClose}
          onSubmit={() => void submit()}
          isSubmitting={isSaving}
        />
      )}
    >
      <FormCardStack>
        <FormCardSection title={t("agentPortal.team.createTitle")}>
          <FormCardRow>
            <FormCardField
              size="md"
              required
              label={t("agentPortal.team.fields.fullName")}
              htmlFor={`${fieldId}-name`}
              message={
                <FieldMessage announce={false}>
                  {showErrors && !fullName.trim() ? required : null}
                </FieldMessage>
              }
            >
              <Input
                id={`${fieldId}-name`}
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
              />
            </FormCardField>
            <FormCardField
              size="sm"
              required
              label={t("agentPortal.team.fields.username")}
              htmlFor={`${fieldId}-username`}
              message={
                <FieldMessage announce={false}>
                  {showErrors && !username.trim() ? required : null}
                </FieldMessage>
              }
            >
              <Input
                id={`${fieldId}-username`}
                dir="ltr"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </FormCardField>
          </FormCardRow>
          <FormCardRow>
            <FormCardField
              size="md"
              required
              label={t("agentPortal.team.fields.email")}
              htmlFor={`${fieldId}-email`}
              message={
                <FieldMessage announce={false}>
                  {showErrors && !emailValid ? t("agentPortal.team.errors.email") : null}
                </FieldMessage>
              }
            >
              <Input
                id={`${fieldId}-email`}
                dir="ltr"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </FormCardField>
            <FormCardField
              size="sm"
              label={t("agentPortal.team.fields.mobile")}
              htmlFor={`${fieldId}-mobile`}
            >
              <Input
                id={`${fieldId}-mobile`}
                dir="ltr"
                inputMode="tel"
                value={mobile}
                onChange={(event) => setMobile(event.target.value)}
              />
            </FormCardField>
          </FormCardRow>
        </FormCardSection>
        <FormCardSection
          title={t("agentPortal.team.fields.permissions")}
          description={t("agentPortal.team.permissionsHint")}
        >
          <PermissionChecklist choices={delegable} value={permissions} onChange={setPermissions} />
        </FormCardSection>
      </FormCardStack>
    </EnterpriseModal>
  );
}

function EditPermissionsDialog({
  user,
  onOpenChange,
  onSaved,
}: {
  user: PortalTeamUser;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const { t } = useLocale();
  const delegable = useDelegablePermissions();
  const [permissions, setPermissions] = useState<string[]>(() =>
    delegable.filter((name) => user.permissions.includes(name)),
  );
  const [isSaving, setIsSaving] = useState(false);

  const save = async () => {
    setIsSaving(true);
    try {
      await agentPortalService.team.setPermissions(user.id, permissions);
      toast.success(t("agentPortal.team.toasts.permissionsSaved"));
      onSaved();
      onOpenChange(false);
    } catch (error) {
      reportApiError(error, "common.failedToSave");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <EnterpriseModal
      open
      onOpenChange={onOpenChange}
      size="md"
      title={t("agentPortal.team.permissionsTitle", { name: user.fullName })}
      description={t("agentPortal.team.permissionsHint")}
      footer={(requestClose) => (
        <CreateOperationFooter
          requestClose={requestClose}
          onSubmit={() => void save()}
          isSubmitting={isSaving}
        />
      )}
    >
      <PermissionChecklist choices={delegable} value={permissions} onChange={setPermissions} />
    </EnterpriseModal>
  );
}
