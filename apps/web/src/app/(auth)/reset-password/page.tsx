"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { z } from "zod";
import { CheckCircle2, KeyRound } from "lucide-react";
import { Form } from "@/components/ui/form";
import { PasswordFormField, SubmitButton, useZodForm } from "@/components/shared/form-fields";
import { EmptyState } from "@/components/shared/empty-state";
import { EnterpriseButton } from "@/components/ui/button";
import { authService } from "@/services/auth-service";
import { useLocale } from "@/providers/locale-provider";

/** `useSearchParams()` requires a Suspense boundary during static export — the actual form lives in `ResetPasswordForm` below. */
export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}

function ResetPasswordForm() {
  const { t } = useLocale();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const schema = z
    .object({
      newPassword: z.string().min(8, t("auth.passwordMinLength")),
      confirmPassword: z.string().min(1, t("auth.passwordRequired")),
    })
    .refine((values) => values.newPassword === values.confirmPassword, {
      message: t("auth.passwordsDontMatch"),
      path: ["confirmPassword"],
    });

  const form = useZodForm(schema, {
    defaultValues: { newPassword: "", confirmPassword: "" },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    if (!token) return;
    setFormError(null);
    try {
      await authService.resetPassword(token, values.newPassword);
      setDone(true);
    } catch {
      setFormError(t("auth.resetInvalidToken"));
    }
  });

  if (!token) {
    return (
      <EmptyState
        icon={KeyRound}
        title={t("auth.resetInvalidToken")}
        description={t("auth.missingToken")}
        action={
          <EnterpriseButton asChild size="sm" variant="outline">
            <Link href="/forgot-password">{t("auth.requestNewLink")}</Link>
          </EnterpriseButton>
        }
      />
    );
  }

  if (done) {
    return (
      <EmptyState
        icon={CheckCircle2}
        title={t("auth.resetSuccessTitle")}
        description={t("auth.resetSuccessDescription")}
        action={
          <EnterpriseButton asChild size="sm">
            <Link href="/login">{t("auth.backToLogin")}</Link>
          </EnterpriseButton>
        }
      />
    );
  }

  const isSubmitting = form.formState.isSubmitting;

  return (
    <div>
      <header className="mb-8">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {t("auth.resetTitle")}
        </h1>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          {t("auth.resetSubtitle")}
        </p>
      </header>
      <Form {...form}>
        <form
          onSubmit={onSubmit}
          aria-busy={isSubmitting}
          className="oms-auth-form flex flex-col gap-4"
        >
          <PasswordFormField
            control={form.control}
            name="newPassword"
            label={t("auth.newPassword")}
            autoComplete="new-password"
          />
          <PasswordFormField
            control={form.control}
            name="confirmPassword"
            label={t("auth.confirmPassword")}
            autoComplete="new-password"
          />
          {formError && (
            <div
              role="alert"
              className="rounded-sm border border-destructive/20 bg-destructive/10 px-3 py-2 text-caption text-destructive"
            >
              {formError}
            </div>
          )}
          <SubmitButton
            isSubmitting={isSubmitting}
            className="w-full from-brand-navy to-brand-navy text-brand-navy-foreground hover:brightness-110 dark:from-brand-navy dark:to-brand-navy"
          >
            {isSubmitting ? t("auth.resetSubmitting") : t("auth.resetSubmit")}
          </SubmitButton>
        </form>
      </Form>
    </div>
  );
}
