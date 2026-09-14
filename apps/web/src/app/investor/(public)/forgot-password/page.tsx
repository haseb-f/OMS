"use client";

import { useState } from "react";
import Link from "next/link";
import { z } from "zod";
import { TextFormField, SubmitButton, useZodForm } from "@/components/shared/form-fields";
import { Form } from "@/components/ui/form";
import { investorPortalAuthService } from "@/services/investor-portal-service";
import { useLocale } from "@/providers/locale-provider";

export default function InvestorPortalForgotPasswordPage() {
  const { t } = useLocale();
  const [sent, setSent] = useState(false);

  const schema = z.object({
    email: z
      .string()
      .trim()
      .toLowerCase()
      .min(1, t("investorPortal.auth.emailRequired"))
      .email(t("investorPortal.auth.emailRequired")),
  });

  const form = useZodForm(schema, { defaultValues: { email: "" } });

  const onSubmit = form.handleSubmit(async (values) => {
    // Deliberately ignores the response shape beyond success — the backend
    // never reveals whether the email exists, and neither does this screen.
    await investorPortalAuthService.forgotPassword(values.email);
    setSent(true);
  });

  const isSubmitting = form.formState.isSubmitting;

  return (
    <div>
      <header className="mb-8">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {t("investorPortal.auth.forgotTitle")}
        </h1>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          {t("investorPortal.auth.forgotSubtitle")}
        </p>
      </header>

      {sent ? (
        <div
          role="status"
          className="rounded-sm border border-success/20 bg-success-soft px-3 py-3 text-sm text-success"
        >
          {t("investorPortal.auth.forgotSubtitle")}
        </div>
      ) : (
        <Form {...form}>
          <form onSubmit={onSubmit} aria-busy={isSubmitting} className="flex flex-col gap-4">
            <TextFormField
              control={form.control}
              name="email"
              label={t("investorPortal.auth.email")}
              type="email"
              placeholder={t("investorPortal.auth.emailPlaceholder")}
              autoComplete="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              dir="ltr"
            />
            <SubmitButton
              isSubmitting={isSubmitting}
              className="mt-1 w-full from-brand-navy to-brand-navy text-brand-navy-foreground hover:brightness-110 dark:from-brand-navy dark:to-brand-navy"
            >
              {isSubmitting
                ? t("investorPortal.auth.forgotSubmitting")
                : t("investorPortal.auth.forgotSubmit")}
            </SubmitButton>
          </form>
        </Form>
      )}

      <Link
        href="/investor/login"
        className="mt-6 block text-center text-caption font-medium text-brand-navy hover:underline dark:text-brand-teal"
      >
        {t("investorPortal.auth.backToLogin")}
      </Link>
    </div>
  );
}
