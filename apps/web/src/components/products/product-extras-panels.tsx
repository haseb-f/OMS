"use client";

import { useEffect, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus, Trash2 } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import { EnterpriseBadge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ModalFieldFullWidth } from "@/components/shared/modal-section";
import { DetailField, DetailFieldGrid } from "@/components/shared/detail-workspace";
import { StatusBadge } from "@/components/business/status-badge";
import { EnterpriseDataTable } from "@/components/master-data/enterprise-data-table";
import { useLocale } from "@/providers/locale-provider";
import { toast, reportApiError } from "@/lib/toast";
import { formatDateTime } from "@/lib/date";
import { formatNumber } from "@/lib/format-number";
import type { MessageKey } from "@/i18n/translate";
import {
  productsService,
  type ProductAttachmentRow,
  type ProductRow,
  type ProductVariantRow,
} from "@/services/products-service";
import {
  inventoryService,
  type InventoryMovementRow,
  type StockCard,
} from "@/services/inventory-service";

/**
 * Existing product capabilities the one product form keeps behind its
 * disclosure sections: the live stock position (+ the Opening Balance
 * shortcut), the movement audit trail, variants and attachments. Each renders
 * inside the grid of the `ModalSection` that discloses it, and reads real
 * data only — nothing here is computed or fabricated.
 */

/** Live read of the movement-derived stock position (ADR-0013) and the actual (moving-average) cost. */
export function ProductStockSummary({
  product,
  onOpeningBalance,
}: {
  product: ProductRow;
  onOpeningBalance: () => void;
}) {
  const { t } = useLocale();
  const [stockCard, setStockCard] = useState<StockCard | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    inventoryService
      .getStockCard(product.id)
      .then((card) => !cancelled && setStockCard(card))
      .catch(() => !cancelled && setStockCard(null))
      .finally(() => !cancelled && setIsLoading(false));
    return () => {
      cancelled = true;
    };
  }, [product.id]);

  const inStock = (stockCard?.onHand ?? 0) > 0;
  const show = (value: number | undefined) => (isLoading ? "…" : formatNumber(value ?? 0));

  return (
    <ModalFieldFullWidth>
      <DetailFieldGrid columns={4}>
        <DetailField
          label={t("inventory.fields.onHand")}
          value={<span dir="ltr">{show(stockCard?.onHand)}</span>}
        />
        <DetailField
          label={t("inventory.fields.reserved")}
          value={<span dir="ltr">{show(stockCard?.reserved)}</span>}
        />
        <DetailField
          label={t("inventory.fields.available")}
          value={<span dir="ltr">{show(stockCard?.available)}</span>}
        />
        <DetailField
          label={t("products.inventory.status")}
          value={
            isLoading ? (
              "…"
            ) : (
              <StatusBadge
                tone={inStock ? "success" : "neutral"}
                label={t(inStock ? "products.inventory.inStock" : "products.inventory.outOfStock")}
              />
            )
          }
        />
        <DetailField
          label={t("products.cost.currentCostActual")}
          value={
            <span dir="ltr">
              {product.currentCost ? formatNumber(product.currentCost, { maxDecimals: 4 }) : "—"}
            </span>
          }
        />
        <DetailField
          label={t("products.cost.lastCostUpdate")}
          value={
            <span dir="ltr">
              {product.lastCostUpdate ? formatDateTime(product.lastCostUpdate) : "—"}
            </span>
          }
        />
        <DetailField
          label={t("products.openingBalance.warehouse")}
          value={product.preferredWarehouse?.name}
        />
      </DetailFieldGrid>
      <p className="mt-1 text-caption text-muted-foreground">{t("products.cost.movingAverage")}</p>
      <EnterpriseButton
        type="button"
        variant="outline"
        size="sm"
        className="mt-2"
        onClick={onOpeningBalance}
      >
        <Plus />
        {t("products.openingBalance.title")}
      </EnterpriseButton>
    </ModalFieldFullWidth>
  );
}

