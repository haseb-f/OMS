"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Package, Plus } from "lucide-react";
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
import {
  CREATE_PRODUCT_PERMISSION,
  InlineProductCreate,
} from "@/components/business/product-picker";
import { useProductBrands, useProductCategories } from "@/hooks/use-reference-data";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { cachedLookup } from "@/lib/lookup-cache";
import { formatMoney } from "@/lib/money";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { productsService, type ProductRow, type ProductType } from "@/services/products-service";

const PAGE_SIZE = 20;
const ALL = "__all__";
const PRODUCT_TYPES: ProductType[] = [
  "PURCHASE_ONLY",
  "SALES_ONLY",
  "PURCHASE_AND_SALE",
  "MANUFACTURED",
  "SERVICE",
  "EXPENSE_ITEM",
];

function FilterSelect({
  value,
  onChange,
  allLabel,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  allLabel: string;
  options: { value: string; label: string }[];
}) {
  return (
    <Select value={value || ALL} onValueChange={(next) => onChange(next === ALL ? "" : next)}>
      <SelectTrigger size="sm" className="w-full min-w-0">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{allLabel}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Expanded product picker for document lines: server-side search, category/
 * brand/type filters and pagination (never the whole catalog), with
 * multi-select so a user adds many lines in one pass. Selection survives
 * paging/searching; a product created here joins the selection.
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
  const { hasPermission } = useUserContext();
  const canCreate = hasPermission(CREATE_PRODUCT_PERMISSION);
  const categories = useProductCategories();
  const brands = useProductBrands();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search);
  const [categoryId, setCategoryId] = useState("");
  const [brandId, setBrandId] = useState("");
  const [type, setType] = useState("");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<ProductRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<Map<string, ProductRow>>(new Map());
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPage(1);
  }, [debouncedSearch, categoryId, brandId, type]);

  useEffect(() => {
    if (!open) return;
    const params = {
      search: debouncedSearch || undefined,
      categoryId: categoryId || undefined,
      brandId: brandId || undefined,
      type: (type || undefined) as ProductType | undefined,
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
  }, [open, debouncedSearch, categoryId, brandId, type, page, mode]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const selectedList = useMemo(() => [...selected.values()], [selected]);
  const pageSelectedCount = items.filter((product) => selected.has(product.id)).length;
  const pageAllSelected = items.length > 0 && pageSelectedCount === items.length;

  const toggle = (product: ProductRow) => {
    setSelected((previous) => {
      const next = new Map(previous);
      if (next.has(product.id)) next.delete(product.id);
      else next.set(product.id, product);
      return next;
    });
  };

  const togglePage = () => {
    setSelected((previous) => {
      const next = new Map(previous);
      for (const product of items) {
        if (pageAllSelected) next.delete(product.id);
        else next.set(product.id, product);
      }
      return next;
    });
  };

  const close = () => {
    setSelected(new Map());
    setSearch("");
    setCategoryId("");
    setBrandId("");
    setType("");
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
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
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
              data-testid="browse-products-add"
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
      <div className="flex flex-col gap-2">
        <SearchInput
          value={search}
          onValueChange={setSearch}
          isLoading={loading}
          placeholder={t("sales.editor.grid.productSearchPlaceholder")}
        />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <FilterSelect
            value={categoryId}
            onChange={setCategoryId}
            allLabel={t("docFlow.products.allCategories")}
            options={categories.map((category) => ({ value: category.id, label: category.name }))}
          />
          <FilterSelect
            value={type}
            onChange={setType}
            allLabel={t("docFlow.products.allTypes")}
            options={PRODUCT_TYPES.map((value) => ({ value, label: t(`products.type.${value}`) }))}
          />
          {brands.length > 0 ? (
            <FilterSelect
              value={brandId}
              onChange={setBrandId}
              allLabel={t("docFlow.products.allBrands")}
              options={brands.map((brand) => ({ value: brand.id, label: brand.name }))}
            />
          ) : null}
        </div>

        <div className="rounded-xs border border-border">
          <div className="flex min-h-9 items-center justify-between gap-2 border-b border-border bg-muted/40 px-3 py-1">
            <label className="flex min-w-0 cursor-pointer items-center gap-3 text-caption text-muted-foreground">
              <Checkbox
                checked={pageAllSelected}
                disabled={loading || items.length === 0}
                onCheckedChange={togglePage}
              />
              <span className="truncate">{t("docFlow.products.selectPage")}</span>
            </label>
            {canCreate ? (
              <EnterpriseButton
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 shrink-0 gap-1.5 text-primary"
                onClick={() => setCreateOpen(true)}
              >
                <Plus className="size-3.5" />
                {t("docFlow.products.createNew")}
              </EnterpriseButton>
            ) : null}
          </div>
          <div className="min-h-64">
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
                  const meta = [product.sku, product.category?.name, product.brand?.name]
                    .filter(Boolean)
                    .join(" · ");
                  return (
                    <li key={product.id}>
                      <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-1.5 hover:bg-muted/50">
                        <Checkbox
                          checked={selected.has(product.id)}
                          onCheckedChange={() => toggle(product)}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-body">
                            {product.displayName || product.name}
                          </span>
                          <span className="block truncate text-caption text-muted-foreground">
                            {meta}
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
        </div>

        <div className="flex items-center justify-between gap-2 text-caption text-muted-foreground">
          <span className="min-w-0 truncate">
            {t("docFlow.products.pageOf", { page, pages: pageCount, total })}
          </span>
          <div className="flex shrink-0 gap-1">
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
      {canCreate && createOpen ? (
        <InlineProductCreate
          open={createOpen}
          onOpenChange={setCreateOpen}
          initialName={search.trim()}
          onReady={(product) =>
            setSelected((previous) => new Map(previous).set(product.id, product))
          }
        />
      ) : null}
    </EnterpriseModal>
  );
}
