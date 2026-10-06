"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MasterDataPage } from "@/components/master-data/master-data-page";
import type { MasterDataFormField } from "@/components/master-data/master-data-form";
import { createMasterDataService } from "@/services/master-data-service";
import { paymentSourcesService } from "@/services/payment-sources-service";
import { receivingAccountsService } from "@/services/receiving-accounts-service";
import {
  channelFeeEstimate,
  paymentMethodsColumns,
  paymentMethodsFormFields,
  paymentMethodsSchema,
  paymentMethodsDefaultValues,
  paymentMethodsExportColumns,
  paymentMethodsToFormValues,
  paymentMethodRowLabel,
  paymentSourcesColumns,
  paymentSourcesFormFieldsHead,
  paymentSourcesFormFieldsTail,
  paymentSourcesSchema,
  paymentSourcesDefaultValues,
  paymentSourcesExportColumns,
  paymentSourceRowLabel,
  type PaymentMethodRow,
  type PaymentSourceRow,
} from "@/config/master-data/entities";
import {
  receivingAccountsColumns,
  receivingAccountsFormFields,
  receivingAccountsSchema,
  receivingAccountsDefaultValues,
  receivingAccountsToFormValues,
  receivingAccountsExportColumns,
  receivingAccountRowLabel,
  type ReceivingAccountRow,
} from "@/config/payments/receiving-accounts";
import { useCurrencies, usePaymentMethods } from "@/hooks/use-reference-data";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { reportApiError } from "@/lib/toast";
import type { MessageKey } from "@/i18n/translate";

const methodsService = createMasterDataService<PaymentMethodRow>("/payment-methods");
const channelsService = createMasterDataService<PaymentSourceRow>("/payment-sources");
const receivingService = createMasterDataService<ReceivingAccountRow>("/receiving-accounts");

type AreaTab = "methods" | "channels" | "receiving-accounts";

/** Tab → the view permission that shows it (the route itself opens with any one of them). */
const AREA_TABS: { value: AreaTab; permission: string; labelKey: MessageKey }[] = [
  {
    value: "methods",
    permission: "masterdata.payment-methods.view",
    labelKey: "paymentReconciliation.methodsArea.tabs.methods",
  },
  {
    value: "channels",
    permission: "masterdata.payment-sources.view",
    labelKey: "paymentReconciliation.methodsArea.tabs.channels",
  },
  {
    value: "receiving-accounts",
    permission: "masterdata.receiving-accounts.view",
    labelKey: "paymentReconciliation.methodsArea.tabs.receivingAccounts",
  },
];

/** Methods: clearing account, channel (with its fee estimate), reconciliation flag, active. */
function MethodsTab() {
  const { t } = useLocale();
  const [channelOptions, setChannelOptions] = useState<{ value: string; label: string }[]>([]);

  useEffect(() => {
    let cancelled = false;
    paymentSourcesService
      .list()
      .then((rows) => {
        if (cancelled) return;
        setChannelOptions(
          rows.map((row) => {
            const fee = channelFeeEstimate(row);
            return { value: row.id, label: fee ? `${row.name} · ${fee}` : row.name };
          }),
        );
      })
      .catch((error: unknown) => reportApiError(error, t("common.loadFailed")));
    return () => {
      cancelled = true;
    };
  }, [t]);

  const formFields = useMemo(() => paymentMethodsFormFields(channelOptions), [channelOptions]);

  return (
    <MasterDataPage
      titleKey="paymentReconciliation.methodsArea.title"
      descriptionKey="paymentReconciliation.methodsArea.methodsDescription"
      tableId="payment-methods"
      service={methodsService}
      columns={paymentMethodsColumns}
      exportColumnKeys={paymentMethodsExportColumns}
      formFields={formFields}
      schema={paymentMethodsSchema}
      defaultValues={paymentMethodsDefaultValues}
      toFormValues={paymentMethodsToFormValues}
      permissionPrefix="masterdata.payment-methods"
      rowLabel={paymentMethodRowLabel}
      onRecordsChanged={() => usePaymentMethods.invalidate()}
    />
  );
}

const CHANNEL_FORM_FIELDS: MasterDataFormField[] = [
  ...paymentSourcesFormFieldsHead,
  {
    name: "defaultChartOfAccountId",
    label: "masterData.fields.defaultAccount",
    // Remote, cached account search over the whole chart.
    type: "account",
  },
  ...paymentSourcesFormFieldsTail,
];

/** Channels: the internal "how paid" vocabulary (former Payment Sources) with its fee estimate. */
function ChannelsTab() {
  return (
    <MasterDataPage
      titleKey="paymentReconciliation.methodsArea.channelsTitle"
      descriptionKey="paymentReconciliation.methodsArea.channelsDescription"
      tableId="payment-sources"
      service={channelsService}
      columns={paymentSourcesColumns}
      exportColumnKeys={paymentSourcesExportColumns}
      formFields={CHANNEL_FORM_FIELDS}
      schema={paymentSourcesSchema}
      defaultValues={paymentSourcesDefaultValues}
      permissionPrefix="masterdata.payment-sources"
      rowLabel={paymentSourceRowLabel}
      defaultSortBy="sortOrder"
      onRecordsChanged={() => paymentSourcesService.invalidate()}
    />
  );
}

/** Receiving accounts: bank / cash / wallet destinations (not methods — where the money arrives). */
function ReceivingAccountsTab() {
  const { t } = useLocale();
  const currencies = useCurrencies();
  const formFields = useMemo(
    () =>
      receivingAccountsFormFields(
        currencies.map((currency) => ({
          value: currency.id,
          label: `${currency.code} — ${currency.name}`,
        })),
        t("paymentReconciliation.methodsArea.codeGenerated"),
      ),
    [currencies, t],
  );
  return (
    <MasterDataPage
      titleKey="paymentReconciliation.methodsArea.receivingTitle"
      descriptionKey="paymentReconciliation.methodsArea.receivingDescription"
      tableId="receiving-accounts"
      service={receivingService}
      columns={receivingAccountsColumns}
      exportColumnKeys={receivingAccountsExportColumns}
      formFields={formFields}
      schema={receivingAccountsSchema}
      defaultValues={receivingAccountsDefaultValues}
      toFormValues={receivingAccountsToFormValues}
      permissionPrefix="masterdata.receiving-accounts"
      rowLabel={receivingAccountRowLabel}
      onRecordsChanged={() => receivingAccountsService.invalidate()}
    />
  );
}

/**
 * R13 D1 — the one Payment Methods area: Methods, Channels (former Payment Sources) and Receiving
 * accounts as tabs of one route. `?tab=` deep-links a tab (the old routes redirect here).
 */
export default function PaymentMethodsAreaPage() {
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const tabs = AREA_TABS.filter((tab) => hasPermission(tab.permission));
  const requested = searchParams.get("tab");
  const active = tabs.find((tab) => tab.value === requested)?.value ?? tabs[0]?.value;

  if (!active) return null;

  const selectTab = (value: string) => {
    const params = new URLSearchParams();
    params.set("tab", value);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  return (
    <Tabs value={active} onValueChange={selectTab} className="flex flex-col gap-3">
      <TabsList variant="line" aria-label={t("paymentReconciliation.methodsArea.title")}>
        {tabs.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value}>
            {t(tab.labelKey)}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value="methods">
        <MethodsTab />
      </TabsContent>
      <TabsContent value="channels">
        <ChannelsTab />
      </TabsContent>
      <TabsContent value="receiving-accounts">
        <ReceivingAccountsTab />
      </TabsContent>
    </Tabs>
  );
}
