"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { KeyRound, Plus, Power, PowerOff, ShieldCheck, Users } from "lucide-react";
import { DetailSection } from "@/components/shared/detail-workspace";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { CreateOperationFooter } from "@/components/shared/create-operation";
import {
  FormCardField,
  FormCardRow,
  FormCardSection,
  FormCardStack,
} from "@/components/shared/form-card/form-card";
import { SearchableSelect } from "@/components/shared/searchable-select";
import { StackedCell } from "@/components/shared/stacked-cell";
import { SemanticValue } from "@/components/shared/semantic-value";
import { RowActionsMenu } from "@/components/shared/data-table";
import {
  CompactDetailTable,
  type CompactDetailColumn,
} from "@/components/shared/data-table/compact-detail-table";
import { EnterpriseButton } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/business/status-badge";
import { GeneratedPasswordDialog } from "@/components/settings/generated-password-dialog";
import {
  AGENT_PORTAL_PERMISSIONS,
  AGENT_ROLE_PRESETS,
  agentPermissionLabelKey,
  extraPermissionChoices,
} from "@/config/agents/agent-permissions";
import { agentsService, type AgentRole, type AgentUserRow } from "@/services/agents-service";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { formatDateTime } from "@/lib/date";
import { apiErrorMessage, reportApiError, toast } from "@/lib/toast";
import { FieldNote } from "./field-note";

