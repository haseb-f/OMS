"use client";

import { useEffect, useState } from "react";
import { UserCog } from "lucide-react";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
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
  jobTitleId: string;
  department: string;
  branchId: string;
  isActive: boolean;
}

const emptyForm: FormState = {
  fullName: "",
  username: "",
  email: "",
  mobile: "",
  password: "",
  jobTitleId: "",
  department: "",
  branchId: "",
  isActive: true,
};

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
  onSaved: () => void;
}) {
  const { t } = useLocale();
  const { companies } = useCompany();
  const [jobTitles, setJobTitles] = useState<JobTitleRow[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [copySourceId, setCopySourceId] = useState("");
  const [isSaving, setIsSaving] = useState(false);
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
    if (user) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setForm({
        fullName: user.fullName,
        username: user.username,
        email: user.email,
        mobile: user.mobile ?? "",
        password: "",
        jobTitleId: user.jobTitleId ?? "",
        department: user.department ?? "",
        branchId: user.branchId ?? "",
        isActive: user.isActive,
      });
      setIsLoadingPermissions(true);
      usersService
        .getPermissions(user.id)
        .then((result) => setPermissions(result.granted))
        .catch(() => setPermissions([]))
        .finally(() => setIsLoadingPermissions(false));
    } else {
      setForm(emptyForm);
      setPermissions([]);
    }
    setCopySourceId("");
  }, [open, user]);

  const handleLoadPermissions = async () => {
    if (!copySourceId) return;
    try {
      const result = await usersService.getPermissions(copySourceId);
      setPermissions(result.granted);
      toast.success(t("settings.users.editor.permissionsLoaded"));
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to load permissions.");
    }
  };

  const handleSave = async () => {
    if (!form.fullName.trim() || !form.username.trim() || !form.email.trim()) {
      toast.error(t("settings.users.editor.validationRequired"));
      return;
    }
    if (!user && form.password.trim().length < 8) {
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
        fullName: form.fullName,
        username: form.username,
        email: form.email,
        mobile: form.mobile || undefined,
        department: form.department || undefined,
        jobTitleId: form.jobTitleId || undefined,
        branchId: form.branchId || undefined,
        isActive: form.isActive,
      };
      let saved: UserRow;
      if (user) {
        saved = await usersService.update(user.id, payload);
      } else {
        saved = await usersService.create({ ...payload, password: form.password });
      }
      await usersService.setPermissions(saved.id, permissions);
      toast.success(t("common.save"));
      onOpenChange(false);
      onSaved();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Something went wrong.");
    } finally {
      setIsSaving(false);
    }
  };

  const otherUsers = allUsers.filter((candidate) => candidate.id !== user?.id);

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
          <EnterpriseButton type="button" onClick={handleSave} disabled={isSaving}>
            {t("common.save")}
          </EnterpriseButton>
        </>
      )}
    >
      <div className="flex flex-col gap-5">
        <div>
          <h3 className="mb-2 text-card-title font-heading">
            {t("settings.users.editor.sectionDetails")}
          </h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
                // No Country field exists on User (Employees/system accounts
                // aren't tied to one) — falls back to the same
                // international-format-only rule this field already had.
                countryCode={null}
              />
            </div>
            {!user && (
              <div className="flex flex-col gap-1">
                <label className="text-caption text-muted-foreground">
                  {t("settings.users.fields.password")} <span className="text-destructive">*</span>
                </label>
                <Input
                  inputSize="sm"
                  dir="ltr"
                  type="password"
                  value={form.password}
                  onChange={(event) => setForm((c) => ({ ...c, password: event.target.value }))}
                />
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
                {t("settings.users.fields.department")}
              </label>
              <Input
                inputSize="sm"
                value={form.department}
                onChange={(event) => setForm((c) => ({ ...c, department: event.target.value }))}
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
            <div className="flex items-center gap-2 self-end pb-1.5">
              <Checkbox
                checked={form.isActive}
                onCheckedChange={(checked) => setForm((c) => ({ ...c, isActive: !!checked }))}
              />
              <label className="text-caption font-medium">
                {t("settings.users.fields.active")}
              </label>
            </div>
          </div>
        </div>

        {otherUsers.length > 0 && (
          <div>
            <h3 className="mb-2 text-card-title font-heading">
              {t("settings.users.editor.copyPermissionsFrom")}
            </h3>
            <div className="flex items-center gap-2">
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
          </div>
        )}

        <div>
          <h3 className="mb-2 text-card-title font-heading">
            {t("settings.users.editor.sectionPermissions")}
          </h3>
          {isLoadingPermissions ? (
            <div className="p-6 text-center text-caption text-muted-foreground">
              {t("common.loading")}
            </div>
          ) : (
            <PermissionMatrix value={permissions} onChange={setPermissions} />
          )}
        </div>
      </div>
    </EnterpriseModal>
  );
}
