"use client";

import type { ReactNode } from "react";
import { BrandLogo } from "@/components/brand/brand-logo";
import { useLocale } from "@/providers/locale-provider";

/**
 * Public auth shell — official brand panel + a soft, raised credential card.
 * Login, forgot-password, and reset-password all render as `children`.
 * R16 (spec-1): the card, the brand tagline and the comfortable auth controls
 * (`.oms-auth-*` recipes) — tokens only, no motion beyond focus transitions.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  const { t } = useLocale();
  return (
    <div className="oms-auth-shell flex min-h-svh bg-brand-canvas dark:bg-background">
      <aside className="relative hidden overflow-hidden bg-brand-navy md:flex md:w-[38%] md:shrink-0 md:flex-col md:justify-center lg:w-[46%]">
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-8 start-[-10%] h-[62%] w-[70%] bg-[url(/brand/oms-app-icon.png)] bg-contain bg-bottom bg-no-repeat opacity-[0.12]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_0%,color-mix(in_oklab,var(--brand-teal)_16%,transparent),transparent_58%)]"
        />
        <div className="relative z-10 flex flex-col items-center gap-6 px-10 py-16 text-center lg:px-16">
          <BrandLogo
            variant="horizontal-dark"
            priority
            sizes="(min-width: 1024px) 17.5rem, 32vw"
            className="w-full max-w-[17.5rem]"
          />
          <p className="max-w-[20rem] text-body leading-relaxed text-brand-navy-foreground/75">
            {t("auth.brandTagline")}
          </p>
        </div>
      </aside>

      <div className="flex min-h-svh min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-center bg-brand-navy px-6 pt-[max(1rem,env(safe-area-inset-top))] pb-4 md:hidden">
          <BrandLogo
            variant="horizontal-dark"
            priority
            sizes="14rem"
            className="h-9 w-auto max-w-[14rem]"
          />
        </div>

        <div className="flex flex-1 flex-col items-center justify-start px-4 pt-6 pb-8 sm:justify-center sm:px-8 sm:py-10">
          <div className="oms-auth-card w-full max-w-(--auth-card-width)">{children}</div>
        </div>
      </div>
    </div>
  );
}
