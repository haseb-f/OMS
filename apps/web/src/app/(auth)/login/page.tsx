"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { z } from "zod";
import { Checkbox } from "@/components/ui/checkbox";
import { Form, FormField, FormItem, FormControl, FormLabel } from "@/components/ui/form";
import {
  TextFormField,
  PasswordFormField,
  SubmitButton,
  useZodForm,
} from "@/components/shared/form-fields";
import { ApiError } from "@/services/api-client";
import { useAuth } from "@/providers/auth-provider";
import { useLocale } from "@/providers/locale-provider";

/** `useSearchParams()` requires a Suspense boundary during static export — the actual form lives in `LoginForm` below. */
export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const { t } = useLocale();
  const { login } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [formError, setFormError] = useState<string | null>(null);

  const schema = z.object({
    email: z
      .string()
      .trim()
      .toLowerCase()
      .min(1, t("auth.emailRequired"))
      .email(t("auth.emailRequired")),
    password: z.string().min(1, t("auth.passwordRequired")),
    rememberMe: z.boolean(),
  });

  const form = useZodForm(schema, { defaultValues: { email: "", password: "", rememberMe: true } });

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await login(values.email, values.password, values.rememberMe);
      router.push(searchParams.get("next") ?? "/");
    } catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        setFormError(error.message);
        return;
      }
      setFormError(t("auth.genericError"));
    }
  });

  const isSubmitting = form.formState.isSubmitting;

  return (
    <div>
      <header className="mb-8">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {t("auth.loginTitle")}
        </h1>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          {t("auth.loginSubtitle")}
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
          <PasswordFormField
            control={form.control}
            name="password"
            label={t("auth.password")}
            placeholder={t("auth.passwordPlaceholder")}
            autoComplete="current-password"
          />

          <div className="flex items-center justify-between gap-3">
            <FormField
              control={form.control}
              name="rememberMe"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center gap-2 space-y-0">
                  <FormControl>
                    <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                  <FormLabel className="text-sm font-normal">{t("auth.rememberMe")}</FormLabel>
                </FormItem>
              )}
            />
            <Link
              href="/forgot-password"
              className="text-caption font-medium text-brand-navy hover:underline dark:text-brand-teal"
            >
              {t("auth.forgotPassword")}
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
            {isSubmitting ? t("auth.signingIn") : t("auth.signIn")}
          </SubmitButton>
        </form>
      </Form>
    </div>
  );
}
