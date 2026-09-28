"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Archive, FileText, Pencil, Printer, ScrollText } from "lucide-react";
import {
  DetailField,
  DetailFieldGrid,
  DetailSection,
  DetailWorkspace,
} from "@/components/shared/detail-workspace";
import { HeaderActions } from "@/components/shared/header-actions";
import { useBreadcrumbLabel } from "@/providers/breadcrumb-provider";
import { EntityTabs } from "@/components/business/entity-tabs";
import { AuditTimeline, type TimelineEntry } from "@/components/business/timeline";
import { ComingSoonPanel } from "@/components/shared/coming-soon-page";
import { EmptyState } from "@/components/shared/empty-state";
import { PartyPaymentsPanel } from "@/components/financial-transactions/party-payments-panel";
import { partnersService, type PartnerRow } from "@/services/partners-service";
import {
  customerReceiptsService,
  type FinancialTransactionRow,
  type OpenInvoiceRow,
} from "@/services/customer-receipts-service";
import { leadsService, type LeadRow } from "@/services/leads-service";
import type { MasterDataActivityEntry } from "@/services/master-data-service";
import { StatusBadge } from "@/components/business/status-badge";
import { EnterpriseButton } from "@/components/ui/button";
import { usePartnerStatementPrint } from "@/hooks/use-partner-statement-print";
import { useUserContext } from "@/providers/user-context";
import { useLocale } from "@/providers/locale-provider";
import { formatDate, formatDateTime } from "@/lib/date";
import { SemanticValue } from "@/components/shared/semantic-value";
import { MoneyValue } from "@/components/shared/money-value";
import { toast, reportApiError } from "@/lib/toast";
import type { MessageKey } from "@/i18n/translate";

