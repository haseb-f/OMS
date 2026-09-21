"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Package } from "lucide-react";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { SearchInput } from "@/components/shared/search-input";
import { EnterpriseButton } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useProductCategories } from "@/hooks/use-reference-data";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { cachedLookup } from "@/lib/lookup-cache";
import { formatMoney } from "@/lib/money";
import { useLocale } from "@/providers/locale-provider";
import { productsService, type ProductRow } from "@/services/products-service";

const PAGE_SIZE = 20;

/**
 * Expanded product picker for document lines: server-side search, category
 * filter and pagination (never the whole catalog), with multi-select so a
 * user adds many lines in one pass. Selection survives paging/searching.
 */
export function ProductBrowserDialog({
  open,
  onOpenChange,
  mode,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "sales" | "purchase";
  onAdd: (products: ProductRow[]) => void;
}) {
  const { t } = useLocale();
  const categories = useProductCategories();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search);
  const [categoryId, setCategoryId] = useState<string>("");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<ProductRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<Map<string, ProductRow>>(new Map());

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPage(1);
  }, [debouncedSearch, categoryId]);

  useEffect(() => {
    if (!open) return;
    const params = {
      search: debouncedSearch || undefined,
      categoryId: categoryId || undefined,
      page,
      pageSize: PAGE_SIZE,
      sortBy: "displayName",
      sortOrder: "asc" as const,
      ...(mode === "purchase" ? { isPurchasable: true } : { isSellable: true }),
    };
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setFailed(false);
    cachedLookup(`products:${JSON.stringify(params)}`, () => productsService.catalog(params))
      .then((result) => {
        if (cancelled) return;
        setItems(result.items);
        setTotal(result.total);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, debouncedSearch, categoryId, page, mode]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const selectedList = useMemo(() => [...selected.values()], [selected]);

  const toggle = (product: ProductRow) => {
    setSelected((previous) => {
      const next = new Map(previous);
      if (next.has(product.id)) next.delete(product.id);
      else next.set(product.id, product);
      return next;
    });
  };

  const close = () => {
    setSelected(new Map());
    setSearch("");
    onOpenChange(false);
  };

  return (
    <EnterpriseModal
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      size="lg"
      icon={Package}
      title={t("docFlow.products.browseTitle")}
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <span className="text-caption text-muted-foreground">
            {t("docFlow.products.selectedCount", { count: selectedList.length })}
          </span>
          <div className="flex gap-2">
            <EnterpriseButton type="button" variant="outline" size="sm" onClick={close}>
              {t("common.cancel")}
            </EnterpriseButton>
            <EnterpriseButton
              type="button"
              size="sm"
              disabled={selectedList.length === 0}
              onClick={() => {
                onAdd(selectedList);
                close();
              }}
            >
              {t("docFlow.products.addSelected", { count: selectedList.length })}
            </EnterpriseButton>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <SearchInput
            value={search}
            onValueChange={setSearch}
            isLoading={loading}
            placeholder={t("sales.editor.grid.productSearchPlaceholder")}
            className="sm:flex-1"
          />
          <Select
            value={categoryId || "__all__"}
            onValueChange={(value) => setCategoryId(value === "__all__" ? "" : value)}
          >
            <SelectTrigger size="sm" className="w-full sm:w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">{t("docFlow.products.allCategories")}</SelectItem>
              {categories.map((category) => (
                <SelectItem key={category.id} value={category.id}>
                  {category.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="min-h-64 rounded-xs border border-border">
          {loading ? (
            <div className="flex flex-col gap-1 p-2">
              {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} className="h-10 w-full" />
              ))}
            </div>
          ) : failed ? (
            <p className="p-4 text-caption text-destructive">
              {t("sales.editor.grid.productsLoadError")}
            </p>
          ) : items.length === 0 ? (
            <p className="p-4 text-caption text-muted-foreground">
              {debouncedSearch
                ? t("sales.editor.grid.noMatchingProducts")
                : t("sales.editor.grid.noActiveProducts")}
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {items.map((product) => {
                const price = mode === "purchase" ? product.purchasePrice : product.salesPrice;
                const checked = selected.has(product.id);
                return (
                  <li key={product.id}>
                    <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 hover:bg-muted/50">
                      <Checkbox checked={checked} onCheckedChange={() => toggle(product)} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-body">
                          {product.displayName || product.name}
                        </span>
                        <span
                          dir="ltr"
                          className="block truncate text-caption text-muted-foreground"
                        >
                          {product.sku}
                        </span>
                      </span>
                      <span
                        dir="ltr"
                        className="shrink-0 text-caption tabular-nums text-muted-foreground"
                      >
                        {price ? formatMoney(price) : "—"}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between text-caption text-muted-foreground">
          <span>{t("docFlow.products.pageOf", { page, pages: pageCount, total })}</span>
          <div className="flex gap-1">
            <EnterpriseButton
              type="button"
              variant="outline"
              size="icon-sm"
              disabled={page <= 1 || loading}
              aria-label={t("docFlow.products.previousPage")}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              <ChevronLeft className="size-4 rtl:rotate-180" />
            </EnterpriseButton>
            <EnterpriseButton
              type="button"
              variant="outline"
              size="icon-sm"
              disabled={page >= pageCount || loading}
              aria-label={t("docFlow.products.nextPage")}
              onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
            >
              <ChevronRight className="size-4 rtl:rotate-180" />
            </EnterpriseButton>
          </div>
        </div>
      </div>
    </EnterpriseModal>
  );
}
