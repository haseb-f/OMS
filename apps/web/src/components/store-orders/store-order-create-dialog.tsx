"use client";

import { useEffect, useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Banknote, Globe, Plus, Trash2 } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { ModalFieldFullWidth, ModalSection } from "@/components/shared/modal-section";
import {
  CreateOperationFooter,
  CreateOperationLayout,
  CreateOperationTotals,
} from "@/components/shared/create-operation";
import { MoneyValue } from "@/components/shared/money-value";
import {
  ComboboxFormField,
  DateFormField,
  FileUrlField,
  NumberFormField,
  PhoneFormField,
  TextareaFormField,
  TextFormField,
} from "@/components/shared/form-fields";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FieldLabel, FieldMessage, Form } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { ProductPicker } from "@/components/business/product-picker";
import { CustomerPicker } from "@/components/business/customer-picker";
import { AccountPicker } from "@/components/business/account-picker";
import { EntityCombobox } from "@/components/shared/entity-combobox";
import { storeOrdersService, type StoreOrderRow } from "@/services/store-orders-service";
import {
  paymentSourcesService,
  type PaymentSourceOption,
} from "@/services/payment-sources-service";
import type { CustomerRow } from "@/services/customers-service";
import type { ProductRow } from "@/services/products-service";
import type { ChartOfAccountRow } from "@/config/master-data/entities";
import {
  buildStoreOrderCreateSchema,
  storeOrderCreateDefaultValues,
  type StoreOrderCreateFormValues,
} from "@/config/store-orders/store-order-create-schema";
import { useLocale } from "@/providers/locale-provider";
import { useCountries, useCurrencies } from "@/hooks/use-reference-data";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";
import { toISODate } from "@/lib/date";

interface StoreOrderCreateLine {
  id: string;
  product: ProductRow | null;
  quantity: number;
  unitPrice: number;
}