export default function CustomerProfilePage() {
  const params = useParams<{ id: string }>();
  const { t } = useLocale();
  const { printStatement, isPreparing: isPreparingPrint } = usePartnerStatementPrint("customer");
  const { hasPermission } = useUserContext();
  const router = useRouter();

  const [customer, setCustomer] = useState<PartnerRow | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activity, setActivity] = useState<MasterDataActivityEntry[] | null>(null);
  const [receipts, setReceipts] = useState<FinancialTransactionRow[]>([]);
  const [isLoadingReceipts, setIsLoadingReceipts] = useState(true);
  const [openInvoices, setOpenInvoices] = useState<OpenInvoiceRow[]>([]);
  const [isLoadingOpenInvoices, setIsLoadingOpenInvoices] = useState(true);
  const [orders, setOrders] = useState<LeadRow[]>([]);
  const [isLoadingOrders, setIsLoadingOrders] = useState(true);

  const canEdit = hasPermission("partners.edit");
  const canArchive = hasPermission("partners.archive");

  useBreadcrumbLabel(customer?.name ?? null);

  useEffect(() => {
    const loadCustomer = async () => {
      setIsLoading(true);
      try {
        setCustomer(await partnersService.get(params.id));
      } catch {
        setCustomer(null);
      } finally {
        setIsLoading(false);
      }
    };
    void loadCustomer();
  }, [params.id]);

  useEffect(() => {
    partnersService
      .activity(params.id)
      .then(setActivity)
      .catch(() => setActivity([]));
  }, [params.id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLoadingReceipts(true);
    customerReceiptsService
      .list({ partnerId: params.id, pageSize: 50, sortBy: "transactionDate", sortOrder: "desc" })
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
      .list({ partnerId: params.id, pageSize: 100 })
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

  const creditLimit = customer.customerProfile?.creditLimit
    ? Number(customer.customerProfile.creditLimit)
    : null;
  const creditAvailable = creditLimit !== null ? creditLimit - customer.receivableBalance : null;

  const timelineEntries: TimelineEntry[] = (activity ?? []).map((entry) => ({
    id: entry.id,
    title: entry.description,
    timestamp: formatDateTime(entry.createdAt),
    status: entry.type === "ARCHIVED" ? "rejected" : entry.type === "CREATED" ? "done" : "pending",
  }));

  const handlePrint = () => printStatement(customer);

  const comingSoon = <ComingSoonPanel />;

  const handleArchive = async () => {
    try {
      await partnersService.archive(customer.id);
      toast.success(t("sales.customers.toasts.archived"));
      router.push("/sales/customers");
    } catch (error) {
      reportApiError(error, "common.failedToSave");
    }
  };

  return (
    <DetailWorkspace
      title={customer.name}
      reference={customer.partnerNumber}
      status={
        <StatusBadge
          label={t(`common.${customer.status === "ACTIVE" ? "active" : "archived"}` as MessageKey)}
          tone={customer.status === "ACTIVE" ? "success" : "neutral"}
        />
      }
      actions={
        <HeaderActions
          primary={{
            key: "edit",
            label: t("common.edit"),
            icon: Pencil,
            hidden: !canEdit || !!customer.deletedAt,
            href: `/sales/customers?edit=${customer.id}`,
          }}
          secondary={[
            {
              // The Journal-Entry-based statement (opening, invoices,
              // payments, returns, running and closing balance).
              key: "statement",
              label: t("reports.finance.customerStatement"),
              icon: ScrollText,
              hidden: !hasPermission("reports.financial.view"),
              href: `/reports/customers?partner=${customer.id}`,
            },
            {
              key: "print",
              label: t("sales.customers.profile.print"),
              icon: Printer,
              // The full partner statement is a financial report (same permission).
              hidden: !hasPermission("reports.financial.view"),
              disabled: isPreparingPrint,
              onSelect: handlePrint,
            },
          ]}
          destructive={[
            {
              key: "archive",
              label: t("common.archive"),
              icon: Archive,
              hidden: !canArchive || !!customer.deletedAt,
              confirm: {
                title: t("common.confirmArchiveTitle"),
                description: t("common.confirmArchiveDescription"),
                confirmLabel: t("common.archive"),
              },
              onSelect: handleArchive,
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
                    value={customer.customerProfile?.customerGroup?.name}
                  />
                  <DetailField
                    label={t("sales.customers.fields.source")}
                    value={t(`partners.source.${customer.source}` as MessageKey)}
                  />
                  <DetailField
                    label={t("sales.customers.fields.createdAt")}
                    value={
                      <SemanticValue kind="date">{formatDate(customer.createdAt)}</SemanticValue>
                    }
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
                    value={customer.customerProfile?.paymentTerm?.name}
                  />
                  <DetailField
                    label={t("sales.customers.fields.creditLimit")}
                    value={creditLimit !== null ? <MoneyValue value={creditLimit} /> : undefined}
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
                    value={<MoneyValue value={customer.receivableBalance} />}
                  />
                  <DetailField
                    label={t("sales.customers.profile.statistics.creditLimit")}
                    value={creditLimit !== null ? <MoneyValue value={creditLimit} /> : undefined}
                  />
                  <DetailField
                    label={t("sales.customers.profile.statistics.creditAvailable")}
                    value={
                      creditAvailable !== null ? <MoneyValue value={creditAvailable} /> : undefined
                    }
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
                      <EnterpriseButton
                        key={order.id}
                        type="button"
                        variant="ghost"
                        onClick={() => router.push(`/crm/leads/${order.id}`)}
                        className="h-auto w-full justify-between gap-4 rounded-none border-b border-border py-3 font-normal last:border-b-0"
                      >
                        <div className="flex flex-col gap-0.5 text-start">
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
                            label={order.status?.name ?? "—"}
                            colorKey={order.status?.color}
                          />
                        </div>
                      </EnterpriseButton>
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
                    ? () => router.push(`/sales/payments/new?partnerId=${customer.id}`)
                    : undefined
                }
                createLabel={t("sales.receipts.addNew")}
              />
            ),
          },
        ]}
      />
    </DetailWorkspace>
  );
}
