"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { z } from "zod";
import {
  TextFormField,
  PasswordFormField,
  SubmitButton,
  useZodForm,
} from "@/components/shared/form-fields";
import { Form } from "@/components/ui/form";
import { ApiError } from "@/services/api-client";
import { useInvestorPortalAuth } from "@/providers/investor-portal-auth-provider";
import { useLocale } from "@/providers/locale-provider";

/** `useSearchParams()` requires a Suspense boundary during static export — the actual form lives in `LoginForm` below. */
export default function InvestorPortalLoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const { t } = useLocale();
  const { login } = useInvestorPortalAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [formError, setFormError] = useState<string | null>(null);

  const schema = z.object({
    email: z
      .string()
      .trim()
      .toLowerCase()
      .min(1, t("investorPortal.auth.emailRequired"))
      .email(t("investorPortal.auth.emailRequired")),
    password: z.string().min(1, t("investorPortal.auth.passwordRequired")),
  });

  const form = useZodForm(schema, { defaultValues: { email: "", password: "" } });

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await login(values.email, values.password);
      router.push(searchParams.get("next") ?? "/investor/dashboard");
    } catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        setFormError(error.message);
        return;
      }
      setFormError(t("investorPortal.auth.genericError"));
    }
  });

  const isSubmitting = form.formState.isSubmitting;

  return (
    <div>
      <header className="mb-8">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {t("investorPortal.auth.loginTitle")}
        </h1>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          {t("investorPortal.auth.loginSubtitle")}
        </p>
      </header>

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
          <PasswordFormField
            control={form.control}
            name="password"
            label={t("investorPortal.auth.password")}
            placeholder={t("investorPortal.auth.passwordPlaceholder")}
            autoComplete="current-password"
          />

          <div className="flex items-center justify-end">
            <Link
              href="/investor/forgot-password"
              className="text-caption font-medium text-brand-navy hover:underline dark:text-brand-teal"
            >
              {t("investorPortal.auth.forgotPassword")}
            </Link>
          </div>

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
            {isSubmitting ? t("investorPortal.auth.signingIn") : t("investorPortal.auth.signIn")}
          </SubmitButton>
        </form>
      </Form>
    </div>
  );
}