let nextLineId = 1;
function createEmptyLine(): StoreOrderCreateLine {
  return { id: `line-${nextLineId++}`, product: null, quantity: 1, unitPrice: 0 };
}

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
  const countries = useCountries();
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerRow | null>(null);
  const [lines, setLines] = useState<StoreOrderCreateLine[]>([createEmptyLine()]);
  const [itemsError, setItemsError] = useState<string | null>(null);
  const [paymentSources, setPaymentSources] = useState<PaymentSourceOption[]>([]);
  const [paymentSource, setPaymentSource] = useState<PaymentSourceOption | null>(null);
  const [receivingAccount, setReceivingAccount] = useState<ChartOfAccountRow | null>(null);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [receiptError, setReceiptError] = useState<string | null>(null);

  const schema = useMemo(() => buildStoreOrderCreateSchema(t), [t]);

  const form = useForm<StoreOrderCreateFormValues>({
    resolver: zodResolver(schema),
    defaultValues: storeOrderCreateDefaultValues(),
  });

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    paymentSourcesService
      .list()
      .then((rows) => {
        if (!cancelled) setPaymentSources(rows);
      })
      .catch(() => {
        if (!cancelled) setPaymentSources([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const isDirty = form.formState.isDirty;
  const isSubmitting = form.formState.isSubmitting;
  const countryId = useWatch({ control: form.control, name: "countryId" });
  const selectedCurrencyId = useWatch({ control: form.control, name: "currencyId" });
  const paymentAmount = useWatch({ control: form.control, name: "paymentAmount" });
  const receiptName = useWatch({ control: form.control, name: "receiptName" });
  const receiptUrl = useWatch({ control: form.control, name: "receiptUrl" });
  const countryCode = countries.find((country) => country.id === countryId)?.code ?? null;
  const defaultCurrencyId =
    currencies.find((currency) => currency.code === "SAR")?.id ?? currencies[0]?.id ?? "";

  useEffect(() => {
    if (defaultCurrencyId && !selectedCurrencyId) {
      form.setValue("currencyId", defaultCurrencyId, { shouldDirty: false });
    }
  }, [defaultCurrencyId, selectedCurrencyId, form]);
  const currencyCode =
    currencies.find((currency) => currency.id === (selectedCurrencyId || defaultCurrencyId))
      ?.code ?? "";

  const itemsTotal = lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
  const paidAmount = typeof paymentAmount === "number" && paymentAmount > 0 ? paymentAmount : 0;
  const balance = itemsTotal - paidAmount;

  const applyCustomer = (customer: CustomerRow) => {
    setSelectedCustomer(customer);
    form.setValue("customerName", customer.name, { shouldDirty: true, shouldValidate: true });
    form.setValue("customerPhone", customer.phone || customer.mobile || "", {
      shouldDirty: true,
      shouldValidate: true,
    });
    form.setValue("customerEmail", customer.email || "", { shouldDirty: true });
    form.setValue("countryId", customer.countryId || "", { shouldDirty: true });
    form.setValue("city", customer.city || "", { shouldDirty: true });
    form.setValue("address", customer.address || "", { shouldDirty: true });
    if (!form.getValues("senderName")) {
      form.setValue("senderName", customer.name, { shouldDirty: false });
    }
  };

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

    const wantsPayment = typeof values.paymentAmount === "number" && values.paymentAmount > 0;
    if (wantsPayment && (!paymentSource || !receivingAccount || !values.senderName?.trim())) {
      setPaymentError(t("storeOrders.createDialog.paymentIncomplete"));
      return;
    }
    setPaymentError(null);

    const hasReceiptName = Boolean(values.receiptName?.trim());
    const hasReceiptUrl = Boolean(values.receiptUrl?.trim());
    if (hasReceiptName !== hasReceiptUrl) {
      setReceiptError(t("storeOrders.createDialog.receiptIncomplete"));
      return;
    }
    setReceiptError(null);

    try {
      const created = await storeOrdersService.create({
        externalOrderId: values.externalOrderId || undefined,
        customer: {
          name: values.customerName,
          phone: values.customerPhone || undefined,
          email: values.customerEmail || undefined,
          countryId: values.countryId || undefined,
          city: values.city || undefined,
          address: values.address || undefined,
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
        ...(wantsPayment && paymentSource && receivingAccount
          ? {
              payment: {
                paymentSourceId: paymentSource.id,
                receivingAccountId: receivingAccount.id,
                paymentDate: toISODate(new Date()),
                amount: values.paymentAmount!,
                senderName: values.senderName!.trim(),
                currencyId: values.currencyId,
              },
            }
          : {}),
      });

      if (hasReceiptName && hasReceiptUrl) {
        try {
          await storeOrdersService.receipts.attach(created.id, {
            fileName: values.receiptName!.trim(),
            fileUrl: values.receiptUrl!.trim(),
          });
        } catch (error) {
          toast.error(error instanceof ApiError ? error.message : t("common.loadFailed"));
        }
      }

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
      size="xl"
      title={t("storeOrders.createDialog.title")}
      description={t("storeOrders.createDialog.description")}
      isDirty={isDirty}
      footer={(requestClose) => (
        <CreateOperationFooter
          requestClose={requestClose}
          onSubmit={() => void submit()}
          isSubmitting={isSubmitting}
          submitLabel={t("storeOrders.createDialog.submit")}
        />
      )}
    >
      <Form {...form}>
        <CreateOperationLayout>
          <ModalSection title={t("storeOrders.createDialog.sections.customer")} columns={2}>
            <ModalFieldFullWidth>
              <div className="flex flex-col gap-1.5">
                <FieldLabel>{t("storeOrders.createDialog.fields.customer")}</FieldLabel>
                <CustomerPicker
                  value={selectedCustomer}
                  onChange={applyCustomer}
                  className="max-w-none"
                />
              </div>
            </ModalFieldFullWidth>
            <TextFormField
              control={form.control}
              name="customerName"
              label={t("storeOrders.createDialog.fields.customerName")}
              required
            />
            <PhoneFormField
              control={form.control}
              name="customerPhone"
              label={t("storeOrders.fields.phone")}
              required
              countryCode={countryCode}
            />
            <ComboboxFormField
              control={form.control}
              name="countryId"
              label={t("storeOrders.createDialog.fields.country")}
              optional
              items={countries}
              getId={(country) => country.id}
              getTitle={(country) => country.name}
              getSubtitle={(country) => country.code}
              getSearchText={(country) => `${country.name} ${country.code}`}
              subtitleDir="ltr"
              allowClear
              icon={<Globe className="size-4 shrink-0 text-muted-foreground" />}
            />
            <TextFormField
              control={form.control}
              name="city"
              label={t("storeOrders.createDialog.fields.city")}
              optional
            />
            <TextFormField
              control={form.control}
              name="customerEmail"
              label={t("storeOrders.createDialog.fields.customerEmail")}
              optional
              dir="ltr"
              inputMode="email"
            />
            <ModalFieldFullWidth>
              <TextFormField
                control={form.control}
                name="address"
                label={t("storeOrders.createDialog.fields.address")}
                optional
              />
            </ModalFieldFullWidth>
          </ModalSection>

          <ModalSection title={t("storeOrders.createDialog.sections.orderInfo")} columns={2}>
            <TextFormField
              control={form.control}
              name="externalOrderId"
              label={t("storeOrders.fields.externalOrderId")}
              optional
              dir="ltr"
            />
            <DateFormField
              control={form.control}
              name="orderDate"
              label={t("storeOrders.fields.orderDate")}
            />
            <ComboboxFormField
              control={form.control}
              name="currencyId"
              label={t("storeOrders.createDialog.fields.currency")}
              required
              items={currencies}
              getId={(currency) => currency.id}
              getTitle={(currency) => currency.code}
              getSubtitle={(currency) => currency.name}
              getSearchText={(currency) => `${currency.code} ${currency.name}`}
              subtitleDir="ltr"
              icon={<Banknote className="size-4 shrink-0 text-muted-foreground" />}
            />
          </ModalSection>

          <ModalSection title={t("storeOrders.createDialog.items.title")} columns={2}>
            <div className="col-span-full flex flex-col gap-3">
              <div className="overflow-x-auto rounded-md border border-border/60">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("storeOrders.fields.product")}</TableHead>
                      <TableHead className="w-24">{t("storeOrders.fields.quantity")}</TableHead>
                      <TableHead className="w-32">{t("storeOrders.fields.unitPrice")}</TableHead>
                      <TableHead className="w-32">
                        {t("storeOrders.createDialog.items.lineTotal")}
                      </TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lines.map((line) => (
                      <TableRow key={line.id}>
                        <TableCell className="min-w-52">
                          <ProductPicker
                            value={line.product}
                            className="max-w-none"
                            onChange={(product) => {
                              const price = Number(product.salesPrice);
                              updateLine(line.id, {
                                product,
                                unitPrice:
                                  Number.isFinite(price) && price > 0 ? price : line.unitPrice,
                              });
                            }}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            inputMode="numeric"
                            dir="ltr"
                            inputSize="compact-md"
                            min={1}
                            value={line.quantity}
                            onChange={(event) =>
                              updateLine(line.id, {
                                quantity: Math.max(0, Number(event.target.value) || 0),
                              })
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            inputMode="decimal"
                            dir="ltr"
                            inputSize="compact-md"
                            min={0}
                            step="0.01"
                            value={line.unitPrice}
                            onChange={(event) =>
                              updateLine(line.id, {
                                unitPrice: Number(event.target.value) || 0,
                              })
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <MoneyValue
                            value={line.quantity * line.unitPrice}
                            currency={currencyCode}
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
              <FieldMessage>{itemsError}</FieldMessage>
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

          <ModalSection
            title={t("storeOrders.createDialog.sections.payment")}
            optional
            collapsible
            defaultOpen={false}
            columns={2}
          >
            <NumberFormField
              control={form.control}
              name="paymentAmount"
              label={t("storeOrders.createDialog.fields.paymentAmount")}
              optional
              min={0}
              step="0.01"
            />
            <div className="flex flex-col gap-1.5">
              <FieldLabel>{t("storeOrders.createDialog.fields.paymentSource")}</FieldLabel>
              <EntityCombobox
                items={paymentSources}
                value={paymentSource}
                onChange={setPaymentSource}
                getId={(source) => source.id}
                getTitle={(source) => source.name}
                allowClear
                placeholder={t("common.select")}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <FieldLabel>{t("storeOrders.createDialog.fields.receivingAccount")}</FieldLabel>
              <AccountPicker value={receivingAccount} onChange={setReceivingAccount} postingOnly />
            </div>
            <TextFormField
              control={form.control}
              name="senderName"
              label={t("storeOrders.createDialog.fields.senderName")}
              optional
            />
            <div className="col-span-full">
              <FieldMessage>{paymentError}</FieldMessage>
            </div>
          </ModalSection>

          <ModalSection
            title={t("storeOrders.createDialog.sections.notes")}
            optional
            collapsible
            defaultOpen={false}
            columns={2}
          >
            <ModalFieldFullWidth>
              <TextareaFormField
                control={form.control}
                name="notes"
                label={t("storeOrders.createDialog.fields.notes")}
                optional
              />
            </ModalFieldFullWidth>
          </ModalSection>

          <ModalSection
            title={t("storeOrders.createDialog.sections.receipts")}
            optional
            collapsible
            defaultOpen={false}
            columns={2}
          >
            <ModalFieldFullWidth>
              <FileUrlField
                fileName={receiptName ?? ""}
                fileUrl={receiptUrl ?? ""}
                onFileNameChange={(value) =>
                  form.setValue("receiptName", value, { shouldDirty: true })
                }
                onFileUrlChange={(value) =>
                  form.setValue("receiptUrl", value, { shouldDirty: true })
                }
                onClear={() => {
                  form.setValue("receiptName", "", { shouldDirty: true });
                  form.setValue("receiptUrl", "", { shouldDirty: true });
                }}
                namePlaceholder={t("storeOrders.createDialog.fields.receiptName")}
                urlPlaceholder={t("storeOrders.createDialog.fields.receiptUrl")}
                error={receiptError}
              />
            </ModalFieldFullWidth>
          </ModalSection>

          <CreateOperationTotals
            rows={[
              {
                label: t("storeOrders.createDialog.totals.subtotal"),
                value: <MoneyValue value={itemsTotal} currency={currencyCode} />,
              },
              ...(paidAmount > 0
                ? [
                    {
                      label: t("storeOrders.createDialog.totals.paid"),
                      value: <MoneyValue value={paidAmount} currency={currencyCode} />,
                    },
                    {
                      label: t("storeOrders.createDialog.totals.balance"),
                      value: <MoneyValue value={balance} currency={currencyCode} />,
                    },
                  ]
                : []),
              {
                label: t("storeOrders.createDialog.totals.total"),
                value: <MoneyValue value={itemsTotal} currency={currencyCode} />,
                emphasis: "strong" as const,
              },
            ]}
          />
        </CreateOperationLayout>
      </Form>
    </EnterpriseModal>
  );
}
