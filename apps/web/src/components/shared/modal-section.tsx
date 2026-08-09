import type { ReactNode } from "react";
import {
  EnterpriseCard,
  EnterpriseCardContent,
  EnterpriseCardHeader,
  EnterpriseCardTitle,
} from "@/components/ui/card";
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
  columns = 2,
  children,
  className,
}: {
  title: string;
  columns?: 2 | 3;
  children: ReactNode;
  className?: string;
}) {
  return (
    <EnterpriseCard size="sm" className={cn("hover:translate-y-0 hover:shadow-sm", className)}>
      <EnterpriseCardHeader>
        <EnterpriseCardTitle>{title}</EnterpriseCardTitle>
      </EnterpriseCardHeader>
      <EnterpriseCardContent>
        <div
          className={cn(
            "grid grid-cols-1 gap-x-4 gap-y-5",
            columns === 3 ? "md:grid-cols-2 xl:grid-cols-3" : "md:grid-cols-2",
          )}
        >
          {children}
        </div>
      </EnterpriseCardContent>
    </EnterpriseCard>
  );
}

/** Makes a field span every column in its section's grid — for a description/textarea/notes field. */
export function ModalFieldFullWidth({ children }: { children: ReactNode }) {
  return <div className="col-span-full">{children}</div>;
}
