"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Info } from "lucide-react";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { MoneyInput } from "@/components/shared/money-input";
import { ProductPicker } from "@/components/business/product-picker";
import { WarehousePicker } from "@/components/business/warehouse-picker";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { EnterpriseButton } from "@/components/ui/button";
import { FieldMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AssemblyPreviewPanel,
  type AssemblyPreviewState,
} from "@/components/inventory/assembly-preview-panel";
import {
  ASSEMBLY_PERMISSIONS,
  assemblyErrorMessage,
  assemblyHref,
  normalizeDirectCost,
  parseAssemblyQuantity,
} from "@/config/inventory/assembly";
import type { WarehouseRow } from "@/config/master-data/entities";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useIdempotencyKey } from "@/hooks/use-idempotency-key";
import { useWarehouses } from "@/hooks/use-reference-data";
import { apiErrorMessage, reportApiError, reportSuccess, toast } from "@/lib/toast";
import { formatNumber } from "@/lib/format-number";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { assemblyService, type AssemblyOrder } from "@/services/assembly-service";
import { productsService, type ProductRow } from "@/services/products-service";

/** The warehouse a new assembly of `product` starts in: its preferred warehouse, else the company default. */
function defaultWarehouseFor(
  preferredWarehouseId: string | null | undefined,
  warehouses: WarehouseRow[],
): WarehouseRow | null {
  const active = warehouses.filter((warehouse) => warehouse.isActive && !warehouse.deletedAt);
  return (
    (preferredWarehouseId && active.find((warehouse) => warehouse.id === preferredWarehouseId)) ||
    active.find((warehouse) => warehouse.isDefault) ||
    null
  );
}

/**
 * "New assembly" (R13 spec §3 A): an ASSEMBLED product, a warehouse (defaults to
 * the product's preferred warehouse) and a quantity, with a live preview of the
 * components it consumes. Every submit of one dialog session carries the same
 * `Idempotency-Key`, so a double click or a retry after a timeout can never
 * assemble twice; the key is renewed after a success and when the dialog closes.
 */
