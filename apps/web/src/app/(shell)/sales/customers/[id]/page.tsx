"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Printer } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { useBreadcrumbLabel } from "@/providers/breadcrumb-provider";
import { EnterpriseButton } from "@/components/ui/button";
import {
  EnterpriseCard,
  EnterpriseCardContent,
  EnterpriseCardHeader,
  EnterpriseCardTitle,
} from "@/components/ui/card";
import { CustomerCard } from "@/components/business/party-card";
import { EntityTabs } from "@/components/business/entity-tabs";
import { SummaryCard } from "@/components/business/summary-card";
import { AuditTimeline, type TimelineEntry } from "@/components/business/timeline";
import { ComingSoon } from "@/components/shared/coming-soon";
import { EmptyState } from "@/components/shared/empty-state";
import { FileText } from "lucide-react";
import { PartyPaymentsPanel } from "@/components/financial-transactions/party-payments-panel";
import { customersService, type CustomerRow } from "@/services/customers-service";
import {
  customerReceiptsService,
  type FinancialTransactionRow,
  type OpenInvoiceRow,
} from "@/services/customer-receipts-service";
import { leadsService, type LeadRow } from "@/services/leads-service";
import type { MasterDataActivityEntry } from "@/services/master-data-service";
import { StatusBadge, type StatusTone } from "@/components/business/status-badge";
import { usePrintEngine } from "@/hooks/use-print-engine";
import { useCompany } from "@/providers/company-provider";
import { useUserContext } from "@/providers/user-context";
import { useLocale } from "@/providers/locale-provider";
import { formatDate, formatDateTime } from "@/lib/date";
import type { DocumentData } from "@/types/document-engine";
import type { MessageKey } from "@/i18n/translate";

const LEAD_STATUS_TONE: Record<LeadRow["status"], StatusTone> = {
  NEW: "info",
  UNDER_FOLLOW_UP: "warning",
  PAID: "success",
  ARCHIVED: "neutral",
};

function formatMoney(value: number) {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border/60 py-2 last:border-b-0">
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{value || "—"}</dd>
    </div>
  );
}

