"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { IconActionButton } from "@/components/shared/icon-action-button";
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
 *
 * Icon-only: the arrow alone reads as "back" in a control this common, so it
 * drops the label from view but keeps it as the accessible name (aria-label)
 * and the hover/focus tooltip. Tinted with `primary-soft`/`primary` — the
 * same soft-accent pairing the active sidebar nav item uses — rather than
 * plain `ghost`, so a navigation control is recognizable at rest, not only
 * on hover. `ArrowLeft` + `rtl:rotate-180` points at the reading start in
 * both directions (left in LTR, right in RTL), never a fixed literal arrow.
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
    <IconActionButton
      label={text}
      variant="ghost"
      className="shrink-0 border border-primary/20 bg-primary-soft text-primary hover:border-primary/35 hover:bg-primary/15 hover:text-primary active:bg-primary/20"
      onClick={handleClick}
    >
      <ArrowLeft className="size-4 rtl:rotate-180" />
    </IconActionButton>
  );
}