/** Checkbox list of `agent.*` permissions — shared by the create and edit dialogs. */
function AgentPermissionChecklist({
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

export function AgentTeamTab({ agentId, agentActive }: { agentId: string; agentActive: boolean }) {
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const canManage = hasPermission("agents.users.manage");
  const [users, setUsers] = useState<AgentUserRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [permissionsTarget, setPermissionsTarget] = useState<AgentUserRow | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<AgentUserRow | null>(null);
  const [resetTarget, setResetTarget] = useState<AgentUserRow | null>(null);
  const [password, setPassword] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setUsers(await agentsService.users.list(agentId));
    } catch (error) {
      setLoadError(apiErrorMessage(error, "errors.loadFailed"));
    }
  }, [agentId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const setActive = async (row: AgentUserRow, active: boolean) => {
    setIsBusy(true);
    try {
      await agentsService.users.setActive(agentId, row.id, active);
      toast.success(
        active ? t("agents.team.toasts.activated") : t("agents.team.toasts.deactivated"),
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
      const result = await agentsService.users.resetPassword(agentId, resetTarget.id);
      setResetTarget(null);
      if (result.temporaryPassword) setPassword(result.temporaryPassword);
      await load();
    } catch (error) {
      reportApiError(error, "errors.generic");
    } finally {
      setIsBusy(false);
    }
  };

  if (loadError) return <ErrorState description={loadError} onRetry={() => void load()} />;
  if (!users) return null;

  const columns: CompactDetailColumn<AgentUserRow>[] = [
    {
      id: "name",
      header: t("agents.team.fullName"),
      cell: (row) => (
        <StackedCell
          primary={row.fullName}
          secondary={<SemanticValue kind="email">{row.email}</SemanticValue>}
        />
      ),
    },
    {
      id: "role",
      header: t("agents.team.role"),
      cell: (row) =>
        row.agentRole ? (
          <StatusBadge
            label={t(`agents.team.roleValues.${row.agentRole}`)}
            tone={row.agentRole === "ADMIN" ? "info" : "neutral"}
          />
        ) : (
          "—"
        ),
    },
    {
      id: "status",
      header: t("agents.fields.status"),
      cell: (row) =>
        row.isLocked ? (
          <StatusBadge label={t("agents.team.statusLocked")} tone="destructive" />
        ) : row.isActive ? (
          <StatusBadge label={t("agents.team.statusActive")} tone="success" />
        ) : (
          <StatusBadge label={t("agents.team.statusInactive")} tone="neutral" />
        ),
    },
    {
      id: "lastLogin",
      header: t("agents.team.lastLogin"),
      cell: (row) =>
        row.lastLoginAt ? (
          <span className="num">{formatDateTime(row.lastLoginAt)}</span>
        ) : (
          <span className="text-muted-foreground">{t("agents.team.neverSignedIn")}</span>
        ),
    },
    ...(canManage
      ? [
          {
            id: "actions",
            header: "",
            align: "end" as const,
            cell: (row: AgentUserRow) => (
              <RowActionsMenu
                label={t("common.actions")}
                actions={[
                  {
                    key: "permissions",
                    label: t("agents.team.actions.editPermissions"),
                    icon: ShieldCheck,
                    onSelect: () => setPermissionsTarget(row),
                  },
                  {
                    key: "reset",
                    label: t("agents.team.actions.resetPassword"),
                    icon: KeyRound,
                    onSelect: () => setResetTarget(row),
                  },
                  {
                    key: "activate",
                    label: t("agents.team.actions.activate"),
                    icon: Power,
                    hidden: row.isActive,
                    separatorBefore: true,
                    onSelect: () => void setActive(row, true),
                  },
                  {
                    key: "deactivate",
                    label: t("agents.team.actions.deactivate"),
                    icon: PowerOff,
                    hidden: !row.isActive,
                    destructive: true,
                    separatorBefore: true,
                    onSelect: () => setDeactivateTarget(row),
                  },
                ]}
              />
            ),
          },
        ]
      : []),
  ];

  return (
    <DetailSection
      title={t("agents.team.title")}
      actions={
        canManage && agentActive ? (
          <EnterpriseButton type="button" size="sm" onClick={() => setCreateOpen(true)}>
            <Plus />
            {t("agents.team.new")}
          </EnterpriseButton>
        ) : null
      }
    >
      <p className="text-caption text-muted-foreground">{t("agents.team.description")}</p>
      {users.length === 0 ? (
        <EmptyState icon={Users} title={t("agents.team.empty")} />
      ) : (
        <CompactDetailTable columns={columns} rows={users} rowKey={(row) => row.id} />
      )}

      {createOpen ? (
        <CreateAgentUserDialog
          agentId={agentId}
          onOpenChange={setCreateOpen}
          onCreated={(temporaryPassword) => {
            void load();
            if (temporaryPassword) setPassword(temporaryPassword);
          }}
        />
      ) : null}

      {permissionsTarget ? (
        <EditPermissionsDialog
          agentId={agentId}
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
        title={t("agents.team.confirm.deactivateTitle", { name: deactivateTarget?.fullName ?? "" })}
        description={t("agents.team.confirm.deactivateDescription")}
        confirmLabel={t("agents.team.actions.deactivate")}
        isConfirming={isBusy}
        onConfirm={() => deactivateTarget && void setActive(deactivateTarget, false)}
      />

      <ConfirmationDialog
        open={!!resetTarget}
        onOpenChange={(open) => !open && setResetTarget(null)}
        tone="warning"
        title={t("agents.team.confirm.resetTitle", { name: resetTarget?.fullName ?? "" })}
        description={t("agents.team.confirm.resetDescription")}
        confirmLabel={t("agents.team.actions.resetPassword")}
        isConfirming={isBusy}
        onConfirm={() => void resetPassword()}
      />
    </DetailSection>
  );
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function CreateAgentUserDialog({
  agentId,
  onOpenChange,
  onCreated,
}: {
  agentId: string;
  onOpenChange: (open: boolean) => void;
  onCreated: (temporaryPassword: string | undefined) => void;
}) {
  const { t, locale } = useLocale();
  const fieldId = useId();
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [mobile, setMobile] = useState("");
  const [role, setRole] = useState<AgentRole | "">("");
  const [extra, setExtra] = useState<string[]>([]);
  const [showErrors, setShowErrors] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const required = t("agents.agreements.errors.required");
  const emailValid = EMAIL_PATTERN.test(email.trim());
  const valid = !!fullName.trim() && !!username.trim() && emailValid && !!role;

  const submit = async () => {
    if (!valid || !role) {
      setShowErrors(true);
      return;
    }
    setIsSaving(true);
    try {
      const created = await agentsService.users.create(agentId, {
        fullName: fullName.trim(),
        username: username.trim(),
        email: email.trim(),
        mobile: mobile.trim() || undefined,
        agentRole: role,
        extraPermissions: extra.length > 0 ? extra : undefined,
      });
      toast.success(t("agents.team.toasts.created", { name: created.fullName }));
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
      title={t("agents.team.createTitle")}
      isDirty={!!(fullName || username || email || mobile || role)}
      footer={(requestClose) => (
        <CreateOperationFooter
          requestClose={requestClose}
          onSubmit={() => void submit()}
          isSubmitting={isSaving}
        />
      )}
    >
      <FormCardStack>
        <FormCardSection title={t("agents.team.title")}>
          <FormCardRow>
            <FormCardField
              size="md"
              required
              label={t("agents.team.fullName")}
              htmlFor={`${fieldId}-name`}
              message={<FieldNote error={showErrors && !fullName.trim() ? required : null} />}
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
              label={t("agents.team.username")}
              htmlFor={`${fieldId}-username`}
              message={<FieldNote error={showErrors && !username.trim() ? required : null} />}
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
              label={t("agents.team.email")}
              htmlFor={`${fieldId}-email`}
              message={
                <FieldNote
                  error={showErrors && !emailValid ? t("agents.team.requiredFields") : null}
                />
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
            <FormCardField size="sm" label={t("agents.team.mobile")} htmlFor={`${fieldId}-mobile`}>
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
        <FormCardSection title={t("agents.team.permissions")}>
          <FormCardField
            required
            label={t("agents.team.role")}
            htmlFor={`${fieldId}-role`}
            message={
              <FieldNote
                error={showErrors && !role ? required : null}
                hint={
                  role
                    ? t("agents.team.presetHint", {
                        list: AGENT_ROLE_PRESETS[role]
                          .map((name) => t(agentPermissionLabelKey(name)))
                          .join(locale === "ar" ? "، " : ", "),
                      })
                    : undefined
                }
              />
            }
          >
            <SearchableSelect
              id={`${fieldId}-role`}
              value={role}
              onValueChange={(value) => {
                setRole(value as AgentRole);
                setExtra([]);
              }}
              placeholder={t("agents.agreements.choose")}
              error={showErrors && !role}
              options={(["SALES", "ADMIN"] as const).map((value) => ({
                value,
                label: t(`agents.team.roleValues.${value}`),
              }))}
            />
          </FormCardField>
          {role ? (
            <FormCardField
              label={t("agents.team.extraPermissions")}
              message={<FieldNote hint={t("agents.team.extraHint")} />}
            >
              <AgentPermissionChecklist
                choices={extraPermissionChoices(role)}
                value={extra}
                onChange={setExtra}
              />
            </FormCardField>
          ) : null}
        </FormCardSection>
      </FormCardStack>
    </EnterpriseModal>
  );
}

function EditPermissionsDialog({
  agentId,
  user,
  onOpenChange,
  onSaved,
}: {
  agentId: string;
  user: AgentUserRow;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const { t } = useLocale();
  const [initial] = useState(() => [...user.permissions].sort());
  const [value, setValue] = useState<string[]>(initial);
  const [isSaving, setIsSaving] = useState(false);

  const submit = async () => {
    setIsSaving(true);
    try {
      await agentsService.users.setPermissions(agentId, user.id, value);
      toast.success(t("agents.team.toasts.saved"));
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
      layout="form-card"
      title={t("agents.team.permissionsTitle", { name: user.fullName })}
      description={user.agentRole ? t(`agents.team.roleValues.${user.agentRole}`) : undefined}
      isDirty={JSON.stringify([...value].sort()) !== JSON.stringify(initial)}
      footer={(requestClose) => (
        <CreateOperationFooter
          requestClose={requestClose}
          onSubmit={() => void submit()}
          isSubmitting={isSaving}
        />
      )}
    >
      <AgentPermissionChecklist
        choices={AGENT_PORTAL_PERMISSIONS}
        value={value}
        onChange={setValue}
      />
    </EnterpriseModal>
  );
}
