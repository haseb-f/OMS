import type { ReactNode } from "react";
import { LogoMark } from "@/assets/logo-mark";
import { siteConfig } from "@/config/site";

/** Public shell for auth screens — no Sidebar/Topbar, just a centered card on a plain background. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-8 bg-background px-4 py-12">
      <div className="flex items-center gap-2">
        <LogoMark className="size-8 text-primary" />
        <span className="text-section-title font-semibold tracking-tight">{siteConfig.name}</span>
      </div>
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
