"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { UserCog } from "lucide-react";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { ModalSection } from "@/components/shared/modal-section";
import { EnterpriseButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/shared/password-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { OMSPhoneInput, isPhoneValidForCountry } from "@/components/shared/phone-input";
import { PASSWORD_POLICY, generateSecurePassword } from "@/lib/password-generator";
import { PermissionMatrix } from "./permission-matrix";
import {
  usersService,
  type PermissionOverrides,
  type UserPermissionPanel as UserPermissionPanelData,
  type UserRow,
  type UserFormPayload,
} from "@/services/users-service";
import { UserPermissionPanel } from "./user-permission-panel";
import { useUserContext } from "@/providers/user-context";
import { DepartmentPicker } from "@/components/business/department-picker";
import { UserPicker } from "@/components/business/user-picker";
import { SearchableSelect } from "@/components/shared/searchable-select";
import { useCountries, useJobTitles } from "@/hooks/use-reference-data";
import type { DepartmentRow } from "@/config/master-data/entities";
import { useCompany } from "@/providers/company-provider";
import { useLocale } from "@/providers/locale-provider";
import { toast, reportApiError } from "@/lib/toast";
import Link from "next/link";
import { Alert, AlertDescription } from "@/components/ui/alert";

const EMPTY_OVERRIDES: PermissionOverrides = { grants: [], denies: [] };

interface FormState {
  fullName: string;
  username: string;
  email: string;
  mobile: string;
  password: string;
  /** The password is the one the form generated (unchanged) — temporary, changed at first sign-in. */
  passwordGenerated: boolean;
  jobTitleId: string;
  departmentId: string;
  branchId: string;
  isActive: boolean;
  salesDistributionEligible: boolean;
}

const emptyForm: FormState = {
  fullName: "",
  username: "",
  email: "",
  mobile: "",
  password: "",
  passwordGenerated: false,
  jobTitleId: "",
  departmentId: "",
  branchId: "",
  isActive: true,
  salesDistributionEligible: false,
};

function formFromUser(user: UserRow): FormState {
  return {
    fullName: user.fullName,
    username: user.username,
    email: user.email,
    mobile: user.mobile ?? "",
    password: "",
    passwordGenerated: false,
    jobTitleId: user.jobTitleId ?? "",
    departmentId: user.departmentId ?? "",
    branchId: user.branchId ?? "",
    isActive: user.isActive,
    salesDistributionEligible: user.salesDistributionEligible ?? false,
  };
}

/**
 * TASK-060 — the User Editor: Part 1's fields/actions plus Part 3's
 * Permission Matrix and Part 9's "Copy Permissions From," all in one modal
 * (never a Role picker — permissions are edited directly, per-user).
 */
export function UserEditorModal({
  open,
  onOpenChange,
  user,
  allUsers,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = Create mode */
  user: UserRow | null;
  /** For "Copy Permissions From" — every other user to pick as a source. */
  allUsers: UserRow[];
  onSaved: (temporaryPassword?: string) => void;
}) {
  const { t } = useLocale();
  const { companies } = useCompany();
  const jobTitles = useJobTitles();
  const countries = useCountries();
  const fieldId = useId();
  const [selectedDepartment, setSelectedDepartment] = useState<DepartmentRow | null>(null);
  const [archivedDepartment, setArchivedDepartment] = useState<DepartmentRow | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [permissions, setPermissions] = useState<string[]>([]);
  // R14 W2 — internal users: job-title template + individual overrides.
  const [overrides, setOverrides] = useState<PermissionOverrides>(EMPTY_OVERRIDES);
  const [permissionPanel, setPermissionPanel] = useState<UserPermissionPanelData | null>(null);
  const { user: currentUser, isSuperAdmin, hasPermission } = useUserContext();
  const [copySourceId, setCopySourceId] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingRecord, setIsLoadingRecord] = useState(false);
  const [isLoadingPermissions, setIsLoadingPermissions] = useState(false);

  const branches = companies.flatMap((company) =>
    company.branches.map((branch) => ({ ...branch, companyName: company.name })),
  );

  // Titles for the selected Department surface first — a nudge, not a hard
  // filter (a generic/cross-department title stays fully selectable).
  const sortedJobTitles = useMemo(() => {
    if (!form.departmentId) return jobTitles;
    return [...jobTitles].sort((a, b) => {
      const aMatch = a.departmentId === form.departmentId ? 0 : 1;
      const bMatch = b.departmentId === form.departmentId ? 0 : 1;
      return aMatch - bMatch;
    });
  }, [jobTitles, form.departmentId]);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCopySourceId("");
    if (!user) {
      // Smart default (R13 A2): a strong password is already suggested, visible
      // and copyable; the admin may keep it, regenerate it or type their own.
      setForm({ ...emptyForm, password: generateSecurePassword(), passwordGenerated: true });
      setPermissions([]);
      setOverrides(EMPTY_OVERRIDES);
      setPermissionPanel(null);
      setSelectedDepartment(null);
      setArchivedDepartment(null);
      setIsLoadingRecord(false);
      setIsLoadingPermissions(false);
      return;
    }
    setForm(formFromUser(user));
    setSelectedDepartment(
      user.department
        ? {
            id: user.department.id,
            code: user.department.code,
            name: user.department.name,
            nameEn: user.department.nameEn,
            description: null,
            sortOrder: 0,
            isActive: user.department.isActive,
            deletedAt: user.department.deletedAt,
          }
        : null,
    );
    setArchivedDepartment(
      user.department?.deletedAt
        ? {
            id: user.department.id,
            code: user.department.code,
            name: user.department.name,
            nameEn: user.department.nameEn,
            description: null,
            sortOrder: 0,
            isActive: user.department.isActive,
            deletedAt: user.department.deletedAt,
          }
        : null,
    );
    setIsLoadingRecord(true);
    setIsLoadingPermissions(true);
    usersService
      .get(user.id)
      .then((fresh) => setForm(formFromUser(fresh)))
      .catch(() => {
        // Table row data already populated the form; keep it if refresh fails.
      })
      .finally(() => setIsLoadingRecord(false));
    if (user.userType === "AGENT") {
      usersService
        .getPermissions(user.id)
        .then((result) => setPermissions(result.granted))
        .catch(() => setPermissions([]))
        .finally(() => setIsLoadingPermissions(false));
      return;
    }
    setPermissionPanel(null);
    usersService
      .getPermissionOverrides(user.id)
      .then((panel) => {
        setPermissionPanel(panel);
        setOverrides({ grants: panel.grants, denies: panel.denies });
      })
      .catch(() => setOverrides(EMPTY_OVERRIDES))
      .finally(() => setIsLoadingPermissions(false));
  }, [open, user]);

  const handleLoadPermissions = async () => {
    if (!copySourceId) return;
    try {
      if (isAgentUser) {
        const result = await usersService.getPermissions(copySourceId);
        setPermissions(result.granted);
      } else {
        const source = await usersService.getPermissionOverrides(copySourceId);
        setOverrides({ grants: source.grants, denies: source.denies });
      }
      toast.success(t("settings.users.editor.permissionsLoaded"));
    } catch (error) {
      reportApiError(error, "errors.generic");
    }
  };

  const handleSave = async () => {
    if (isSaving || isLoadingRecord) return;
    if (!form.fullName.trim() || !form.username.trim() || !form.email.trim()) {
      toast.error(t("settings.users.editor.validationRequired"));
      return;
    }
    if (!form.departmentId) {
      toast.error(t("settings.users.editor.validationDepartment"));
      return;
    }
    if (
      !user &&
      (form.password.trim().length < PASSWORD_POLICY.minLength ||
        form.password.length > PASSWORD_POLICY.maxLength)
    ) {
      toast.error(
        t("settings.users.editor.validationPassword", {
          min: PASSWORD_POLICY.minLength,
          max: PASSWORD_POLICY.maxLength,
        }),
      );
      return;
    }
    if (form.mobile.trim() && !isPhoneValidForCountry(form.mobile, null)) {
      toast.error(t("phone.errors.INVALID_PATTERN"));
      return;
    }
    setIsSaving(true);
    try {
      const payload: UserFormPayload = {
        fullName: form.fullName.trim(),
        username: form.username.trim(),
        email: form.email.trim().toLowerCase(),
        mobile: form.mobile || undefined,
        departmentId: form.departmentId,
        jobTitleId: form.jobTitleId || undefined,
        branchId: form.branchId || undefined,
        isActive: form.isActive,
        // Agent users are never lead recipients and the server rejects the field.
        ...(user?.userType === "AGENT"
          ? {}
          : { salesDistributionEligible: form.salesDistributionEligible }),
      };
      let saved: UserRow;
      let temporaryPassword: string | undefined;
      if (user) {
        saved = await usersService.update(user.id, payload);
      } else {
        const created = await usersService.create({
          ...payload,
          password: form.password,
          ...(form.passwordGenerated ? { mustChangePassword: true } : {}),
        });
        saved = created;
        temporaryPassword = created.temporaryPassword;
      }
      if (isAgentUser) {
        await usersService.setPermissions(saved.id, permissions);
      } else if (!permissionsReadOnlyReason) {
        await usersService.setPermissionOverrides(saved.id, overrides);
      }
      toast.success(user ? t("settings.users.toasts.saved") : t("settings.users.toasts.created"));
      onOpenChange(false);
      onSaved(temporaryPassword);
    } catch (error) {
      reportApiError(error, "errors.generic");
    } finally {
      setIsSaving(false);
    }
  };

  // Agents milestone (spec §3): agent users hold only agent-portal permissions,
  // and permissions are never copied across user types.
  const isAgentUser = user?.userType === "AGENT";
  // R14 W2 — the server rejects self-edits and saves without the right (403);
  // the panel says so up front instead.
  const permissionsReadOnlyReason = !hasPermission("users.manage_permissions")
    ? t("permissionTemplates.userPanel.readOnly")
    : user && currentUser?.id === user.id && !isSuperAdmin
      ? t("permissionTemplates.userPanel.selfEdit")
      : null;
  const otherUsers = allUsers.filter(
    (candidate) => candidate.id !== user?.id && (candidate.userType === "AGENT") === isAgentUser,
  );
  const loading = isLoadingRecord || isLoadingPermissions;

  return (
    <EnterpriseModal
      open={open}
      onOpenChange={onOpenChange}
      size="xl"
      icon={UserCog}
      title={user ? user.fullName : t("settings.users.editor.newTitle")}
      description={user ? user.email : undefined}
      footer={(requestClose) => (
        <>
          <EnterpriseButton
            type="button"
            variant="outline"
            onClick={requestClose}
            disabled={isSaving}
          >
            {t("common.cancel")}
          </EnterpriseButton>
          <EnterpriseButton
            type="button"
            onClick={handleSave}
            disabled={isSaving || loading}
            isLoading={isSaving}
          >
            {t("common.save")}
          </EnterpriseButton>
        </>
      )}
    >
      {loading ? (
        <div className="p-6 text-center text-caption text-muted-foreground">
          {t("common.loading")}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <ModalSection title={t("settings.users.editor.sectionDetails")} columns={3}>
            <div className="flex flex-col gap-1">
              <label className="text-caption text-muted-foreground">
                {t("settings.users.fields.fullName")} <span className="text-destructive">*</span>
              </label>
              <Input
                inputSize="sm"
                value={form.fullName}
                onChange={(event) => setForm((c) => ({ ...c, fullName: event.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-caption text-muted-foreground">
                {t("settings.users.fields.username")} <span className="text-destructive">*</span>
              </label>
              <Input
                inputSize="sm"
                dir="ltr"
                value={form.username}
                onChange={(event) => setForm((c) => ({ ...c, username: event.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-caption text-muted-foreground">
                {t("settings.users.fields.email")} <span className="text-destructive">*</span>
              </label>
              <Input
                inputSize="sm"
                dir="ltr"
                type="email"
                autoCapitalize="none"
                autoCorrect="off"
                value={form.email}
                onChange={(event) => setForm((c) => ({ ...c, email: event.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-caption text-muted-foreground">
                {t("settings.users.fields.mobile")}
              </label>
              {/* The calling code is the phone's own (R13 A1): picked in the field, read back from the stored number. */}
              <OMSPhoneInput
                value={form.mobile}
                onChange={(value) => setForm((c) => ({ ...c, mobile: value }))}
                countries={countries}
              />
            </div>
            {!user && (
              <div className="flex flex-col gap-1 sm:col-span-2">
                <label
                  htmlFor={`${fieldId}-password`}
                  className="text-caption text-muted-foreground"
                >
                  {t("settings.users.fields.password")}
                  <span className="text-destructive"> *</span>
                </label>
                <PasswordInput
                  id={`${fieldId}-password`}
                  inputSize="sm"
                  autoComplete="new-password"
                  generatable
                  defaultVisible
                  maxLength={PASSWORD_POLICY.maxLength}
                  value={form.password}
                  onChange={(event) =>
                    setForm((c) => ({
                      ...c,
                      password: event.target.value,
                      passwordGenerated: false,
                    }))
                  }
                  onGenerated={() => setForm((c) => ({ ...c, passwordGenerated: true }))}
                />
                {form.passwordGenerated ? (
                  <p className="text-caption text-muted-foreground">
                    {t("settings.users.editor.generatedPasswordHint")}
                  </p>
                ) : null}
              </div>
            )}
            <div className="flex flex-col gap-1">
              <label
                htmlFor={`${fieldId}-job-title`}
                className="text-caption text-muted-foreground"
              >
                {t("settings.users.fields.jobTitle")}
              </label>
              {/* Cleared ("") is "none", as the old "__none__" row was. */}
              <SearchableSelect
                id={`${fieldId}-job-title`}
                value={form.jobTitleId}
                onValueChange={(v) => setForm((c) => ({ ...c, jobTitleId: v }))}
                options={sortedJobTitles.map((title) => ({ value: title.id, label: title.name }))}
                allowClear
                placeholder={t("common.none")}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label
                htmlFor={`${fieldId}-department`}
                className="text-caption text-muted-foreground"
              >
                {t("settings.users.fields.department")} <span className="text-destructive">*</span>
              </label>
              <DepartmentPicker
                id={`${fieldId}-department`}
                value={selectedDepartment}
                requiredArchived={archivedDepartment}
                onChange={(department) => {
                  setSelectedDepartment(department);
                  setForm((c) => ({ ...c, departmentId: department?.id ?? "" }));
                }}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={`${fieldId}-branch`} className="text-caption text-muted-foreground">
                {t("settings.users.fields.branch")}
              </label>
              <Select
                value={form.branchId || "__none__"}
                onValueChange={(v) =>
                  setForm((c) => ({ ...c, branchId: v === "__none__" ? "" : v }))
                }
              >
                <SelectTrigger id={`${fieldId}-branch`} size="sm" className="w-full">
                  <SelectValue placeholder={t("settings.users.fields.branch")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">{t("common.none")}</SelectItem>
                  {branches.map((branch) => (
                    <SelectItem key={branch.id} value={branch.id}>
                      {branch.companyName} — {branch.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2 self-end pb-1">
              <Checkbox
                checked={form.isActive}
                onCheckedChange={(checked) => setForm((c) => ({ ...c, isActive: !!checked }))}
              />
              <label className="text-caption font-medium">
                {t("settings.users.fields.active")}
              </label>
            </div>
            {isAgentUser ? null : (
              <div className="flex flex-col gap-0.5 sm:col-span-2">
                <label className="flex items-center gap-2">
                  <Checkbox
                    checked={form.salesDistributionEligible}
                    onCheckedChange={(checked) =>
                      setForm((c) => ({ ...c, salesDistributionEligible: !!checked }))
                    }
                  />
                  <span className="text-caption font-medium">{t("leadOps.userFlag.label")}</span>
                </label>
                <p className="ps-6 text-caption text-muted-foreground">
                  {t("leadOps.userFlag.hint")}
                </p>
              </div>
            )}
          </ModalSection>

          {otherUsers.length > 0 && (
            <ModalSection title={t("settings.users.editor.copyPermissionsFrom")} columns={2}>
              <div className="col-span-full flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <UserPicker
                    value={copySourceId}
                    onValueChange={setCopySourceId}
                    activeOnly={false}
                    excludeIds={user ? [user.id] : undefined}
                    placeholder={t("settings.users.editor.selectUser")}
                    aria-label={t("settings.users.editor.copyPermissionsFrom")}
                  />
                </div>
                <EnterpriseButton
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!copySourceId}
                  onClick={handleLoadPermissions}
                >
                  {t("settings.users.editor.loadPermissions")}
                </EnterpriseButton>
              </div>
            </ModalSection>
          )}

          <ModalSection title={t("settings.users.editor.sectionPermissions")} columns={2}>
            {isAgentUser ? (
              <Alert tone="info" className="col-span-full">
                <AlertDescription className="flex flex-wrap items-center gap-2">
                  <span>{t("agents.users.agentNote")}</span>
                  {user?.agent ? (
                    <Link
                      href={`/agents/${user.agent.id}?tab=team`}
                      className="font-medium underline"
                    >
                      {t("agents.users.openTeam")}
                    </Link>
                  ) : null}
                </AlertDescription>
              </Alert>
            ) : null}
            <div className="col-span-full">
              {isAgentUser ? (
                <PermissionMatrix value={permissions} onChange={setPermissions} audience="agent" />
              ) : (
                <UserPermissionPanel
                  panel={permissionPanel}
                  jobTitleId={form.jobTitleId || null}
                  jobTitleName={
                    jobTitles.find((title) => title.id === form.jobTitleId)?.name ?? null
                  }
                  value={overrides}
                  onChange={setOverrides}
                  readOnlyReason={permissionsReadOnlyReason}
                />
              )}
            </div>
          </ModalSection>
        </div>
      )}
    </EnterpriseModal>
  );
}