/** Read-only audit trail of this product's own stock movements (the system-wide ledger, filtered). */
export function ProductStockMovements({ productId }: { productId: string }) {
  const { t } = useLocale();
  const [movements, setMovements] = useState<InventoryMovementRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    inventoryService
      .getMovements({ productId })
      .then((rows) => !cancelled && setMovements(rows))
      .catch(() => !cancelled && setMovements([]))
      .finally(() => !cancelled && setIsLoading(false));
    return () => {
      cancelled = true;
    };
  }, [productId]);

  const columns: ColumnDef<InventoryMovementRow, unknown>[] = [
    {
      id: "referenceType",
      meta: { titleKey: "products.stockMovements.reference" },
      accessorFn: (row) => row.referenceType || row.movementNumber,
      cell: ({ row }) =>
        row.original.referenceType ? (
          <span dir="ltr" className="text-xs">
            {row.original.referenceType}
            {row.original.referenceId ? ` #${row.original.referenceId.slice(0, 8)}` : ""}
          </span>
        ) : (
          <code dir="ltr" className="text-xs">
            {row.original.movementNumber}
          </code>
        ),
    },
    {
      id: "type",
      meta: { titleKey: "inventory.fields.type" },
      accessorFn: (row) => t(`inventory.movementType.${row.type}` as MessageKey),
    },
    {
      id: "warehouse",
      meta: { titleKey: "products.openingBalance.warehouse" },
      accessorFn: (row) => row.warehouse?.name ?? "",
    },
    {
      id: "quantity",
      meta: { titleKey: "inventory.fields.quantity" },
      accessorFn: (row) => row.quantity,
      cell: ({ row }) => <span dir="ltr">{row.original.quantity}</span>,
    },
    {
      id: "quantityAfter",
      meta: { titleKey: "inventory.fields.balanceAfter" },
      accessorFn: (row) => row.quantityAfter,
      cell: ({ row }) => <span dir="ltr">{row.original.quantityAfter}</span>,
    },
    {
      id: "unitCost",
      meta: { titleKey: "products.stockMovements.cost" },
      accessorFn: (row) => row.unitCost ?? "",
      cell: ({ row }) =>
        row.original.unitCost != null ? (
          <span dir="ltr">{formatNumber(row.original.unitCost, { maxDecimals: 4 })}</span>
        ) : (
          "—"
        ),
    },
    {
      id: "createdAt",
      meta: { titleKey: "inventory.fields.date" },
      accessorFn: (row) => formatDateTime(row.createdAt),
      cell: ({ row }) => <span dir="ltr">{formatDateTime(row.original.createdAt)}</span>,
    },
  ];

  return (
    <ModalFieldFullWidth>
      <EnterpriseDataTable
        tableId="product-stock-movements"
        printTitle={t("products.stockMovements.reference")}
        columns={columns}
        data={movements}
        isLoading={isLoading}
        emptyTitle={t("products.stockMovements.empty")}
      />
    </ModalFieldFullWidth>
  );
}

