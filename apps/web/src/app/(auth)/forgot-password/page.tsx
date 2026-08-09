"use client";

import { useState } from "react";
import Link from "next/link";
import { z } from "zod";
import { MailCheck } from "lucide-react";
import {
  EnterpriseCard,
  EnterpriseCardContent,
  EnterpriseCardHeader,
  EnterpriseCardTitle,
  EnterpriseCardDescription,
} from "@/components/ui/card";
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
      <EnterpriseCard>
        <EnterpriseCardContent>
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
        </EnterpriseCardContent>
      </EnterpriseCard>
    );
  }

  return (
    <EnterpriseCard>
      <EnterpriseCardHeader>
        <EnterpriseCardTitle>{t("auth.forgotTitle")}</EnterpriseCardTitle>
        <EnterpriseCardDescription>{t("auth.forgotSubtitle")}</EnterpriseCardDescription>
      </EnterpriseCardHeader>
      <EnterpriseCardContent>
        <Form {...form}>
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <TextFormField
              control={form.control}
              name="email"
              label={t("auth.email")}
              type="email"
              placeholder={t("auth.emailPlaceholder")}
              autoComplete="email"
            />
            <SubmitButton isSubmitting={form.formState.isSubmitting} className="w-full">
              {form.formState.isSubmitting ? t("auth.sendingResetLink") : t("auth.sendResetLink")}
            </SubmitButton>
            <Link
              href="/login"
              className="text-center text-caption font-medium text-primary hover:underline"
            >
              {t("auth.backToLogin")}
            </Link>
          </form>
        </Form>
      </EnterpriseCardContent>
    </EnterpriseCard>
  );
}
