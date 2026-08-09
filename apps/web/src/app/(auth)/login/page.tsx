"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { z } from "zod";
import {
  EnterpriseCard,
  EnterpriseCardContent,
  EnterpriseCardHeader,
  EnterpriseCardTitle,
  EnterpriseCardDescription,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Form, FormField, FormItem, FormControl, FormLabel } from "@/components/ui/form";
import { TextFormField, SubmitButton, useZodForm } from "@/components/shared/form-fields";
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
    email: z.string().min(1, t("auth.emailRequired")).email(t("auth.emailRequired")),
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
      setFormError(
        error instanceof ApiError && error.status === 401
          ? t("auth.invalidCredentials")
          : t("auth.genericError"),
      );
    }
  });

  return (
    <EnterpriseCard>
      <EnterpriseCardHeader>
        <EnterpriseCardTitle>{t("auth.loginTitle")}</EnterpriseCardTitle>
        <EnterpriseCardDescription>{t("auth.loginSubtitle")}</EnterpriseCardDescription>
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
            <TextFormField
              control={form.control}
              name="password"
              label={t("auth.password")}
              type="password"
              placeholder={t("auth.passwordPlaceholder")}
              autoComplete="current-password"
            />

            <div className="flex items-center justify-between">
              <FormField
                control={form.control}
                name="rememberMe"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center gap-2 space-y-0">
                    <FormControl>
                      <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                    <FormLabel className="font-normal">{t("auth.rememberMe")}</FormLabel>
                  </FormItem>
                )}
              />
              <Link
                href="/forgot-password"
                className="text-caption font-medium text-primary hover:underline"
              >
                {t("auth.forgotPassword")}
              </Link>
            </div>

            {formError && (
              <div
                role="alert"
                className="rounded-lg border border-destructive/20 bg-destructive/10 px-3.5 py-2.5 text-caption text-destructive"
              >
                {formError}
              </div>
            )}

            <SubmitButton isSubmitting={form.formState.isSubmitting} className="w-full">
              {form.formState.isSubmitting ? t("auth.signingIn") : t("auth.signIn")}
            </SubmitButton>
          </form>
        </Form>
      </EnterpriseCardContent>
    </EnterpriseCard>
  );
}
