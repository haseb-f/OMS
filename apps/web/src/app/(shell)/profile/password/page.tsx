"use client";

import { useId, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { KeyRound } from "lucide-react";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { EnterpriseCard, EnterpriseCardContent } from "@/components/ui/card";
import { FormCardField, FormCardStack } from "@/components/shared/form-card/form-card";
import { SubmitButton } from "@/components/shared/form-fields";
import { Input } from "@/components/ui/input";
import { FieldHint, FieldMessage } from "@/components/ui/form";
import { validateChangePassword, type ChangePasswordError } from "@/config/account/change-password";
import { AGENT_PORTAL_HOME } from "@/navigation/route-access";
import { authService } from "@/services/auth-service";
import { useAuth } from "@/providers/auth-provider";
import { useLocale } from "@/providers/locale-provider";
import { reportApiError, reportSuccess } from "@/lib/toast";

type FieldName = "currentPassword" | "newPassword" | "confirmPassword";

/**
 * Own password change — one shared page for internal and agent users
 * (`/profile` is a shared route). While `mustChangePassword` is set the shell
 * guard keeps the user here; after success the session is refreshed and the
 * user continues to their home (agent portal or the `next` page).
 */
export default function ChangePasswordPage() {
  const { t } = useLocale();
  const router = useRouter();
  const params = useSearchParams();
  const fieldId = useId();
  const { user, refreshUser } = useAuth();
  const forced = !!user?.mustChangePassword;
  const [values, setValues] = useState<Record<FieldName, string>>({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [showErrors, setShowErrors] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const errors = validateChangePassword(values);
  const errorText = (field: FieldName) => {
    const error: ChangePasswordError | undefined = showErrors ? errors[field] : undefined;
    return error ? t(`account.changePassword.errors.${error}`) : null;
  };

  const submit = async () => {
    setShowErrors(true);
    if (Object.keys(errors).length > 0 || isSaving) return;
    setIsSaving(true);
    try {
      await authService.changePassword(values.currentPassword, values.newPassword);
      reportSuccess(t("account.changePassword.success"));
      await refreshUser();
      const next = params.get("next");
      const home = user?.userType === "AGENT" ? AGENT_PORTAL_HOME : "/";
      router.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : home);
    } catch (error) {
      reportApiError(error, "account.changePassword.failed");
      setIsSaving(false);
    }
  };

  const field = (
    name: FieldName,
    labelKey: "currentPassword" | "newPassword" | "confirmPassword",
  ) => (
    <FormCardField
      required
      label={t(`account.changePassword.${labelKey}`)}
      htmlFor={`${fieldId}-${name}`}
      message={
        errorText(name) ? (
          <FieldMessage announce={false}>{errorText(name)}</FieldMessage>
        ) : name === "newPassword" ? (
          <FieldHint>{t("account.changePassword.hint")}</FieldHint>
        ) : null
      }
    >
      <Input
        id={`${fieldId}-${name}`}
        type="password"
        dir="ltr"
        autoComplete={name === "currentPassword" ? "current-password" : "new-password"}
        value={values[name]}
        aria-invalid={Boolean(errorText(name)) || undefined}
        onChange={(event) => setValues((prev) => ({ ...prev, [name]: event.target.value }))}
      />
    </FormCardField>
  );

  return (
    <PageWorkspace
      title={t(forced ? "account.changePassword.forcedTitle" : "account.changePassword.title")}
      description={t(
        forced ? "account.changePassword.forcedDescription" : "account.changePassword.description",
      )}
    >
      <EnterpriseCard size="sm" className="w-full max-w-md">
        <EnterpriseCardContent>
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <FormCardStack>
              {field("currentPassword", "currentPassword")}
              {field("newPassword", "newPassword")}
              {field("confirmPassword", "confirmPassword")}
            </FormCardStack>
            <div>
              <SubmitButton type="submit" isSubmitting={isSaving}>
                <KeyRound />
                {t("account.changePassword.submit")}
              </SubmitButton>
            </div>
          </form>
        </EnterpriseCardContent>
      </EnterpriseCard>
    </PageWorkspace>
  );
}
