"use client";

import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useLocale } from "@/providers/locale-provider";
import { cn } from "@/lib/utils";

/**
 * Column count follows the SECTION's own width (container queries), not the
 * viewport — a 768px modal on a wide screen must not get 4 cramped columns.
 */
const columnClass: Record<2 | 3 | 4, string> = {
  2: "@md:grid-cols-2",
  3: "@md:grid-cols-2 @3xl:grid-cols-3",
  4: "@md:grid-cols-2 @2xl:grid-cols-3 @4xl:grid-cols-4",
};

/**
 * Compact section inside an `EnterpriseModal` or create workspace.
 * Default (`variant="section"`, design-system §11.3): a heading plus a
 * hairline divider from the previous section — never a bordered box inside
 * the dialog surface. `variant="card"` keeps the light bordered box for the
 * rare page that uses a section as its only surface (no enclosing card).
 */
export function ModalSection({
  title,
  description,
  columns = 2,
  optional = false,
  collapsible = false,
  defaultOpen = true,
  open,
  onOpenChange,
  children,
  className,
  variant = "section",
}: {
  title: string;
  description?: string;
  columns?: 2 | 3 | 4;
  optional?: boolean;
  collapsible?: boolean;
  defaultOpen?: boolean;
  /** Controlled open state (a form that must open a section holding an error); omit for the uncontrolled `defaultOpen`. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
  className?: string;
  variant?: "section" | "card";
}) {
  const { t } = useLocale();
  const boxed = variant === "card";
  const body = (
    <div className={cn(boxed && "px-3 pb-3")}>
      {description && <p className="mb-2 text-caption text-muted-foreground">{description}</p>}
      <div className={cn("grid grid-cols-1 gap-x-3 gap-y-3", columnClass[columns])}>{children}</div>
    </div>
  );

  const heading = (
    <div
      className={cn(
        "flex items-center justify-between gap-2",
        boxed ? "px-3 py-2" : "min-h-7 pb-2",
      )}
    >
      <div className="flex min-w-0 items-baseline gap-2">
        <h3 className="text-body font-semibold">{title}</h3>
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

  const shell = cn(
    "@container min-w-0",
    boxed
      ? "rounded-md border border-border bg-card"
      : // Consecutive sections separate themselves with a hairline; a
        // collapsible one sits in its own wrapper, so it always draws it.
        collapsible
        ? "border-t border-border pt-3"
        : "not-first-of-type:border-t not-first-of-type:border-border not-first-of-type:pt-3",
    className,
  );

  if (!collapsible) {
    return (
      <section className={shell}>
        {heading}
        {body}
      </section>
    );
  }

  return (
    <Collapsible
      {...(open === undefined ? { defaultOpen } : { open, onOpenChange })}
      className="group/section"
    >
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
        span === 2 && "@md:col-span-2",
        span === 3 && "@md:col-span-2 @3xl:col-span-3",
        className,
      )}
    >
      {children}
    </div>
  );
}
