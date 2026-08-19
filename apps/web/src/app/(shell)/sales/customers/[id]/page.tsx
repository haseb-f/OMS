"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Archive, FileText, Pencil, Printer } from "lucide-react";
import {
  DetailField,
  DetailFieldGrid,
  DetailSection,
  DetailWorkspace,
} from "@/components/shared/detail-workspace";
import { RowActionsMenu } from "@/components/shared/data-table";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { useBreadcrumbLabel } from "@/providers/breadcrumb-provider";
import { EntityTabs } from "@/components/business/entity-tabs";
import { AuditTimeline, type TimelineEntry } from "@/components/business/timeline";
import { ComingSoon } from "@/components/shared/coming-soon";
import { EmptyState } from "@/components/shared/empty-state";
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
import { ApiError } from "@/services/api-client";
import { toast } from "@/lib/toast";
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
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);

  const canEdit = hasPermission("sales.customers.edit");
  const canArchive = hasPermission("sales.customers.archive");

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
    return (
      <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-2">
        <p className="text-caption text-muted-foreground">{t("common.loading")}</p>
      </div>
    );
  }
  if (!customer) {
    return (
      <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-2">
        <EmptyState icon={FileText} title={t("common.noResults")} />
      </div>
    );
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

  const handleArchive = async () => {
    setIsArchiving(true);
    try {
      await customersService.archive(customer.id);
      toast.success(t("common.archive"));
      setArchiveOpen(false);
      router.push("/sales/customers");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.loadFailed"));
    } finally {
      setIsArchiving(false);
    }
  };

  return (
    <DetailWorkspace
      title={customer.name}
      subtitle={customer.customerNumber}
      status={
        <StatusBadge
          label={t(`common.${customer.status === "ACTIVE" ? "active" : "archived"}` as MessageKey)}
          tone={customer.status === "ACTIVE" ? "success" : "neutral"}
        />
      }
      actions={
        <RowActionsMenu
          label={t("common.actions")}
          actions={[
            {
              key: "print",
              label: t("sales.customers.profile.print"),
              icon: Printer,
              onSelect: handlePrint,
            },
            {
              key: "edit",
              label: t("common.edit"),
              icon: Pencil,
              hidden: !canEdit || !!customer.deletedAt,
              onSelect: () => router.push(`/sales/customers?edit=${customer.id}`),
            },
            {
              key: "archive",
              label: t("common.archive"),
              icon: Archive,
              hidden: !canArchive || !!customer.deletedAt,
              destructive: true,
              separatorBefore: true,
              onSelect: () => setArchiveOpen(true),
            },
          ]}
        />
      }
    >
      <EntityTabs
        tabs={[
          {
            value: "general",
            label: t("sales.customers.profile.sectionsTab.general"),
            content: (
              <DetailSection>
                <DetailFieldGrid>
                  <DetailField
                    label={t("sales.customers.fields.commercialName")}
                    value={customer.commercialName}
                  />
                  <DetailField
                    label={t("sales.customers.fields.customerGroup")}
                    value={customer.customerGroup?.name}
                  />
                  <DetailField
                    label={t("sales.customers.fields.source")}
                    value={t(`sales.customers.source.${customer.source}` as MessageKey)}
                  />
                  <DetailField
                    label={t("sales.customers.fields.createdAt")}
                    value={formatDate(customer.createdAt)}
                  />
                </DetailFieldGrid>
              </DetailSection>
            ),
          },
          {
            value: "commercial",
            label: t("sales.customers.profile.sectionsTab.commercial"),
            content: (
              <DetailSection>
                <DetailFieldGrid>
                  <DetailField
                    label={t("sales.customers.fields.taxNumber")}
                    value={customer.taxNumber}
                  />
                  <DetailField
                    label={t("sales.customers.fields.commercialRegistration")}
                    value={customer.commercialRegistration}
                  />
                  <DetailField
                    label={t("sales.customers.fields.paymentTerm")}
                    value={customer.paymentTerm?.name}
                  />
                  <DetailField
                    label={t("sales.customers.fields.creditLimit")}
                    value={creditLimit !== null ? formatMoney(creditLimit) : undefined}
                  />
                </DetailFieldGrid>
              </DetailSection>
            ),
          },
          {
            value: "addresses",
            label: t("sales.customers.profile.sectionsTab.addresses"),
            content: (
              <DetailSection>
                <DetailFieldGrid>
                  <DetailField
                    label={t("sales.customers.fields.country")}
                    value={customer.country?.name}
                  />
                  <DetailField label={t("sales.customers.fields.city")} value={customer.city} />
                  <DetailField
                    label={t("sales.customers.fields.address")}
                    value={customer.address}
                  />
                </DetailFieldGrid>
              </DetailSection>
            ),
          },
          {
            value: "contacts",
            label: t("sales.customers.profile.sectionsTab.contacts"),
            content: (
              <DetailSection>
                <DetailFieldGrid>
                  <DetailField label={t("sales.customers.fields.phone")} value={customer.phone} />
                  <DetailField label={t("sales.customers.fields.mobile")} value={customer.mobile} />
                  <DetailField label={t("sales.customers.fields.email")} value={customer.email} />
                  <DetailField
                    label={t("sales.customers.fields.website")}
                    value={customer.website}
                  />
                </DetailFieldGrid>
              </DetailSection>
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
              <DetailSection>
                <DetailFieldGrid columns={3}>
                  <DetailField
                    label={t("sales.customers.profile.statistics.balance")}
                    value={formatMoney(customer.balance)}
                  />
                  <DetailField
                    label={t("sales.customers.profile.statistics.creditLimit")}
                    value={creditLimit !== null ? formatMoney(creditLimit) : undefined}
                  />
                  <DetailField
                    label={t("sales.customers.profile.statistics.creditAvailable")}
                    value={creditAvailable !== null ? formatMoney(creditAvailable) : undefined}
                  />
                </DetailFieldGrid>
              </DetailSection>
            ),
          },
          {
            value: "notes",
            label: t("sales.customers.profile.sectionsTab.notes"),
            content: customer.notes ? (
              <DetailSection>
                <p className="whitespace-pre-wrap text-body">{customer.notes}</p>
              </DetailSection>
            ) : (
              <p className="text-caption text-muted-foreground">{t("common.noDataAvailable")}</p>
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
              <DetailSection>
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
                        className="flex items-center justify-between gap-4 border-b border-border py-3 text-start last:border-b-0 hover:bg-muted/40"
                      >
                        <div className="flex flex-col gap-0.5">
                          <span className="text-sm font-medium">{order.leadNumber}</span>
                          <span className="text-caption text-muted-foreground">
                            {formatDate(order.createdAt)} · {order.quantity}
                          </span>
                        </div>
                        <div className="flex items-center gap-3">
                          {order.salesEmployee?.fullName ? (
                            <span className="text-caption text-muted-foreground">
                              {order.salesEmployee.fullName}
                            </span>
                          ) : null}
                          <StatusBadge
                            tone={LEAD_STATUS_TONE[order.status]}
                            label={t(`crm.leads.status.${order.status}` as MessageKey)}
                          />
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </DetailSection>
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

      <ConfirmationDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        tone="destructive"
        title={t("common.confirmArchiveTitle")}
        description={t("common.confirmArchiveDescription")}
        confirmLabel={t("common.archive")}
        cancelLabel={t("common.cancel")}
        isConfirming={isArchiving}
        onConfirm={() => void handleArchive()}
      />
    </DetailWorkspace>
  );
}
