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
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { RowActionsMenu } from "@/components/shared/data-table";
import { useBreadcrumbLabel } from "@/providers/breadcrumb-provider";
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
import { StatusBadge } from "@/components/business/status-badge";
import { usePrintEngine } from "@/hooks/use-print-engine";
import { useCompany } from "@/providers/company-provider";
import { useUserContext } from "@/providers/user-context";
import { useLocale } from "@/providers/locale-provider";
import { formatDate, formatDateTime } from "@/lib/date";
import type { DocumentData } from "@/types/document-engine";
import { ApiError } from "@/services/api-client";
import { toast } from "@/lib/toast";
import type { MessageKey } from "@/i18n/translate";

function formatMoney(value: number) {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const canEdit = hasPermission("purchasing.suppliers.edit");
  const canArchive = hasPermission("purchasing.suppliers.archive");

  useBreadcrumbLabel(supplier?.name ?? null);

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
    return (
      <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-2">
        <p className="text-caption text-muted-foreground">{t("common.loading")}</p>
      </div>
    );
  }
  if (!supplier) {
    return (
      <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-2">
        <EmptyState icon={FileText} title={t("common.noResults")} />
      </div>
    );
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

  const handleArchive = async () => {
    setIsArchiving(true);
    try {
      await suppliersService.archive(supplier.id);
      toast.success(t("common.archive"));
      setArchiveOpen(false);
      router.push("/purchasing/suppliers");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.loadFailed"));
    } finally {
      setIsArchiving(false);
    }
  };

  return (
    <DetailWorkspace
      title={supplier.name}
      subtitle={supplier.supplierNumber}
      status={
        <StatusBadge
          label={t(`common.${supplier.status === "ACTIVE" ? "active" : "archived"}` as MessageKey)}
          tone={supplier.status === "ACTIVE" ? "success" : "neutral"}
        />
      }
      actions={
        <RowActionsMenu
          label={t("common.actions")}
          actions={[
            {
              key: "print",
              label: t("purchasing.suppliers.profile.print"),
              icon: Printer,
              onSelect: handlePrint,
            },
            {
              key: "edit",
              label: t("common.edit"),
              icon: Pencil,
              hidden: !canEdit || !!supplier.deletedAt,
              onSelect: () => router.push(`/purchasing/suppliers?edit=${supplier.id}`),
            },
            {
              key: "archive",
              label: t("common.archive"),
              icon: Archive,
              hidden: !canArchive || !!supplier.deletedAt,
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
            label: t("purchasing.suppliers.profile.sectionsTab.general"),
            content: (
              <DetailSection>
                <DetailFieldGrid>
                  <DetailField
                    label={t("purchasing.suppliers.fields.code")}
                    value={supplier.code}
                  />
                  <DetailField
                    label={t("purchasing.suppliers.fields.commercialName")}
                    value={supplier.commercialName}
                  />
                  <DetailField
                    label={t("purchasing.suppliers.fields.createdAt")}
                    value={formatDate(supplier.createdAt)}
                  />
                </DetailFieldGrid>
              </DetailSection>
            ),
          },
          {
            value: "commercial",
            label: t("purchasing.suppliers.profile.sectionsTab.commercial"),
            content: (
              <DetailSection>
                <DetailFieldGrid>
                  <DetailField
                    label={t("purchasing.suppliers.fields.taxNumber")}
                    value={supplier.taxNumber}
                  />
                  <DetailField
                    label={t("purchasing.suppliers.fields.commercialRegistration")}
                    value={supplier.commercialRegistration}
                  />
                  <DetailField
                    label={t("purchasing.suppliers.fields.currency")}
                    value={supplier.currency?.name}
                  />
                  <DetailField
                    label={t("purchasing.suppliers.fields.paymentTerm")}
                    value={supplier.paymentTerm}
                  />
                  <DetailField
                    label={t("purchasing.suppliers.fields.creditLimit")}
                    value={creditLimit !== null ? formatMoney(creditLimit) : undefined}
                  />
                  <DetailField
                    label={t("purchasing.suppliers.fields.supplierGroup")}
                    value={supplier.supplierGroup?.name}
                  />
                </DetailFieldGrid>
              </DetailSection>
            ),
          },
          {
            value: "addresses",
            label: t("purchasing.suppliers.profile.sectionsTab.addresses"),
            content: (
              <DetailSection>
                <DetailFieldGrid>
                  <DetailField
                    label={t("purchasing.suppliers.fields.country")}
                    value={supplier.country?.name}
                  />
                  <DetailField
                    label={t("purchasing.suppliers.fields.city")}
                    value={supplier.city}
                  />
                  <DetailField
                    label={t("purchasing.suppliers.fields.address")}
                    value={supplier.address}
                  />
                  <DetailField
                    label={t("purchasing.suppliers.fields.phone")}
                    value={supplier.phone}
                  />
                  <DetailField
                    label={t("purchasing.suppliers.fields.mobile")}
                    value={supplier.mobile}
                  />
                  <DetailField
                    label={t("purchasing.suppliers.fields.email")}
                    value={supplier.email}
                  />
                  <DetailField
                    label={t("purchasing.suppliers.fields.website")}
                    value={supplier.website}
                  />
                </DetailFieldGrid>
              </DetailSection>
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
            content: supplier.notes ? (
              <DetailSection>
                <p className="whitespace-pre-wrap text-body">{supplier.notes}</p>
              </DetailSection>
            ) : (
              <p className="text-caption text-muted-foreground">{t("common.noDataAvailable")}</p>
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
