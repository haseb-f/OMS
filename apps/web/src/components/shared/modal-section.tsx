"use client";

import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useLocale } from "@/providers/locale-provider";
import { cn } from "@/lib/utils";

const columnClass: Record<2 | 3 | 4, string> = {
  2: "md:grid-cols-2",
  3: "md:grid-cols-2 xl:grid-cols-3",
  4: "md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4",
};

/**
 * Compact section inside an `EnterpriseModal` or create workspace.
 * Groups fields with a light border — never a nested EnterpriseCard.
 */
export function ModalSection({
  title,
  description,
  columns = 2,
  optional = false,
  collapsible = false,
  defaultOpen = true,
  children,
  className,
}: {
  title: string;
  description?: string;
  columns?: 2 | 3 | 4;
  optional?: boolean;
  collapsible?: boolean;
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const { t } = useLocale();
  const body = (
    <div className="px-3 pb-3">
      {description && <p className="mb-2 text-caption text-muted-foreground">{description}</p>}
      <div className={cn("grid grid-cols-1 gap-x-3 gap-y-3", columnClass[columns])}>{children}</div>
    </div>
  );

  const heading = (
    <div className="flex items-center justify-between gap-2 px-3 py-2">
      <div className="flex min-w-0 items-baseline gap-2">
        <h3 className="text-body font-semibold leading-snug">{title}</h3>
        {optional && (
          <span className="text-caption font-normal text-muted-foreground">
            {t("common.optional")}
          </span>
        )}
      </div>
      {collapsible && (
        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-(--duration-base) ease-(--ease-standard) group-data-[state=closed]/section:rtl:rotate-180 group-data-[state=open]/section:rotate-90" />
      )}
    </div>
  );

  const shell = cn("rounded-md border border-border bg-card", className);

  if (!collapsible) {
    return (
      <section className={shell}>
        {heading}
        {body}
      </section>
    );
  }

  return (
    <Collapsible defaultOpen={defaultOpen} className="group/section">
      <section className={shell}>
        <CollapsibleTrigger className="w-full cursor-pointer text-start outline-none">
          {heading}
        </CollapsibleTrigger>
        <CollapsibleContent>{body}</CollapsibleContent>
      </section>
    </Collapsible>
  );
}

/** Makes a field span every column in its section's grid — for address/notes. */
export function ModalFieldFullWidth({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("col-span-full", className)}>{children}</div>;
}

/** Span 2–3 columns on desktop without forcing full width. */
export function ModalFieldSpan({
  span = 1,
  children,
  className,
}: {
  span?: 1 | 2 | 3 | "full";
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        span === "full" && "col-span-full",
        span === 2 && "md:col-span-2",
        span === 3 && "md:col-span-2 xl:col-span-3",
        className,
      )}
    >
      {children}
    </div>
  );
}
