"use client";

import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Trash2 } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { ModalSection } from "@/components/shared/modal-section";
import { MasterDataForm } from "@/components/master-data/master-data-form";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { ProductPicker } from "@/components/business/product-picker";
import { storeOrdersService, type StoreOrderRow } from "@/services/store-orders-service";
import type { ProductRow } from "@/services/products-service";
import {
  buildStoreOrderCreateSchema,
  storeOrderCreateDefaultValues,
  type StoreOrderCreateFormValues,
} from "@/config/store-orders/store-order-create-schema";
import { useLocale } from "@/providers/locale-provider";
import { useCurrencies } from "@/hooks/use-reference-data";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";

interface StoreOrderCreateLine {
  /** Client-side row identity (React key + remove target) — never a DB id at this layer, same convention as `ProductLineItemsGrid`'s own rows. */
  id: string;
  product: ProductRow | null;
  quantity: number;
  unitPrice: number;
}

let nextLineId = 1;
function createEmptyLine(): StoreOrderCreateLine {
  return { id: `line-${nextLineId++}`, product: null, quantity: 1, unitPrice: 0 };
}

/**
 * The manual "New Store Order" entry point (Store Orders verification
 * follow-up) — the list page only had Import until now. Structurally
 * mirrors `LeadOrderCreateDialog`/`CustomerQuickCreateDialog`: `EnterpriseModal`
 * + `MasterDataForm` for the flat fields, `react-hook-form`/zod for
 * validation, `toast` + close-and-refresh on success (no dedicated detail-page
 * redirect — same post-create pattern the Lead/Order dialog itself uses).
 * The customer is never a `customerId` — `create()` sends `{name, phone,
 * email}` and the backend resolves it via `CustomersService.findOrCreate`,
 * exactly like the Import path already does.
 */
export function StoreOrderCreateDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (order: StoreOrderRow) => void;
}) {
  const { t } = useLocale();
  const currencies = useCurrencies();
  const [lines, setLines] = useState<StoreOrderCreateLine[]>([createEmptyLine()]);
  const [itemsError, setItemsError] = useState<string | null>(null);

  const schema = useMemo(() => buildStoreOrderCreateSchema(t), [t]);

  const form = useForm<StoreOrderCreateFormValues>({
    resolver: zodResolver(schema),
    defaultValues: storeOrderCreateDefaultValues(),
  });

  useEffect(() => {
    if (open) {
      form.reset(storeOrderCreateDefaultValues());
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLines([createEmptyLine()]);
      setItemsError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const isDirty = form.formState.isDirty;
  const isSubmitting = form.formState.isSubmitting;

  const updateLine = (id: string, patch: Partial<StoreOrderCreateLine>) => {
    setLines((current) => current.map((line) => (line.id === id ? { ...line, ...patch } : line)));
  };

  const addLine = () => setLines((current) => [...current, createEmptyLine()]);
  const removeLine = (id: string) =>
    setLines((current) =>
      current.length > 1 ? current.filter((line) => line.id !== id) : current,
    );

  const submit = form.handleSubmit(async (values) => {
    const validLines = lines.filter((line) => line.product && line.quantity > 0);
    if (validLines.length === 0) {
      setItemsError(t("storeOrders.createDialog.items.required"));
      return;
    }
    setItemsError(null);

    try {
      const created = await storeOrdersService.create({
        externalOrderId: values.externalOrderId || undefined,
        customer: {
          name: values.customerName,
          phone: values.customerPhone || undefined,
          email: values.customerEmail || undefined,
        },
        orderDate: values.orderDate || undefined,
        source: "MANUAL",
        currencyId: values.currencyId,
        notes: values.notes || undefined,
        items: validLines.map((line) => ({
          productId: line.product!.id,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
        })),
      });
      toast.success(t("storeOrders.createDialog.success"));
      onOpenChange(false);
      onCreated(created);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.noResults"));
    }
  });

  return (
    <EnterpriseModal
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={t("storeOrders.createDialog.title")}
      description={t("storeOrders.createDialog.description")}
      isDirty={isDirty}
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
          <EnterpriseButton type="button" onClick={() => submit()} disabled={isSubmitting}>
            {t("common.save")}
          </EnterpriseButton>
        </>
      )}
    >
      <div className="flex flex-col gap-5">
        <MasterDataForm
          form={form}
          sections={[
            {
              title: t("storeOrders.createDialog.sections.orderInfo"),
              columns: 2,
              fields: [
                {
                  name: "externalOrderId",
                  label: "storeOrders.fields.externalOrderId",
                  type: "text",
                },
                { name: "orderDate", label: "storeOrders.fields.orderDate", type: "date" },
                {
                  name: "currencyId",
                  label: "storeOrders.createDialog.fields.currency",
                  type: "select",
                  required: true,
                  options: currencies.map((c) => ({ value: c.id, label: `${c.code} — ${c.name}` })),
                },
              ],
            },
            {
              title: t("storeOrders.createDialog.sections.customer"),
              columns: 2,
              fields: [
                {
                  name: "customerName",
                  label: "storeOrders.createDialog.fields.customerName",
                  type: "text",
                  required: true,
                },
                {
                  name: "customerPhone",
                  label: "storeOrders.fields.phone",
                  type: "phone",
                  required: true,
                },
                {
                  name: "customerEmail",
                  label: "storeOrders.createDialog.fields.customerEmail",
                  type: "text",
                },
              ],
            },
            {
              title: t("storeOrders.createDialog.sections.notes"),
              columns: 2,
              fields: [
                { name: "notes", label: "storeOrders.createDialog.fields.notes", type: "textarea" },
              ],
            },
          ]}
        />

        <ModalSection title={t("storeOrders.createDialog.items.title")} columns={2}>
          <div className="col-span-full flex flex-col gap-3">
            <div className="overflow-x-auto rounded-md border border-border/60">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("storeOrders.detail.items.product")}</TableHead>
                    <TableHead className="w-32">{t("storeOrders.detail.items.quantity")}</TableHead>
                    <TableHead className="w-36">
                      {t("storeOrders.detail.items.unitPrice")}
                    </TableHead>
                    <TableHead className="w-12" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((line) => (
                    <TableRow key={line.id}>
                      <TableCell>
                        <ProductPicker
                          value={line.product}
                          onChange={(product) => updateLine(line.id, { product })}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min={1}
                          value={line.quantity}
                          onChange={(event) =>
                            updateLine(line.id, { quantity: Number(event.target.value) || 0 })
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min={0}
                          step="0.01"
                          value={line.unitPrice}
                          onChange={(event) =>
                            updateLine(line.id, { unitPrice: Number(event.target.value) || 0 })
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <EnterpriseButton
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          disabled={lines.length === 1}
                          onClick={() => removeLine(line.id)}
                          aria-label={t("storeOrders.createDialog.items.remove")}
                        >
                          <Trash2 className="size-4" />
                        </EnterpriseButton>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {itemsError && <p className="text-caption text-destructive">{itemsError}</p>}
            <EnterpriseButton
              type="button"
              variant="outline"
              size="sm"
              className="w-fit gap-1.5"
              onClick={addLine}
            >
              <Plus className="size-3.5" />
              {t("storeOrders.createDialog.items.add")}
            </EnterpriseButton>
          </div>
        </ModalSection>
      </div>
    </EnterpriseModal>
  );
}
