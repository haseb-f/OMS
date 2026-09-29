"use client";

import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps } from "sonner";
import {
  CircleCheckIcon,
  InfoIcon,
  TriangleAlertIcon,
  OctagonXIcon,
  Loader2Icon,
} from "lucide-react";
import { useLocale } from "@/providers/locale-provider";
import { useIsMobile } from "@/hooks/use-mobile";

/** Offsets come from tokens (`--toast-offset-*`, theme/tokens.css). */
const OFFSET: ToasterProps["offset"] = {
  top: "var(--toast-offset-top)",
  right: "var(--toast-offset-inline)",
  left: "var(--toast-offset-inline)",
};
const MOBILE_OFFSET: ToasterProps["mobileOffset"] = {
  top: "var(--toast-offset-top)",
  right: "calc(var(--shell-gutter) / 2)",
  left: "calc(var(--shell-gutter) / 2)",
};

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();
  const { direction, t } = useLocale();
  // Toasts SUPPLEMENT on-page feedback (inline errors, form summary, header
  // status) — they never replace it. Top of the viewport, just BELOW the 48px
  // top bar (never over search / notifications / account) and away from the
  // bottom action bars and sticky modal footers: logical END corner on
  // desktop (top-left in RTL, top-right in LTR); on phones centered and
  // full-width with the notch safe area (usability-financial-reports §5).
  const isMobile = useIsMobile();
  const position: ToasterProps["position"] = isMobile
    ? "top-center"
    : direction === "rtl"
      ? "top-left"
      : "top-right";

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      dir={direction}
      position={position}
      offset={OFFSET}
      mobileOffset={MOBILE_OFFSET}
      containerAriaLabel={t("toast.region")}
      icons={{
        success: <CircleCheckIcon className="size-5" aria-hidden />,
        info: <InfoIcon className="size-5" aria-hidden />,
        warning: <TriangleAlertIcon className="size-5" aria-hidden />,
        error: <OctagonXIcon className="size-5" aria-hidden />,
        loading: (
          <Loader2Icon className="size-5 animate-spin motion-reduce:animate-none" aria-hidden />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius-md)",
          "--width": "var(--toast-width)",
        } as React.CSSProperties
      }
      toastOptions={{
        closeButtonAriaLabel: t("toast.close"),
        classNames: {
          toast: "cn-toast",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