export function AssemblyCreateDialog({
  open,
  onOpenChange,
  initialProduct,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Prefills the product (the product page's "Assemble" shortcut). */
  initialProduct?: ProductRow | null;
  onCreated?: (order: AssemblyOrder) => void;
}) {
  const { t } = useLocale();
  const router = useRouter();
  const fieldId = useId();
  const { hasPermission } = useUserContext();
  const canEnterDirectCost = hasPermission(ASSEMBLY_PERMISSIONS.directCost);
  const canReadProduct = hasPermission("products.view");
  const warehouses = useWarehouses({ enabled: open });
  const { key: idempotencyKey, renew: renewIdempotencyKey } = useIdempotencyKey();

  const [product, setProduct] = useState<ProductRow | null>(initialProduct ?? null);
  const [preferredWarehouseId, setPreferredWarehouseId] = useState<string | null>(
    initialProduct?.preferredWarehouseId ?? null,
  );
  const [warehouse, setWarehouse] = useState<WarehouseRow | null>(null);
  const warehouseTouched = useRef(false);
  const [quantityText, setQuantityText] = useState("1");
  const [directCostText, setDirectCostText] = useState("");
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [previewState, setPreviewState] = useState<AssemblyPreviewState>({ status: "idle" });
  const [previewRefresh, setPreviewRefresh] = useState(0);

  // Re-seed from the shortcut's product every time the dialog opens.
  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProduct(initialProduct ?? null);
    setPreferredWarehouseId(initialProduct?.preferredWarehouseId ?? null);
  }, [open, initialProduct]);

  // A catalog row has no preferred warehouse — read it from the product when allowed.
  useEffect(() => {
    // A full product row carries the key (null or an id); a catalog row does not.
    if (
      !open ||
      !product ||
      Object.prototype.hasOwnProperty.call(product, "preferredWarehouseId") ||
      !canReadProduct
    ) {
      return;
    }
    let cancelled = false;
    productsService
      .get(product.id)
      .then((full) => !cancelled && setPreferredWarehouseId(full.preferredWarehouseId ?? null))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open, product, canReadProduct]);

  // Default warehouse until the user picks one themselves.
  useEffect(() => {
    if (!open || warehouseTouched.current) return;
    const next = defaultWarehouseFor(preferredWarehouseId, warehouses);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (next && next.id !== warehouse?.id) setWarehouse(next);
  }, [open, preferredWarehouseId, warehouses, warehouse?.id]);

  const quantity = parseAssemblyQuantity(quantityText);
  const directCost = normalizeDirectCost(directCostText);
  const agentOwned = !!product?.ownerAgentId;
  const showDirectCost = canEnterDirectCost && !agentOwned;

  const previewInput = useMemo(
    () =>
      product && warehouse && quantity
        ? { productId: product.id, warehouseId: warehouse.id, quantity }
        : null,
    [product, warehouse, quantity],
  );
  const debouncedInput = useDebouncedValue(previewInput);
  const previewKey = debouncedInput
    ? `${debouncedInput.productId}|${debouncedInput.warehouseId}|${debouncedInput.quantity}`
    : "";
  const currentKey = previewInput
    ? `${previewInput.productId}|${previewInput.warehouseId}|${previewInput.quantity}`
    : "";

  useEffect(() => {
    if (!open) return;
    if (!debouncedInput) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPreviewState({ status: "idle" });
      return;
    }
    let cancelled = false;
    setPreviewState({ status: "loading" });
    assemblyService
      .preview(debouncedInput)
      .then((preview) => !cancelled && setPreviewState({ status: "ready", preview }))
      .catch(
        (error: unknown) =>
          !cancelled &&
          setPreviewState({
            status: "error",
            message:
              assemblyErrorMessage(error, t) ??
              apiErrorMessage(error, "assembly.dialog.previewFailed"),
          }),
      );
    return () => {
      cancelled = true;
    };
    // `previewKey` encodes the request; `previewRefresh` re-reads after a failed submit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, previewKey, previewRefresh]);

  const previewIsCurrent = previewKey === currentKey;
  const canSubmit =
    !isSubmitting &&
    !!previewInput &&
    previewIsCurrent &&
    previewState.status === "ready" &&
    previewState.preview.canAssemble &&
    directCost.ok;

  const reset = () => {
    setProduct(initialProduct ?? null);
    setPreferredWarehouseId(initialProduct?.preferredWarehouseId ?? null);
    setWarehouse(null);
    warehouseTouched.current = false;
    setQuantityText("1");
    setDirectCostText("");
    setNotes("");
    setSubmitAttempted(false);
    setPreviewState({ status: "idle" });
  };

  const close = () => {
    reset();
    // A new dialog session is a new request.
    renewIdempotencyKey();
    onOpenChange(false);
  };

  const submit = async () => {
    setSubmitAttempted(true);
    if (!canSubmit || !product || !warehouse || !quantity) return;
    setIsSubmitting(true);
    try {
      const order = await assemblyService.create(
        {
          productId: product.id,
          warehouseId: warehouse.id,
          quantity,
          ...(showDirectCost && directCost.value ? { directCost: directCost.value } : {}),
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        },
        idempotencyKey,
      );
      reportSuccess(t("assembly.success.created", { number: order.assemblyNumber }), {
        description: t("assembly.success.createdDescription", {
          quantity: formatNumber(order.quantity),
          product: order.product.name,
          warehouse: order.warehouse.name,
        }),
        href: assemblyHref(order.id),
        linkLabel: t("assembly.success.open"),
        navigate: (href) => router.push(href),
      });
      onCreated?.(order);
      close();
    } catch (error) {
      const message = assemblyErrorMessage(error, t);
      if (message) toast.error(message);
      else reportApiError(error, "common.failedToSave");
      // The stock or the recipe may have moved on — show the current picture.
      setPreviewRefresh((value) => value + 1);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <EnterpriseModal
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
        else onOpenChange(true);
      }}
      size="lg"
      title={t("assembly.dialog.title")}
      description={t("assembly.dialog.description")}
      footer={(requestClose) => (
        <>
          <EnterpriseButton
            type="button"
            variant="ghost"
            onClick={requestClose}
            disabled={isSubmitting}
          >
            {t("common.cancel")}
          </EnterpriseButton>
          <EnterpriseButton
            type="button"
            onClick={() => void submit()}
            disabled={!canSubmit}
            isLoading={isSubmitting}
          >
            {t("assembly.dialog.submit")}
          </EnterpriseButton>
        </>
      )}
    >
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor={`${fieldId}-product`}>{t("assembly.fields.product")}</Label>
            <ProductPicker
              id={`${fieldId}-product`}
              value={product}
              onChange={(next) => {
                setProduct(next);
                setPreferredWarehouseId(next.preferredWarehouseId ?? null);
              }}
              inventoryOnly
              supplyMethod="ASSEMBLED"
              allowCreate={false}
              placeholder={t("assembly.dialog.productPlaceholder")}
              emptyText={t("assembly.dialog.noAssembledProducts")}
              className="max-w-none"
            />
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor={`${fieldId}-warehouse`}>{t("assembly.fields.warehouse")}</Label>
            <WarehousePicker
              id={`${fieldId}-warehouse`}
              value={warehouse}
              onChange={(next) => {
                warehouseTouched.current = true;
                setWarehouse(next);
              }}
              className="max-w-none"
            />
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor={`${fieldId}-quantity`}>{t("assembly.fields.quantity")}</Label>
            <Input
              id={`${fieldId}-quantity`}
              type="number"
              inputMode="numeric"
              dir="ltr"
              min={1}
              step={1}
              value={quantityText}
              aria-invalid={quantity === null || undefined}
              onChange={(event) => setQuantityText(event.target.value)}
            />
            {quantity === null && (submitAttempted || quantityText !== "") ? (
              <FieldMessage>{t("assembly.dialog.quantityInvalid")}</FieldMessage>
            ) : null}
          </div>
          {showDirectCost ? (
            <div className="flex min-w-0 flex-col gap-1.5">
              <Label htmlFor={`${fieldId}-direct-cost`}>
                {t("assembly.dialog.directCostLabel")}
              </Label>
              <MoneyInput
                id={`${fieldId}-direct-cost`}
                value={directCostText}
                aria-invalid={!directCost.ok || undefined}
                onChange={(event) => setDirectCostText(event.target.value)}
              />
              {directCost.ok ? (
                <p className="text-caption text-muted-foreground">
                  {t("assembly.dialog.directCostHint")}
                </p>
              ) : (
                <FieldMessage>{t("assembly.dialog.directCostInvalid")}</FieldMessage>
              )}
            </div>
          ) : null}
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor={`${fieldId}-notes`}>{t("assembly.fields.notes")}</Label>
            <Input
              id={`${fieldId}-notes`}
              value={notes}
              maxLength={2000}
              placeholder={t("assembly.dialog.notesPlaceholder")}
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>
        </div>

        {agentOwned ? (
          <Alert tone="info">
            <Info />
            <AlertDescription>{t("assembly.dialog.agentOwnedNote")}</AlertDescription>
          </Alert>
        ) : null}

        <section className="flex flex-col gap-2" aria-label={t("assembly.dialog.previewTitle")}>
          <h3 className="text-body font-semibold">{t("assembly.dialog.previewTitle")}</h3>
          <AssemblyPreviewPanel
            state={previewIsCurrent ? previewState : { status: previewInput ? "loading" : "idle" }}
            requestedQuantity={quantity}
            onUseMaximum={(maximum) => setQuantityText(String(maximum))}
          />
        </section>
      </div>
    </EnterpriseModal>
  );
}
