import type { ComponentProps } from "react";

import { EnterpriseButton } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function Pagination({ className, ...props }: ComponentProps<"nav">) {
  return (
    <nav
      role="navigation"
      aria-label="pagination"
      data-slot="pagination"
      className={cn("mx-auto flex w-full justify-center", className)}
      {...props}
    />
  );
}

function PaginationContent({ className, ...props }: ComponentProps<"ul">) {
  return (
    <ul
      data-slot="pagination-content"
      className={cn("flex items-center gap-0.5", className)}
      {...props}
    />
  );
}

function PaginationItem({ ...props }: ComponentProps<"li">) {
  return <li data-slot="pagination-item" {...props} />;
}

function PaginationLink({
  className,
  isActive,
  size = "icon-sm",
  ...props
}: ComponentProps<typeof EnterpriseButton> & { isActive?: boolean }) {
  return (
    <EnterpriseButton
      data-slot="pagination-link"
      data-active={isActive}
      aria-current={isActive ? "page" : undefined}
      variant={isActive ? "outline" : "ghost"}
      size={size}
      className={className}
      {...props}
    />
  );
}

export { Pagination, PaginationContent, PaginationItem, PaginationLink };
