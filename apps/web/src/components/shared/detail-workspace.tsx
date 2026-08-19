"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import {
  EnterpriseCard,
  EnterpriseCardContent,
  EnterpriseCardHeader,
  EnterpriseCardTitle,
} from "@/components/ui/card";
import { useLocale } from "@/providers/locale-provider";
import { cn } from "@/lib/utils";

function hasDetailValue(value: ReactNode): boolean {
  if (value == null || value === false) return false;
  if (typeof value === "string" && (value.trim() === "" || value.trim() === "—")) return false;
  return true;
}

/**
 * RTL-first back control. The arrow uses logical rotation (`rtl:rotate-180`)
 * so it always points toward the previous page. Prefers in-app history so
 * list filters/pagination survive; falls back to `href` on a cold load.
 */
export function BackButton({ href, label }: { href?: string; label?: string }) {
  const router = useRouter();
  const { t } = useLocale();

  const handleClick = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }
    if (href) {
      router.push(href);
      return;
    }
    router.back();
  };

  return (
    <EnterpriseButton
      type="button"
      variant="ghost"
      size="sm"
      className="w-fit gap-1.5"
      onClick={handleClick}
    >
      <ArrowLeft className="size-4 rtl:rotate-180" />
      {label ?? t("common.back")}
    </EnterpriseButton>
  );
}

/**
 * Compact operational detail workspace — identity header + centered content.
 * Lists stay full-width via `PageWorkspace`; this is for entity/document
 * detail and edit screens only.
 */
export function DetailWorkspace({
  backHref,
  title,
  subtitle,
  status,
  actions,
  children,
  width = "default",
  className,
}: {
  backHref?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  /** `default` for party/order profiles; `wide` for document editors with line grids. */
  width?: "default" | "wide";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mx-auto flex w-full flex-col gap-2",
        width === "wide" ? "max-w-6xl" : "max-w-[1100px]",
        className,
      )}
    >
      <BackButton href={backHref} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div className="min-w-0">
            <h1 className="text-ui-title font-semibold tracking-tight">{title}</h1>
            {hasDetailValue(subtitle) ? (
              <p className="text-caption text-muted-foreground">{subtitle}</p>
            ) : null}
          </div>
          {status}
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">{actions}</div>
        ) : null}
      </div>
      {children}
    </div>
  );
}

/** Wide centered shell for document editors — Back + existing editor card. */
export function EditorWorkspace({
  backHref,
  children,
  className,
}: {
  backHref?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mx-auto flex w-full max-w-6xl flex-col gap-2", className)}>
      <BackButton href={backHref} />
      {children}
    </div>
  );
}

/** Compact card section. Omit `title` when the header already names the content. */
export function DetailSection({
  title,
  actions,
  children,
  className,
}: {
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <EnterpriseCard size="sm" className={className}>
      {title || actions ? (
        <EnterpriseCardHeader className="flex flex-row items-center justify-between gap-3">
          {title ? <EnterpriseCardTitle>{title}</EnterpriseCardTitle> : <span />}
          {actions}
        </EnterpriseCardHeader>
      ) : null}
      <EnterpriseCardContent className="flex flex-col gap-2.5">{children}</EnterpriseCardContent>
    </EnterpriseCard>
  );
}

/** Labeled field for detail screens (not table cells). Hidden when empty. */
export function DetailField({ label, value }: { label: string; value: ReactNode }) {
  if (!hasDetailValue(value)) return null;
  return (
    <div className="min-w-0">
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-body font-medium text-foreground">{value}</dd>
    </div>
  );
}

export function DetailFieldGrid({
  children,
  columns = 2,
}: {
  children: ReactNode;
  columns?: 2 | 3 | 4;
}) {
  return (
    <dl
      className={cn(
        "grid grid-cols-1 gap-x-6 gap-y-2.5 sm:grid-cols-2",
        columns === 3 && "lg:grid-cols-3",
        columns === 4 && "lg:grid-cols-4",
      )}
    >
      {children}
    </dl>
  );
}
