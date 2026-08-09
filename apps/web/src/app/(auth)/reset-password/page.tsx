"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { z } from "zod";
import { CheckCircle2, KeyRound } from "lucide-react";
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
      <EnterpriseCard>
        <EnterpriseCardContent>
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
        </EnterpriseCardContent>
      </EnterpriseCard>
    );
  }

  if (done) {
    return (
      <EnterpriseCard>
        <EnterpriseCardContent>
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
        </EnterpriseCardContent>
      </EnterpriseCard>
    );
  }

  return (
    <EnterpriseCard>
      <EnterpriseCardHeader>
        <EnterpriseCardTitle>{t("auth.resetTitle")}</EnterpriseCardTitle>
        <EnterpriseCardDescription>{t("auth.resetSubtitle")}</EnterpriseCardDescription>
      </EnterpriseCardHeader>
      <EnterpriseCardContent>
        <Form {...form}>
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <TextFormField
              control={form.control}
              name="newPassword"
              label={t("auth.newPassword")}
              type="password"
              autoComplete="new-password"
            />
            <TextFormField
              control={form.control}
              name="confirmPassword"
              label={t("auth.confirmPassword")}
              type="password"
              autoComplete="new-password"
            />
            {formError && (
              <div
                role="alert"
                className="rounded-lg border border-destructive/20 bg-destructive/10 px-3.5 py-2.5 text-caption text-destructive"
              >
                {formError}
              </div>
            )}
            <SubmitButton isSubmitting={form.formState.isSubmitting} className="w-full">
              {form.formState.isSubmitting ? t("auth.resetSubmitting") : t("auth.resetSubmit")}
            </SubmitButton>
          </form>
        </Form>
      </EnterpriseCardContent>
    </EnterpriseCard>
  );
}
