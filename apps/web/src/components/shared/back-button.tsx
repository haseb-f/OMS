"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import { useLocale } from "@/providers/locale-provider";

function canUseInAppHistory(): boolean {
  if (typeof window === "undefined") return false;
  const state = window.history.state as { idx?: number } | null;
  if (typeof state?.idx === "number") {
    return state.idx > 0;
  }
  try {
    if (!document.referrer) return false;
    const referrer = new URL(document.referrer);
    if (referrer.origin !== window.location.origin) return false;
    if (
      referrer.pathname.startsWith("/login") ||
      referrer.pathname.startsWith("/forgot-password") ||
      referrer.pathname.startsWith("/reset-password")
    ) {
      return false;
    }
    return referrer.pathname !== window.location.pathname;
  } catch {
    return false;
  }
}

/**
 * The one Back control for OMS detail/editor/nested screens.
 * Prefers in-app history so list filters and pagination survive; falls back
 * to the logical parent route. Never sends the user to the dashboard unless
 * that parent is the dashboard.
 */
export function BackButton({ href, label }: { href?: string; label?: string }) {
  const router = useRouter();
  const { t } = useLocale();
  const text = label ?? t("common.back");

  const handleClick = () => {
    if (canUseInAppHistory()) {
      router.back();
      return;
    }
    if (href && href !== window.location.pathname) {
      router.push(href);
    }
  };

  return (
    <EnterpriseButton
      type="button"
      variant="ghost"
      size="sm"
      className="w-fit shrink-0 gap-1.5"
      onClick={handleClick}
      aria-label={text}
    >
      <ArrowLeft className="size-4 rtl:rotate-180" />
      {text}
    </EnterpriseButton>
  );
}
