"use client";

import { useState } from "react";
import Link from "next/link";
import { z } from "zod";
import { MailCheck } from "lucide-react";
import { Form } from "@/components/ui/form";
import { TextFormField, SubmitButton, useZodForm } from "@/components/shared/form-fields";
import { EmptyState } from "@/components/shared/empty-state";
import { EnterpriseButton } from "@/components/ui/button";
import { authService } from "@/services/auth-service";
import { useLocale } from "@/providers/locale-provider";

export default function ForgotPasswordPage() {
  const { t } = useLocale();
  const [sent, setSent] = useState(false);

  const schema = z.object({
    email: z.string().min(1, t("auth.emailRequired")).email(t("auth.emailRequired")),
  });
  const form = useZodForm(schema, { defaultValues: { email: "" } });

  const onSubmit = form.handleSubmit(async (values) => {
    await authService.forgotPassword(values.email);
    setSent(true);
  });

  if (sent) {
    return (
      <EmptyState
        icon={MailCheck}
        title={t("auth.forgotSuccessTitle")}
        description={t("auth.forgotSuccessDescription")}
        action={
          <EnterpriseButton asChild size="sm" variant="outline">
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
          {t("auth.forgotTitle")}
        </h1>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          {t("auth.forgotSubtitle")}
        </p>
      </header>
      <Form {...form}>
        <form
          onSubmit={onSubmit}
          aria-busy={isSubmitting}
          className="oms-auth-form flex flex-col gap-4"
        >
          <TextFormField
            control={form.control}
            name="email"
            label={t("auth.email")}
            type="email"
            placeholder={t("auth.emailPlaceholder")}
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            dir="ltr"
          />
          <SubmitButton
            isSubmitting={isSubmitting}
            className="w-full from-brand-navy to-brand-navy text-brand-navy-foreground hover:brightness-110 dark:from-brand-navy dark:to-brand-navy"
          >
            {isSubmitting ? t("auth.sendingResetLink") : t("auth.sendResetLink")}
          </SubmitButton>
          <Link
            href="/login"
            className="text-center text-caption font-medium text-brand-navy hover:underline dark:text-brand-teal"
          >
            {t("auth.backToLogin")}
          </Link>
        </form>
      </Form>
    </div>
  );
}
