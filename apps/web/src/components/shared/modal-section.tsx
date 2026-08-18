"use client";

import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import {
  EnterpriseCard,
  EnterpriseCardContent,
  EnterpriseCardHeader,
  EnterpriseCardTitle,
} from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useLocale } from "@/providers/locale-provider";
import { cn } from "@/lib/utils";

/**
 * One logical group inside an `EnterpriseModal` form (General Information,
 * Contact Information, Financial Information, Notes, ...) — every field
 * grid inside an Enterprise Modal lives in one of these, never loose in the
 * modal body. `columns` controls the desktop grid (2 for `md`/`lg` modals,
 * 3 for `xl`) — always 1 column on mobile.
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
  columns?: 2 | 3;
  optional?: boolean;
  collapsible?: boolean;
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const { t } = useLocale();
  const body = (
    <EnterpriseCardContent>
      {description && <p className="mb-4 text-caption text-muted-foreground">{description}</p>}
      <div
        className={cn(
          "grid grid-cols-1 gap-x-4 gap-y-5",
          columns === 3 ? "md:grid-cols-2 xl:grid-cols-3" : "md:grid-cols-2",
        )}
      >
        {children}
      </div>
    </EnterpriseCardContent>
  );

  const heading = (
    <EnterpriseCardHeader className="flex flex-row items-center justify-between gap-2">
      <div className="flex min-w-0 items-baseline gap-2">
        <EnterpriseCardTitle>{title}</EnterpriseCardTitle>
        {optional && (
          <span className="text-caption font-normal text-muted-foreground">
            {t("common.optional")}
          </span>
        )}
      </div>
      {collapsible && (
        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-(--duration-base) ease-(--ease-standard) group-data-[state=closed]/section:rtl:rotate-180 group-data-[state=open]/section:rotate-90" />
      )}
    </EnterpriseCardHeader>
  );

  if (!collapsible) {
    return (
      <EnterpriseCard size="sm" className={cn("hover:translate-y-0 hover:shadow-sm", className)}>
        {heading}
        {body}
      </EnterpriseCard>
    );
  }

  return (
    <Collapsible defaultOpen={defaultOpen} className="group/section">
      <EnterpriseCard size="sm" className={cn("hover:translate-y-0 hover:shadow-sm", className)}>
        <CollapsibleTrigger className="w-full cursor-pointer text-start outline-none">
          {heading}
        </CollapsibleTrigger>
        <CollapsibleContent>{body}</CollapsibleContent>
      </EnterpriseCard>
    </Collapsible>
  );
}

/** Makes a field span every column in its section's grid — for a description/textarea/notes field. */
export function ModalFieldFullWidth({ children }: { children: ReactNode }) {
  return <div className="col-span-full">{children}</div>;
}
