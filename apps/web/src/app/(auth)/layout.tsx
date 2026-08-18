import type { ReactNode } from "react";
import { BrandLogo } from "@/components/brand/brand-logo";

/**
 * Public auth shell — official brand panel + focused credential column.
 * Login, forgot-password, and reset-password all render as `children`.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh bg-brand-canvas dark:bg-background">
      <aside className="relative hidden overflow-hidden bg-brand-navy md:flex md:w-[38%] md:shrink-0 md:flex-col md:justify-center lg:w-[46%]">
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-8 start-[-10%] h-[62%] w-[70%] bg-[url(/brand/oms-app-icon.png)] bg-contain bg-bottom bg-no-repeat opacity-[0.12]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_0%,color-mix(in_oklab,var(--brand-teal)_16%,transparent),transparent_58%)]"
        />
        <div className="relative z-10 flex justify-center px-10 py-16 lg:px-16">
          <BrandLogo
            variant="horizontal-dark"
            priority
            sizes="(min-width: 1024px) 17.5rem, 32vw"
            className="w-full max-w-[17.5rem]"
          />
        </div>
      </aside>

      <div className="flex min-h-svh flex-1 flex-col">
        <div className="flex items-center justify-center bg-brand-navy px-6 py-5 md:hidden">
          <BrandLogo
            variant="horizontal-dark"
            priority
            sizes="16rem"
            className="h-10 w-auto max-w-[16rem]"
          />
        </div>

        <div className="flex flex-1 flex-col items-center justify-center px-5 py-8 sm:px-8">
          <div className="w-full max-w-[22.5rem]">{children}</div>
        </div>
      </div>
    </div>
  );
}
