"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Printer, FileText } from "lucide-react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { PageHeader } from "@/components/shared/page-header";
import { EnterpriseButton } from "@/components/ui/button";
import {
  EnterpriseCard,
  EnterpriseCardContent,
  EnterpriseCardHeader,
  EnterpriseCardTitle,
} from "@/components/ui/card";
import { SupplierCard } from "@/components/business/party-card";
import { EntityTabs } from "@/components/business/entity-tabs";
import { AuditTimeline, type TimelineEntry } from "@/components/business/timeline";
import { EmptyState } from "@/components/shared/empty-state";
import { PartyPaymentsPanel } from "@/components/financial-transactions/party-payments-panel";
import { suppliersService, type SupplierRow } from "@/services/suppliers-service";
import {
  supplierPaymentsService,
  type FinancialTransactionRow,
  type OpenInvoiceRow,
} from "@/services/supplier-payments-service";
import type { MasterDataActivityEntry } from "@/services/master-data-service";
import { usePrintEngine } from "@/hooks/use-print-engine";
import { useCompany } from "@/providers/company-provider";
import { useUserContext } from "@/providers/user-context";
import { useLocale } from "@/providers/locale-provider";
import { formatDate, formatDateTime } from "@/lib/date";
import type { DocumentData } from "@/types/document-engine";
import type { MessageKey } from "@/i18n/translate";

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

