"use client";

import { useEffect, useState } from "react";
import { UserCog } from "lucide-react";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { ModalSection } from "@/components/shared/modal-section";
import { EnterpriseButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { OMSPhoneInput, isPhoneValidForCountry } from "@/components/shared/phone-input";
import { PermissionMatrix } from "./permission-matrix";
import { usersService, type UserRow, type UserFormPayload } from "@/services/users-service";
import { jobTitlesService, type JobTitleRow } from "@/services/job-titles-service";
import { DepartmentPicker } from "@/components/business/department-picker";
import type { DepartmentRow } from "@/config/master-data/entities";
import { useCompany } from "@/providers/company-provider";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";

interface FormState {
  fullName: string;
  username: string;
  email: string;
  mobile: string;
  password: string;
  generatePassword: boolean;
  jobTitleId: string;
  departmentId: string;
  branchId: string;
  isActive: boolean;
}

const emptyForm: FormState = {
  fullName: "",
  username: "",
  email: "",
  mobile: "",
  password: "",
  generatePassword: false,
  jobTitleId: "",
  departmentId: "",
  branchId: "",
  isActive: true,
};

function formFromUser(user: UserRow): FormState {
  return {
    fullName: user.fullName,
    username: user.username,
    email: user.email,
    mobile: user.mobile ?? "",
    password: "",
    generatePassword: false,
    jobTitleId: user.jobTitleId ?? "",
    departmentId: user.departmentId ?? "",
    branchId: user.branchId ?? "",
    isActive: user.isActive,
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
  const [jobTitles, setJobTitles] = useState<JobTitleRow[]>([]);
  const [selectedDepartment, setSelectedDepartment] = useState<DepartmentRow | null>(null);
  const [archivedDepartment, setArchivedDepartment] = useState<DepartmentRow | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [copySourceId, setCopySourceId] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingRecord, setIsLoadingRecord] = useState(false);
  const [isLoadingPermissions, setIsLoadingPermissions] = useState(false);

  const branches = companies.flatMap((company) =>
    company.branches.map((branch) => ({ ...branch, companyName: company.name })),
  );

  useEffect(() => {
    if (!open) return;
    jobTitlesService
      .list()
      .then(setJobTitles)
      .catch(() => setJobTitles([]));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCopySourceId("");
    if (!user) {
      setForm(emptyForm);
      setPermissions([]);
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
    usersService
      .getPermissions(user.id)
      .then((result) => setPermissions(result.granted))
      .catch(() => setPermissions([]))
      .finally(() => setIsLoadingPermissions(false));
  }, [open, user]);

  const handleLoadPermissions = async () => {
    if (!copySourceId) return;
    try {
      const result = await usersService.getPermissions(copySourceId);
      setPermissions(result.granted);
      toast.success(t("settings.users.editor.permissionsLoaded"));
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("errors.generic"));
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
    if (!user && !form.generatePassword && form.password.trim().length < 8) {
      toast.error(t("settings.users.editor.validationPassword"));
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
      };
      let saved: UserRow;
      let temporaryPassword: string | undefined;
      if (user) {
        saved = await usersService.update(user.id, payload);
      } else {
        const created = await usersService.create({
          ...payload,
          ...(form.generatePassword ? { generatePassword: true } : { password: form.password }),
        });
        saved = created;
        temporaryPassword = created.temporaryPassword;
      }
      await usersService.setPermissions(saved.id, permissions);
      toast.success(user ? t("settings.users.toasts.saved") : t("settings.users.toasts.created"));
      onOpenChange(false);
      onSaved(temporaryPassword);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("errors.generic"));
    } finally {
      setIsSaving(false);
    }
  };

  const otherUsers = allUsers.filter((candidate) => candidate.id !== user?.id);
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
              <OMSPhoneInput
                value={form.mobile}
                onChange={(value) => setForm((c) => ({ ...c, mobile: value }))}
                countryCode={null}
              />
            </div>
            {!user && (
              <div className="flex flex-col gap-1 sm:col-span-2">
                <label className="text-caption text-muted-foreground">
                  {t("settings.users.fields.password")}
                  {!form.generatePassword && <span className="text-destructive"> *</span>}
                </label>
                {!form.generatePassword && (
                  <Input
                    inputSize="sm"
                    dir="ltr"
                    type="password"
                    autoComplete="new-password"
                    value={form.password}
                    onChange={(event) => setForm((c) => ({ ...c, password: event.target.value }))}
                  />
                )}
                <label className="flex items-center gap-2 pt-1">
                  <Checkbox
                    checked={form.generatePassword}
                    onCheckedChange={(checked) =>
                      setForm((c) => ({
                        ...c,
                        generatePassword: !!checked,
                        password: checked ? "" : c.password,
                      }))
                    }
                  />
                  <span className="text-caption font-medium">
                    {t("settings.users.editor.generatePassword")}
                  </span>
                </label>
              </div>
            )}
            <div className="flex flex-col gap-1">
              <label className="text-caption text-muted-foreground">
                {t("settings.users.fields.jobTitle")}
              </label>
              <Select
                value={form.jobTitleId || "__none__"}
                onValueChange={(v) =>
                  setForm((c) => ({ ...c, jobTitleId: v === "__none__" ? "" : v }))
                }
              >
                <SelectTrigger size="sm" className="w-full">
                  <SelectValue placeholder={t("settings.users.fields.jobTitle")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">{t("common.none")}</SelectItem>
                  {jobTitles.map((title) => (
                    <SelectItem key={title.id} value={title.id}>
                      {title.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-caption text-muted-foreground">
                {t("settings.users.fields.department")} <span className="text-destructive">*</span>
              </label>
              <DepartmentPicker
                value={selectedDepartment}
                requiredArchived={archivedDepartment}
                onChange={(department) => {
                  setSelectedDepartment(department);
                  setForm((c) => ({ ...c, departmentId: department?.id ?? "" }));
                }}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-caption text-muted-foreground">
                {t("settings.users.fields.branch")}
              </label>
              <Select
                value={form.branchId || "__none__"}
                onValueChange={(v) =>
                  setForm((c) => ({ ...c, branchId: v === "__none__" ? "" : v }))
                }
              >
                <SelectTrigger size="sm" className="w-full">
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
          </ModalSection>

          {otherUsers.length > 0 && (
            <ModalSection title={t("settings.users.editor.copyPermissionsFrom")} columns={2}>
              <div className="col-span-full flex items-center gap-2">
                <Select value={copySourceId} onValueChange={setCopySourceId}>
                  <SelectTrigger size="sm" className="w-64">
                    <SelectValue placeholder={t("settings.users.editor.selectUser")} />
                  </SelectTrigger>
                  <SelectContent>
                    {otherUsers.map((candidate) => (
                      <SelectItem key={candidate.id} value={candidate.id}>
                        {candidate.fullName} ({candidate.username})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
            <div className="col-span-full">
              <PermissionMatrix value={permissions} onChange={setPermissions} />
            </div>
          </ModalSection>
        </div>
      )}
    </EnterpriseModal>
  );
}
