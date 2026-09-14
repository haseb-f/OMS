import { ChevronLeft, ChevronRight } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import { useLocale } from "@/providers/locale-provider";

/**
 * Simple server-side pager for the Portal's read-only lists — deliberately
 * NOT `EnterprisePagination` (that component is coupled to a TanStack
 * `Table` instance for the Admin data-grid pattern; the Portal's lists are
 * plain paginated arrays from the API, so a lightweight prev/next control is
 * the right-sized tool here, not a bespoke rebuild of the shared Button).
 */
export function PortalPager({
  page,
  pageSize,
  total,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const { t } = useLocale();
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  if (pageCount <= 1) return null;

  return (
    <div className="flex items-center justify-center gap-3 pt-2">
      <EnterpriseButton
        variant="outline"
        size="sm"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        <ChevronRight className="rtl:hidden" />
        <ChevronLeft className="hidden rtl:block" />
        {t("investorPortal.common.previous")}
      </EnterpriseButton>
      <span className="text-caption text-muted-foreground">
        {t("investorPortal.common.page", { page, pageCount })}
      </span>
      <EnterpriseButton
        variant="outline"
        size="sm"
        disabled={page >= pageCount}
        onClick={() => onPageChange(page + 1)}
      >
        {t("investorPortal.common.next")}
        <ChevronLeft className="rtl:hidden" />
        <ChevronRight className="hidden rtl:block" />
      </EnterpriseButton>
    </div>
  );
}