/** Mirrors `sales/customers/[id]/page.tsx` (TASK-048) — bespoke Profile page, not `MasterDataPage`'s built-in quick-preview sheet. */
export default function SupplierProfilePage() {
  const params = useParams<{ id: string }>();
  const { t, direction } = useLocale();
  const { printDocument } = usePrintEngine();
  const { activeCompany } = useCompany();
  const { user, hasPermission } = useUserContext();
  const router = useRouter();

  const [supplier, setSupplier] = useState<SupplierRow | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activity, setActivity] = useState<MasterDataActivityEntry[] | null>(null);
  const [payments, setPayments] = useState<FinancialTransactionRow[]>([]);
  const [isLoadingPayments, setIsLoadingPayments] = useState(true);
  const [openInvoices, setOpenInvoices] = useState<OpenInvoiceRow[]>([]);
  const [isLoadingOpenInvoices, setIsLoadingOpenInvoices] = useState(true);

  useEffect(() => {
    const loadSupplier = async () => {
      setIsLoading(true);
      try {
        setSupplier(await suppliersService.get(params.id));
      } catch {
        setSupplier(null);
      } finally {
        setIsLoading(false);
      }
    };
    void loadSupplier();
  }, [params.id]);

  useEffect(() => {
    suppliersService
      .activity(params.id)
      .then(setActivity)
      .catch(() => setActivity([]));
  }, [params.id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLoadingPayments(true);
    supplierPaymentsService
      .list({ supplierId: params.id, pageSize: 50, sortBy: "transactionDate", sortOrder: "desc" })
      .then((result) => setPayments(result.items))
      .catch(() => setPayments([]))
      .finally(() => setIsLoadingPayments(false));

    setIsLoadingOpenInvoices(true);
    supplierPaymentsService
      .openInvoices(params.id)
      .then(setOpenInvoices)
      .catch(() => setOpenInvoices([]))
      .finally(() => setIsLoadingOpenInvoices(false));
  }, [params.id]);

  if (isLoading) {
    return <div className="p-8 text-caption text-muted-foreground">{t("common.loading")}</div>;
  }
  if (!supplier) {
    return <EmptyState icon={FileText} title={t("common.noResults")} />;
  }

  const creditLimit = supplier.creditLimit ? Number(supplier.creditLimit) : null;

  const timelineEntries: TimelineEntry[] = (activity ?? []).map((entry) => ({
    id: entry.id,
    title: entry.description,
    timestamp: formatDateTime(entry.createdAt),
    status: entry.type.includes("ARCHIVED")
      ? "rejected"
      : entry.type.includes("CREATED")
        ? "done"
        : "pending",
  }));

  const handlePrint = () => {
    const data: DocumentData = {
      type: "supplier-statement",
      documentNumber: supplier.supplierNumber,
      documentDate: formatDate(new Date().toISOString()),
      currency: supplier.currency?.code ?? "",
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
        name: supplier.name,
        taxNumber: supplier.taxNumber ?? undefined,
        addressLines: [supplier.address, supplier.city, supplier.country?.name].filter(
          (v): v is string => !!v,
        ),
        phone: supplier.phone ?? undefined,
        email: supplier.email ?? undefined,
      },
      meta: [
        {
          label: t("purchasing.suppliers.fields.status"),
          value: t(`common.${supplier.status === "ACTIVE" ? "active" : "archived"}`),
        },
      ],
      // Real supplier data only — no transaction lines here (Purchase
      // Invoice/Return list-by-supplier UI is out of this task's scope).
      lineItems: [],
      totals:
        creditLimit !== null
          ? [
              {
                label: t("purchasing.suppliers.fields.creditLimit"),
                value: creditLimit,
                emphasis: true,
              },
            ]
          : [],
    };
    printDocument({
      variant: "statement",
      title: `${t("purchasing.suppliers.title")} — ${supplier.name}`,
      printedByName: user?.fullName ?? null,
      data,
      labels: {
        documentNumber: t("purchasing.suppliers.fields.supplierNumber"),
        documentDate: t("purchasing.suppliers.fields.createdAt"),
        billTo: t("purchasing.suppliers.picker.selectSupplier"),
        description: t("common.status"),
        quantity: "",
        unitPrice: "",
        lineTotal: t("purchasing.suppliers.fields.creditLimit"),
        notes: t("purchasing.suppliers.fields.notes"),
      },
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/purchasing/suppliers">
              {t("purchasing.suppliers.title")}
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{supplier.name}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <PageHeader
        title={supplier.name}
        subtitle={supplier.supplierNumber}
        actions={
          <EnterpriseButton
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={handlePrint}
          >
            <Printer className="size-3.5" />
            {t("purchasing.suppliers.profile.print")}
          </EnterpriseButton>
        }
      />

      <SupplierCard
        name={supplier.name}
        code={supplier.supplierNumber}
        contact={[supplier.phone, supplier.email].filter(Boolean).join(" · ")}
        status={t(`common.${supplier.status === "ACTIVE" ? "active" : "archived"}` as MessageKey)}
        statusTone={supplier.status === "ACTIVE" ? "success" : "neutral"}
      />

      <EntityTabs
        tabs={[
          {
            value: "general",
            label: t("purchasing.suppliers.profile.sectionsTab.general"),
            content: (
              <EnterpriseCard>
                <EnterpriseCardHeader>
                  <EnterpriseCardTitle>
                    {t("purchasing.suppliers.sections.general")}
                  </EnterpriseCardTitle>
                </EnterpriseCardHeader>
                <EnterpriseCardContent>
                  <dl className="flex flex-col">
                    <InfoRow label={t("purchasing.suppliers.fields.code")} value={supplier.code} />
                    <InfoRow label={t("purchasing.suppliers.fields.name")} value={supplier.name} />
                    <InfoRow
                      label={t("purchasing.suppliers.fields.commercialName")}
                      value={supplier.commercialName ?? ""}
                    />
                    <InfoRow
                      label={t("purchasing.suppliers.fields.createdAt")}
                      value={formatDate(supplier.createdAt)}
                    />
                  </dl>
                </EnterpriseCardContent>
              </EnterpriseCard>
            ),
          },
          {
            value: "commercial",
            label: t("purchasing.suppliers.profile.sectionsTab.commercial"),
            content: (
              <EnterpriseCard>
                <EnterpriseCardHeader>
                  <EnterpriseCardTitle>
                    {t("purchasing.suppliers.sections.commercial")}
                  </EnterpriseCardTitle>
                </EnterpriseCardHeader>
                <EnterpriseCardContent>
                  <dl className="flex flex-col">
                    <InfoRow
                      label={t("purchasing.suppliers.fields.taxNumber")}
                      value={supplier.taxNumber ?? ""}
                    />
                    <InfoRow
                      label={t("purchasing.suppliers.fields.commercialRegistration")}
                      value={supplier.commercialRegistration ?? ""}
                    />
                    <InfoRow
                      label={t("purchasing.suppliers.fields.currency")}
                      value={supplier.currency?.name ?? ""}
                    />
                    <InfoRow
                      label={t("purchasing.suppliers.fields.paymentTerm")}
                      value={supplier.paymentTerm ?? ""}
                    />
                    <InfoRow
                      label={t("purchasing.suppliers.fields.creditLimit")}
                      value={creditLimit !== null ? formatMoney(creditLimit) : ""}
                    />
                  </dl>
                </EnterpriseCardContent>
              </EnterpriseCard>
            ),
          },
          {
            value: "addresses",
            label: t("purchasing.suppliers.profile.sectionsTab.addresses"),
            content: (
              <EnterpriseCard>
                <EnterpriseCardHeader>
                  <EnterpriseCardTitle>
                    {t("purchasing.suppliers.sections.addresses")}
                  </EnterpriseCardTitle>
                </EnterpriseCardHeader>
                <EnterpriseCardContent>
                  <dl className="flex flex-col">
                    <InfoRow
                      label={t("purchasing.suppliers.fields.country")}
                      value={supplier.country?.name ?? ""}
                    />
                    <InfoRow
                      label={t("purchasing.suppliers.fields.city")}
                      value={supplier.city ?? ""}
                    />
                    <InfoRow
                      label={t("purchasing.suppliers.fields.address")}
                      value={supplier.address ?? ""}
                    />
                    <InfoRow
                      label={t("purchasing.suppliers.fields.phone")}
                      value={supplier.phone ?? ""}
                    />
                    <InfoRow
                      label={t("purchasing.suppliers.fields.mobile")}
                      value={supplier.mobile ?? ""}
                    />
                    <InfoRow
                      label={t("purchasing.suppliers.fields.email")}
                      value={supplier.email ?? ""}
                    />
                    <InfoRow
                      label={t("purchasing.suppliers.fields.website")}
                      value={supplier.website ?? ""}
                    />
                  </dl>
                </EnterpriseCardContent>
              </EnterpriseCard>
            ),
          },
          {
            value: "activity",
            label: t("purchasing.suppliers.profile.sectionsTab.activity"),
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
            value: "notes",
            label: t("purchasing.suppliers.profile.sectionsTab.notes"),
            content: (
              <EnterpriseCard>
                <EnterpriseCardContent>
                  <p className="whitespace-pre-wrap text-body">{supplier.notes || "—"}</p>
                </EnterpriseCardContent>
              </EnterpriseCard>
            ),
          },
          {
            value: "payments",
            label: t("purchasing.suppliers.profile.sectionsTab.payments"),
            content: (
              <PartyPaymentsPanel
                transactions={payments}
                isLoadingTransactions={isLoadingPayments}
                openInvoices={openInvoices}
                isLoadingOpenInvoices={isLoadingOpenInvoices}
                historyTitle={t("purchasing.payments.title")}
                outstandingLabel={t("purchasing.suppliers.profile.payments.outstandingPayables")}
                paidLabel={t("purchasing.suppliers.profile.payments.paidAmount")}
                documentHref={(id) => `/purchasing/payments/${id}`}
                onCreateNew={
                  hasPermission("purchasing.payments.create")
                    ? () => router.push(`/purchasing/payments/new?supplierId=${supplier.id}`)
                    : undefined
                }
                createLabel={t("purchasing.payments.addNew")}
              />
            ),
          },
        ]}
      />
    </div>
  );
}