export function ProductVariants({ productId }: { productId: string }) {
  const { t } = useLocale();
  const [variants, setVariants] = useState<ProductVariantRow[]>([]);
  const [color, setColor] = useState("");
  const [size, setSize] = useState("");
  const [weight, setWeight] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const load = () => {
    productsService.variants
      .list(productId)
      .then(setVariants)
      .catch(() => setVariants([]));
  };

  useEffect(load, [productId]);

  const addVariant = async () => {
    const attributes: Record<string, string> = {};
    if (color) attributes.color = color;
    if (size) attributes.size = size;
    if (weight) attributes.weight = weight;
    if (Object.keys(attributes).length === 0) return;

    setIsSaving(true);
    try {
      await productsService.variants.create(productId, { attributes });
      toast.success(t("products.variantSaved"));
      setColor("");
      setSize("");
      setWeight("");
      load();
    } catch (error) {
      reportApiError(error, "common.failedToSave");
    } finally {
      setIsSaving(false);
    }
  };

  const removeVariant = async (id: string) => {
    try {
      await productsService.variants.remove(productId, id);
      toast.success(t("products.variantRemoved"));
      load();
    } catch (error) {
      reportApiError(error, "common.failedToSave");
    }
  };

  return (
    <>
      <div className="flex flex-col gap-1">
        <Label htmlFor="variant-color">{t("products.fields.color")}</Label>
        <Input id="variant-color" value={color} onChange={(e) => setColor(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="variant-size">{t("products.fields.size")}</Label>
        <Input id="variant-size" value={size} onChange={(e) => setSize(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="variant-weight">{t("products.fields.variantWeight")}</Label>
        <Input id="variant-weight" value={weight} onChange={(e) => setWeight(e.target.value)} />
      </div>
      <ModalFieldFullWidth>
        <EnterpriseButton
          type="button"
          variant="outline"
          size="sm"
          onClick={addVariant}
          disabled={isSaving}
        >
          <Plus />
          {t("products.actions.addVariant")}
        </EnterpriseButton>
      </ModalFieldFullWidth>
      <ModalFieldFullWidth>
        {variants.length === 0 ? (
          <p className="text-caption text-muted-foreground">{t("products.variantsEmpty")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {variants.map((variant) => (
              <li
                key={variant.id}
                className="flex items-center justify-between gap-2 rounded-sm border border-border p-2"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <code dir="ltr" className="rounded-xs bg-muted px-1.5 py-0.5 text-xs">
                    {variant.sku}
                  </code>
                  {Object.entries(variant.attributes).map(([key, value]) => (
                    <EnterpriseBadge key={key} variant="outline">
                      {key}: {value}
                    </EnterpriseBadge>
                  ))}
                </div>
                <EnterpriseButton
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => removeVariant(variant.id)}
                  aria-label={t("products.actions.deleteVariant")}
                >
                  <Trash2 />
                </EnterpriseButton>
              </li>
            ))}
          </ul>
        )}
      </ModalFieldFullWidth>
    </>
  );
}

export function ProductAttachments({ productId }: { productId: string }) {
  const { t } = useLocale();
  const [attachments, setAttachments] = useState<ProductAttachmentRow[]>([]);
  const [fileUrl, setFileUrl] = useState("");
  const [fileName, setFileName] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const load = () => {
    productsService.attachments
      .list(productId)
      .then(setAttachments)
      .catch(() => setAttachments([]));
  };

  useEffect(load, [productId]);

  const addAttachment = async () => {
    if (!fileUrl) return;
    setIsSaving(true);
    try {
      await productsService.attachments.create(productId, {
        fileUrl,
        fileName: fileName || undefined,
      });
      toast.success(t("products.attachmentAdded"));
      setFileUrl("");
      setFileName("");
      load();
    } catch (error) {
      reportApiError(error, "common.failedToSave");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <div className="flex flex-col gap-1">
        <Label htmlFor="attachment-url">{t("products.fields.fileUrl")}</Label>
        <Input
          id="attachment-url"
          dir="ltr"
          value={fileUrl}
          onChange={(e) => setFileUrl(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="attachment-name">{t("products.fields.fileName")}</Label>
        <Input
          id="attachment-name"
          value={fileName}
          onChange={(e) => setFileName(e.target.value)}
        />
      </div>
      <ModalFieldFullWidth>
        <EnterpriseButton
          type="button"
          variant="outline"
          size="sm"
          onClick={addAttachment}
          disabled={isSaving}
        >
          <Plus />
          {t("products.actions.addAttachment")}
        </EnterpriseButton>
      </ModalFieldFullWidth>
      <ModalFieldFullWidth>
        {attachments.length === 0 ? (
          <p className="text-caption text-muted-foreground">{t("products.attachmentsEmpty")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {attachments.map((attachment) => (
              <li key={attachment.id}>
                <a
                  href={attachment.fileUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="block rounded-sm border border-border p-2 text-body text-primary underline-offset-2 hover:underline"
                >
                  {attachment.fileName || attachment.fileUrl}
                </a>
              </li>
            ))}
          </ul>
        )}
      </ModalFieldFullWidth>
    </>
  );
}
