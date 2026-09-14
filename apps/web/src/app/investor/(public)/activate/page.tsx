"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { z } from "zod";
import { PasswordFormField, SubmitButton, useZodForm } from "@/components/shared/form-fields";
import { Form } from "@/components/ui/form";
import { EnterpriseButton } from "@/components/ui/button";
import { ApiError } from "@/services/api-client";
import { investorPortalAuthService } from "@/services/investor-portal-service";
import { useLocale } from "@/providers/locale-provider";

/** Serves BOTH first-time activation (invite link) and password reset (forgot-password link) — same single-use token mechanism on the backend. */
export default function InvestorPortalActivatePage() {
  return (
    <Suspense>
      <ActivateForm />
    </Suspense>
  );
}

function ActivateForm() {
  const { t } = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const schema = z.object({
    newPassword: z.string().min(8, t("investorPortal.auth.newPasswordRequired")),
  });

  const form = useZodForm(schema, { defaultValues: { newPassword: "" } });

  const onSubmit = form.handleSubmit(async (values) => {
    if (!token) return;
    setFormError(null);
    try {
      await investorPortalAuthService.activate(token, values.newPassword);
      setSuccess(true);
    } catch (error) {
      if (error instanceof ApiError) {
        setFormError(error.message);
        return;
      }
      setFormError(t("investorPortal.auth.genericError"));
    }
  });

  const isSubmitting = form.formState.isSubmitting;

  if (!token) {
    return (
      <div>
        <header className="mb-6">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            {t("investorPortal.auth.activateTitle")}
          </h1>
        </header>
        <div
          role="alert"
          className="rounded-sm border border-destructive/20 bg-destructive/10 px-3 py-2 text-caption text-destructive"
        >
          {t("investorPortal.auth.missingToken")}
        </div>
        <Link
          href="/investor/forgot-password"
          className="mt-6 block text-center text-caption font-medium text-brand-navy hover:underline dark:text-brand-teal"
        >
          {t("investorPortal.auth.backToLogin")}
        </Link>
      </div>
    );
  }

  if (success) {
    return (
      <div>
        <header className="mb-6">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            {t("investorPortal.auth.activateTitle")}
          </h1>
        </header>
        <div
          role="status"
          className="rounded-sm border border-success/20 bg-success-soft px-3 py-3 text-sm text-success"
        >
          {t("investorPortal.auth.activateSuccess")}
        </div>
        <EnterpriseButton
          className="mt-6 w-full from-brand-navy to-brand-navy text-brand-navy-foreground hover:brightness-110 dark:from-brand-navy dark:to-brand-navy"
          onClick={() => router.push("/investor/login")}
        >
          {t("investorPortal.auth.backToLogin")}
        </EnterpriseButton>
      </div>
    );
  }

  return (
    <div>
      <header className="mb-8">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {t("investorPortal.auth.activateTitle")}
        </h1>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          {t("investorPortal.auth.activateSubtitle")}
        </p>
      </header>

      <Form {...form}>
        <form onSubmit={onSubmit} aria-busy={isSubmitting} className="flex flex-col gap-4">
          <PasswordFormField
            control={form.control}
            name="newPassword"
            label={t("investorPortal.auth.newPassword")}
            placeholder={t("investorPortal.auth.newPasswordPlaceholder")}
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
            className="mt-1 w-full from-brand-navy to-brand-navy text-brand-navy-foreground hover:brightness-110 dark:from-brand-navy dark:to-brand-navy"
          >
            {isSubmitting
              ? t("investorPortal.auth.activateSubmitting")
              : t("investorPortal.auth.activateSubmit")}
          </SubmitButton>
        </form>
      </Form>
    </div>
  );
}
