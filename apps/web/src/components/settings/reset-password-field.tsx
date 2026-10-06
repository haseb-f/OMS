"use client";

import { useId } from "react";
import { PasswordInput } from "@/components/shared/password-input";
import { PASSWORD_POLICY } from "@/lib/password-generator";
import { useLocale } from "@/providers/locale-provider";

/** Whether an admin-reset password value may be submitted: empty (server generates) or within the policy. */
export function isResetPasswordAcceptable(value: string): boolean {
  return (
    value.length === 0 ||
    (value.length >= PASSWORD_POLICY.minLength && value.length <= PASSWORD_POLICY.maxLength)
  );
}

/**
 * The optional "New password" of an authorized admin reset (R13 A2) — the
 * `extra` of the reset confirmation in Settings → Users, the agent Team tab and
 * the agent portal Team page. Generate / Regenerate, reveal and copy come from
 * the shared `PasswordInput`; empty keeps the existing behaviour (the server
 * generates a temporary password, shown once afterwards).
 */
export function ResetPasswordField({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const { t } = useLocale();
  const id = useId();
  const range = { min: PASSWORD_POLICY.minLength, max: PASSWORD_POLICY.maxLength };
  const invalid = !isResetPasswordAcceptable(value);
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-caption text-muted-foreground">
        {t("controls.password.newPassword")}
      </label>
      <PasswordInput
        id={id}
        inputSize="sm"
        autoComplete="new-password"
        generatable
        disabled={disabled}
        maxLength={PASSWORD_POLICY.maxLength}
        value={value}
        aria-invalid={invalid || undefined}
        aria-describedby={`${id}-hint`}
        onChange={(event) => onChange(event.target.value)}
      />
      <p
        id={`${id}-hint`}
        className={invalid ? "text-caption text-destructive" : "text-caption text-muted-foreground"}
      >
        {invalid ? t("controls.password.tooShort", range) : t("controls.password.resetHint", range)}
      </p>
    </div>
  );
}