export default function CustomerProfilePage() {
  const params = useParams<{ id: string }>();
  const { t, direction } = useLocale();
  const { printDocument } = usePrintEngine();
  const { activeCompany } = useCompany();
  const { user, hasPermission } = useUserContext();
  const router = useRouter();

  const [customer, setCustomer] = useState<CustomerRow | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activity, setActivity] = useState<MasterDataActivityEntry[] | null>(null);
  const [receipts, setReceipts] = useState<FinancialTransactionRow[]>([]);
  const [isLoadingReceipts, setIsLoadingReceipts] = useState(true);
  const [openInvoices, setOpenInvoices] = useState<OpenInvoiceRow[]>([]);
  const [isLoadingOpenInvoices, setIsLoadingOpenInvoices] = useState(true);
  const [orders, setOrders] = useState<LeadRow[]>([]);
  const [isLoadingOrders, setIsLoadingOrders] = useState(true);

  useBreadcrumbLabel(customer?.name ?? null);

  useEffect(() => {
    const loadCustomer = async () => {
      setIsLoading(true);
      try {
        setCustomer(await customersService.get(params.id));
      } catch {
        setCustomer(null);
      } finally {
        setIsLoading(false);
      }
    };
    void loadCustomer();
  }, [params.id]);

  useEffect(() => {
    customersService
      .activity(params.id)
      .then(setActivity)
      .catch(() => setActivity([]));
  }, [params.id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLoadingReceipts(true);
    customerReceiptsService
      .list({ customerId: params.id, pageSize: 50, sortBy: "transactionDate", sortOrder: "desc" })
      .then((result) => setReceipts(result.items))
      .catch(() => setReceipts([]))
      .finally(() => setIsLoadingReceipts(false));

    setIsLoadingOpenInvoices(true);
    customerReceiptsService
      .openInvoices(params.id)
      .then(setOpenInvoices)
      .catch(() => setOpenInvoices([]))
      .finally(() => setIsLoadingOpenInvoices(false));
  }, [params.id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLoadingOrders(true);
    leadsService
      .list({ customerId: params.id, pageSize: 100 })
      .then((result) => setOrders(result.items))
      .catch(() => setOrders([]))
      .finally(() => setIsLoadingOrders(false));
  }, [params.id]);

  if (isLoading) {
    return <div className="p-8 text-caption text-muted-foreground">{t("common.loading")}</div>;
  }
  if (!customer) {
    return <EmptyState icon={FileText} title={t("common.noResults")} />;
  }

  const creditLimit = customer.creditLimit ? Number(customer.creditLimit) : null;
  const creditAvailable = creditLimit !== null ? creditLimit - customer.balance : null;

  const timelineEntries: TimelineEntry[] = (activity ?? []).map((entry) => ({
    id: entry.id,
    title: entry.description,
    timestamp: formatDateTime(entry.createdAt),
    status: entry.type === "ARCHIVED" ? "rejected" : entry.type === "CREATED" ? "done" : "pending",
  }));

  const handlePrint = () => {
    const data: DocumentData = {
      type: "customer-statement",
      documentNumber: customer.customerNumber,
      documentDate: formatDate(new Date().toISOString()),
      currency: "",
      company: {
        name: activeCompany?.name ?? "",
        addressLines: [],
        branding: {
          logoUrl: activeCompany?.logoUrl ?? null,
          primaryColor: activeCompany?.primaryColor ?? "#0F8A5F",
          secondaryColor: activeCompany?.secondaryColor ?? "#2563EB",
          paperSize: "a4-portrait",
          language: direction === "rtl" ? "rtl" : "ltr",
        },
      },
      party: {
        name: customer.name,
        taxNumber: customer.taxNumber ?? undefined,
        addressLines: [customer.address, customer.city, customer.country?.name].filter(
          (v): v is string => !!v,
        ),
        phone: customer.phone ?? undefined,
        email: customer.email ?? undefined,
      },
      meta: [
        {
          label: t("sales.customers.fields.status"),
          value: t(`common.${customer.status === "ACTIVE" ? "active" : "archived"}`),
        },
      ],
      // Real customer/balance data only — no transaction lines yet (Sales
      // Invoices UI is out of scope for this task; the balance itself is
      // already computed server-side from real confirmed invoices/returns).
      lineItems: [],
      totals: [
        {
          label: t("sales.customers.profile.statistics.balance"),
          value: customer.balance,
          emphasis: true,
        },
      ],
    };
    printDocument({
      variant: "statement",
      title: `${t("sales.customers.title")} — ${customer.name}`,
      printedByName: user?.fullName ?? null,
      data,
      labels: {
        documentNumber: t("sales.customers.fields.customerNumber"),
        documentDate: t("sales.customers.fields.createdAt"),
        billTo: t("sales.customers.picker.selectCustomer"),
        description: t("common.status"),
        quantity: "",
        unitPrice: "",
        lineTotal: t("sales.customers.profile.statistics.balance"),
        notes: t("sales.customers.fields.notes"),
      },
    });
  };

  const comingSoon = <ComingSoon />;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={customer.name}
        subtitle={customer.customerNumber}
        actions={
          <EnterpriseButton
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={handlePrint}
          >
            <Printer className="size-3.5" />
            {t("sales.customers.profile.print")}
          </EnterpriseButton>
        }
      />

      <CustomerCard
        name={customer.name}
        code={customer.customerNumber}
        contact={[customer.phone, customer.email].filter(Boolean).join(" · ")}
        status={t(`common.${customer.status === "ACTIVE" ? "active" : "archived"}` as MessageKey)}
        statusTone={customer.status === "ACTIVE" ? "success" : "neutral"}
      />

      <EntityTabs
        tabs={[
          {
            value: "general",
            label: t("sales.customers.profile.sectionsTab.general"),
            content: (
              <EnterpriseCard>
                <EnterpriseCardHeader>
                  <EnterpriseCardTitle>{t("sales.customers.sections.general")}</EnterpriseCardTitle>
                </EnterpriseCardHeader>
                <EnterpriseCardContent>
                  <dl className="flex flex-col">
                    <InfoRow label={t("sales.customers.fields.name")} value={customer.name} />
                    <InfoRow
                      label={t("sales.customers.fields.commercialName")}
                      value={customer.commercialName ?? ""}
                    />
                    <InfoRow
                      label={t("sales.customers.fields.customerGroup")}
                      value={customer.customerGroup?.name ?? ""}
                    />
                    <InfoRow
                      label={t("sales.customers.fields.source")}
                      value={t(`sales.customers.source.${customer.source}` as MessageKey)}
                    />
                    <InfoRow
                      label={t("sales.customers.fields.createdAt")}
                      value={formatDate(customer.createdAt)}
                    />
                  </dl>
                </EnterpriseCardContent>
              </EnterpriseCard>
            ),
          },
          {
            value: "commercial",
            label: t("sales.customers.profile.sectionsTab.commercial"),
            content: (
              <EnterpriseCard>
                <EnterpriseCardHeader>
                  <EnterpriseCardTitle>
                    {t("sales.customers.sections.commercial")}
                  </EnterpriseCardTitle>
                </EnterpriseCardHeader>
                <EnterpriseCardContent>
                  <dl className="flex flex-col">
                    <InfoRow
                      label={t("sales.customers.fields.taxNumber")}
                      value={customer.taxNumber ?? ""}
                    />
                    <InfoRow
                      label={t("sales.customers.fields.commercialRegistration")}
                      value={customer.commercialRegistration ?? ""}
                    />
                    <InfoRow
                      label={t("sales.customers.fields.paymentTerm")}
                      value={customer.paymentTerm?.name ?? ""}
                    />
                    <InfoRow
                      label={t("sales.customers.fields.creditLimit")}
                      value={creditLimit !== null ? formatMoney(creditLimit) : ""}
                    />
                  </dl>
                </EnterpriseCardContent>
              </EnterpriseCard>
            ),
          },
          {
            value: "addresses",
            label: t("sales.customers.profile.sectionsTab.addresses"),
            content: (
              <EnterpriseCard>
                <EnterpriseCardHeader>
                  <EnterpriseCardTitle>
                    {t("sales.customers.sections.addresses")}
                  </EnterpriseCardTitle>
                </EnterpriseCardHeader>
                <EnterpriseCardContent>
                  <dl className="flex flex-col">
                    <InfoRow
                      label={t("sales.customers.fields.country")}
                      value={customer.country?.name ?? ""}
                    />
                    <InfoRow label={t("sales.customers.fields.city")} value={customer.city ?? ""} />
                    <InfoRow
                      label={t("sales.customers.fields.address")}
                      value={customer.address ?? ""}
                    />
                  </dl>
                </EnterpriseCardContent>
              </EnterpriseCard>
            ),
          },
          {
            value: "contacts",
            label: t("sales.customers.profile.sectionsTab.contacts"),
            content: (
              <EnterpriseCard>
                <EnterpriseCardHeader>
                  <EnterpriseCardTitle>{t("sales.customers.sections.contact")}</EnterpriseCardTitle>
                </EnterpriseCardHeader>
                <EnterpriseCardContent>
                  <dl className="flex flex-col">
                    <InfoRow
                      label={t("sales.customers.fields.phone")}
                      value={customer.phone ?? ""}
                    />
                    <InfoRow
                      label={t("sales.customers.fields.mobile")}
                      value={customer.mobile ?? ""}
                    />
                    <InfoRow
                      label={t("sales.customers.fields.email")}
                      value={customer.email ?? ""}
                    />
                    <InfoRow
                      label={t("sales.customers.fields.website")}
                      value={customer.website ?? ""}
                    />
                  </dl>
                </EnterpriseCardContent>
              </EnterpriseCard>
            ),
          },
          {
            value: "activity",
            label: t("sales.customers.profile.sectionsTab.activity"),
            content:
              activity === null ? (
                <p className="text-caption text-muted-foreground">{t("common.loading")}</p>
              ) : timelineEntries.length === 0 ? (
                <p className="text-caption text-muted-foreground">{t("common.noActivity")}</p>
              ) : (
                <AuditTimeline entries={timelineEntries} />
              ),
          },
          {
            value: "statistics",
            label: t("sales.customers.profile.sectionsTab.statistics"),
            content: (
              <SummaryCard
                title={t("sales.customers.profile.sectionsTab.statistics")}
                rows={[
                  {
                    label: t("sales.customers.profile.statistics.balance"),
                    value: formatMoney(customer.balance),
                  },
                  {
                    label: t("sales.customers.profile.statistics.creditLimit"),
                    value: creditLimit !== null ? formatMoney(creditLimit) : "—",
                  },
                  {
                    label: t("sales.customers.profile.statistics.creditAvailable"),
                    value: creditAvailable !== null ? formatMoney(creditAvailable) : "—",
                    emphasis: true,
                  },
                ]}
              />
            ),
          },
          {
            value: "notes",
            label: t("sales.customers.profile.sectionsTab.notes"),
            content: (
              <EnterpriseCard>
                <EnterpriseCardContent>
                  <p className="whitespace-pre-wrap text-body">{customer.notes || "—"}</p>
                </EnterpriseCardContent>
              </EnterpriseCard>
            ),
          },
          {
            value: "documents",
            label: t("sales.customers.profile.sectionsTab.documents"),
            content: comingSoon,
          },
          {
            value: "quotations",
            label: t("sales.customers.profile.sectionsTab.quotations"),
            content: comingSoon,
          },
          {
            value: "orders",
            label: t("sales.customers.profile.sectionsTab.orders"),
            content: (
              <EnterpriseCard>
                <EnterpriseCardHeader>
                  <EnterpriseCardTitle>{t("crm.leads.customerOrders.title")}</EnterpriseCardTitle>
                </EnterpriseCardHeader>
                <EnterpriseCardContent>
                  {isLoadingOrders ? (
                    <p className="text-caption text-muted-foreground">{t("common.loading")}</p>
                  ) : orders.length === 0 ? (
                    <p className="text-caption text-muted-foreground">
                      {t("crm.leads.customerOrders.empty")}
                    </p>
                  ) : (
                    <div className="flex flex-col">
                      {orders.map((order) => (
                        <button
                          key={order.id}
                          type="button"
                          onClick={() => router.push(`/crm/leads/${order.id}`)}
                          className="flex items-center justify-between gap-4 border-b border-border/60 py-3 text-start last:border-b-0 hover:bg-muted/40"
                        >
                          <div className="flex flex-col gap-0.5">
                            <span className="text-sm font-medium">{order.leadNumber}</span>
                            <span className="text-caption text-muted-foreground">
                              {formatDate(order.createdAt)} · {t("crm.leads.fields.quantity")}:{" "}
                              {order.quantity}
                            </span>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-caption text-muted-foreground">
                              {order.salesEmployee?.fullName ?? "—"}
                            </span>
                            <StatusBadge
                              tone={LEAD_STATUS_TONE[order.status]}
                              label={t(`crm.leads.status.${order.status}` as MessageKey)}
                            />
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </EnterpriseCardContent>
              </EnterpriseCard>
            ),
          },
          {
            value: "invoices",
            label: t("sales.customers.profile.sectionsTab.invoices"),
            content: comingSoon,
          },
          {
            value: "returns",
            label: t("sales.customers.profile.sectionsTab.returns"),
            content: comingSoon,
          },
          {
            value: "payments",
            label: t("sales.customers.profile.sectionsTab.payments"),
            content: (
              <PartyPaymentsPanel
                transactions={receipts}
                isLoadingTransactions={isLoadingReceipts}
                openInvoices={openInvoices}
                isLoadingOpenInvoices={isLoadingOpenInvoices}
                historyTitle={t("sales.receipts.title")}
                outstandingLabel={t("sales.customers.profile.statistics.balance")}
                paidLabel={t("sales.customers.profile.payments.paidAmount")}
                documentHref={(id) => `/sales/payments/${id}`}
                onCreateNew={
                  hasPermission("sales.receipts.create")
                    ? () => router.push(`/sales/payments/new?customerId=${customer.id}`)
                    : undefined
                }
                createLabel={t("sales.receipts.addNew")}
              />
            ),
          },
        ]}
      />
    </div>
  );
}
