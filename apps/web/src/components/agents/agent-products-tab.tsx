"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { Link2, Package, Percent, Plus, Unlink } from "lucide-react";
import { DetailSection } from "@/components/shared/detail-workspace";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { EntityCombobox } from "@/components/shared/entity-combobox";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { CreateOperationFooter } from "@/components/shared/create-operation";
import {
  FormCardField,
  FormCardSection,
  FormCardStack,
} from "@/components/shared/form-card/form-card";
import { StackedCell } from "@/components/shared/stacked-cell";
import { SemanticValue } from "@/components/shared/semantic-value";
import { RowActionsMenu } from "@/components/shared/data-table/row-actions-menu";
import { EnterpriseDataTable } from "@/components/master-data/enterprise-data-table";
import { EnterpriseButton } from "@/components/ui/button";
import { StatusBadge } from "@/components/business/status-badge";
import { ProductCommissionSection } from "@/components/products/product-commission-section";
import { ProductModal } from "@/app/(shell)/products/product-modal";
import {
  useAnalyticAccounts,
  useProductBrands,
  useProductCategories,
  useSuppliers,
  useTaxes,
  useUnits,
  useWarehouses,
} from "@/hooks/use-reference-data";
import {
  agentsService,
  type AgentLinkableProduct,
  type AgentProductRow,
  type AgentProductsResult,
} from "@/services/agents-service";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { formatNumber } from "@/lib/format-number";
import { apiErrorMessage, reportApiError, toast } from "@/lib/toast";
import type { MessageKey } from "@/i18n/translate";

const productName = (row: Pick<AgentProductRow, "displayName" | "name">) =>
  row.displayName || row.name;

/**
 * Agent page → Products (spec-2-agent-pricing.md 2A): the agent's products
 * with item type, status and the commission in force (item override or
 * agreement). Link an existing company product, create a new product already
 * owned by the agent, unlink (refused once referenced) and set the item
 * commission — ownership goes through the one product update path.
 */
export function AgentProductsTab({
  agentId,
  agentLabel,
  agentActive,
}: {
  agentId: string;
  agentLabel: string;
  agentActive: boolean;
}) {
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const canLink = hasPermission("agents.edit") && agentActive;
  const canCreate = hasPermission("products.create") && agentActive;
  const canViewCommission = hasPermission("agents.view");
  const [result, setResult] = useState<AgentProductsResult | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [unlinkTarget, setUnlinkTarget] = useState<AgentProductRow | null>(null);
  const [commissionTarget, setCommissionTarget] = useState<AgentProductRow | null>(null);
  const [isUnlinking, setIsUnlinking] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setResult(await agentsService.products.list(agentId));
    } catch (error) {
      setLoadError(apiErrorMessage(error, "errors.loadFailed"));
    }
  }, [agentId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const unlink = async () => {
    if (!unlinkTarget) return;
    setIsUnlinking(true);
    try {
      await agentsService.products.unlink(agentId, unlinkTarget.id);
      toast.success(t("agentPricing.products.unlinked"));
      setUnlinkTarget(null);
      void load();
    } catch (error) {
      // PRODUCT_OWNER_LOCKED carries its readable reason from the API.
      reportApiError(error, "common.failedToSave");
    } finally {
      setIsUnlinking(false);
    }
  };

  const columns = useMemo<ColumnDef<AgentProductRow, unknown>[]>(
    () => [
      {
        id: "product",
        meta: {
          titleKey: "agentPricing.products.columns.product",
          stacked: true,
          type: "name",
          importance: "critical",
          minWidth: 180,
          grow: 2,
        },
        enableSorting: false,
        accessorFn: (row) => `${productName(row)} ${row.sku}`,
        cell: ({ row }) => (
          <StackedCell
            primary={
              <Link href={`/products/${row.original.id}`} className="hover:underline">
                {productName(row.original)}
              </Link>
            }
            secondary={<SemanticValue kind="id">{row.original.sku}</SemanticValue>}
          />
        ),
      },
      {
        id: "itemType",
        meta: {
          titleKey: "agentPricing.products.columns.itemType",
          type: "default",
          importance: "high",
        },
        enableSorting: false,
        accessorFn: (row) => row.itemType ?? "UNSET",
        cell: ({ row }) =>
          row.original.itemType ? (
            t(`agentPricing.products.itemTypeValue.${row.original.itemType}`)
          ) : (
            <StatusBadge label={t("agentPricing.products.itemTypeValue.UNSET")} tone="warning" />
          ),
      },
      {
        id: "status",
        meta: {
          titleKey: "agentPricing.products.columns.status",
          type: "status",
          importance: "medium",
        },
        enableSorting: false,
        accessorFn: (row) => row.status,
        cell: ({ row }) => (
          <StatusBadge
            label={t(`products.status.${row.original.status}` as MessageKey)}
            tone={row.original.status === "ACTIVE" ? "success" : "neutral"}
          />
        ),
      },
      {
        id: "commission",
        meta: { titleKey: "agentPricing.products.columns.commission", importance: "high" },
        enableSorting: false,
        accessorFn: (row) => row.commission.ratePercent ?? "",
        cell: ({ row }) => {
          const commission = row.original.commission;
          if (commission.ratePercent == null) {
            return (
              <StatusBadge
                label={t(
                  `agentPricing.products.missing.${commission.missing ?? "AGENT_COMMISSION_RATE_MISSING"}` as MessageKey,
                )}
                tone="warning"
              />
            );
          }
          return (
            <StackedCell
              primary={
                <SemanticValue kind="number">
                  {`${formatNumber(commission.ratePercent, { maxDecimals: 4 })}%`}
                </SemanticValue>
              }
              secondary={
                commission.source
                  ? t(`agentPricing.products.commissionSource.${commission.source}`)
                  : undefined
              }
            />
          );
        },
      },
      {
        id: "__actions",
        meta: { titleKey: "common.actions", importance: "critical" },
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => (
          <RowActionsMenu
            label={t("common.actions")}
            actions={[
              {
                key: "commission",
                label: t("agentPricing.products.commissionAction"),
                icon: Percent,
                hidden: !canViewCommission,
                onSelect: () => setCommissionTarget(row.original),
              },
              {
                key: "unlink",
                label: t("agentPricing.products.unlink"),
                icon: Unlink,
                hidden: !hasPermission("agents.edit"),
                destructive: true,
                separatorBefore: true,
                onSelect: () => setUnlinkTarget(row.original),
              },
            ]}
          />
        ),
      },
    ],
    [t, canViewCommission, hasPermission],
  );

  if (loadError) return <ErrorState description={loadError} onRetry={() => void load()} />;
  if (!result) return null;

  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      {canLink ? (
        <EnterpriseButton
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setLinkOpen(true)}
        >
          <Link2 />
          {t("agentPricing.products.link")}
        </EnterpriseButton>
      ) : null}
      {canCreate ? (
        <EnterpriseButton type="button" size="sm" onClick={() => setNewOpen(true)}>
          <Plus />
          {t("agentPricing.products.newProduct")}
        </EnterpriseButton>
      ) : null}
    </div>
  );

  return (
    <div className="flex flex-col gap-3">
      <DetailSection title={t("agentPricing.products.title")} actions={actions}>
        <p className="text-caption text-muted-foreground">
          {t("agentPricing.products.description")}
          {result.agreement ? ` · ${result.agreement.agreementNumber}` : ""}
        </p>
        {result.items.length === 0 ? (
          <EmptyState
            icon={Package}
            title={t("agentPricing.products.empty")}
            description={t("agentPricing.products.emptyHint")}
            action={actions}
          />
        ) : (
          <EnterpriseDataTable
            tableId="agent-products"
            printTitle={`${t("agentPricing.products.title")} — ${agentLabel}`}
            columns={columns}
            data={result.items}
            getRowId={(row) => row.id}
            onRefresh={() => void load()}
            emptyTitle={t("agentPricing.products.empty")}
          />
        )}
      </DetailSection>

      {linkOpen ? (
        <LinkProductDialog
          agentId={agentId}
          agentLabel={agentLabel}
          onOpenChange={setLinkOpen}
          onLinked={() => void load()}
        />
      ) : null}

      {newOpen ? (
        <AgentNewProductModal
          agentId={agentId}
          onOpenChange={setNewOpen}
          onSaved={() => void load()}
        />
      ) : null}

      {commissionTarget ? (
        <EnterpriseModal
          open
          onOpenChange={(open) => {
            if (!open) {
              setCommissionTarget(null);
              void load();
            }
          }}
          size="lg"
          title={t("agentPricing.products.commissionTitle", {
            product: productName(commissionTarget),
          })}
          description={agentLabel}
          footer={
            <EnterpriseButton
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setCommissionTarget(null);
                void load();
              }}
            >
              {t("common.close")}
            </EnterpriseButton>
          }
        >
          <ProductCommissionSection productId={commissionTarget.id} />
        </EnterpriseModal>
      ) : null}

      <ConfirmationDialog
        open={!!unlinkTarget}
        onOpenChange={(open) => !open && setUnlinkTarget(null)}
        tone="destructive"
        title={t("agentPricing.products.unlinkTitle")}
        description={
          unlinkTarget
            ? t("agentPricing.products.unlinkDescription", { product: productName(unlinkTarget) })
            : undefined
        }
        confirmLabel={t("agentPricing.products.unlink")}
        isConfirming={isUnlinking}
        onConfirm={() => void unlink()}
      />
    </div>
  );
}

/** Pick a company-owned product (server search) and link it to the agent. */
function LinkProductDialog({
  agentId,
  agentLabel,
  onOpenChange,
  onLinked,
}: {
  agentId: string;
  agentLabel: string;
  onOpenChange: (open: boolean) => void;
  onLinked: () => void;
}) {
  const { t } = useLocale();
  const [product, setProduct] = useState<AgentLinkableProduct | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const search = useCallback(
    (query: string) => agentsService.products.linkable(agentId, query),
    [agentId],
  );

  const submit = async () => {
    if (!product) {
      setShowErrors(true);
      return;
    }
    setIsSaving(true);
    try {
      await agentsService.products.link(agentId, product.id);
      toast.success(t("agentPricing.products.linked"));
      onLinked();
      onOpenChange(false);
    } catch (error) {
      reportApiError(error, "common.failedToSave");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <EnterpriseModal
      open
      onOpenChange={onOpenChange}
      size="md"
      layout="form-card"
      title={t("agentPricing.products.linkTitle")}
      description={agentLabel}
      isDirty={!!product}
      footer={(requestClose) => (
        <CreateOperationFooter
          requestClose={requestClose}
          onSubmit={() => void submit()}
          isSubmitting={isSaving}
          submitLabel={t("agentPricing.products.linkAction")}
        />
      )}
    >
      <FormCardStack>
        <FormCardSection title={t("agentPricing.products.linkTitle")}>
          <p className="text-caption text-muted-foreground">
            {t("agentPricing.products.linkDescription")}
          </p>
          <FormCardField
            required
            label={t("agentPricing.products.columns.product")}
            htmlFor="agent-link-product"
          >
            <EntityCombobox<AgentLinkableProduct>
              id="agent-link-product"
              value={product}
              onChange={setProduct}
              onSearch={search}
              getId={(item) => item.id}
              getTitle={(item) => productName(item)}
              getSubtitle={(item) => item.sku}
              subtitleDir="ltr"
              placeholder={t("agentPricing.products.linkSearch")}
              searchPlaceholder={t("agentPricing.products.linkSearch")}
              noMatchText={t("agentPricing.products.linkEmpty")}
              emptyText={t("agentPricing.products.linkEmpty")}
              error={showErrors && !product}
            />
          </FormCardField>
        </FormCardSection>
      </FormCardStack>
    </EnterpriseModal>
  );
}

/** The shared product editor, opened with Ownership = Agent preselected. */
function AgentNewProductModal({
  agentId,
  onOpenChange,
  onSaved,
}: {
  agentId: string;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const categories = useProductCategories();
  const brands = useProductBrands();
  const units = useUnits();
  const taxes = useTaxes();
  const analyticAccounts = useAnalyticAccounts();
  const suppliers = useSuppliers();
  const warehouses = useWarehouses();
  return (
    <ProductModal
      open
      onOpenChange={onOpenChange}
      icon={Package}
      editingProduct={null}
      duplicateSource={null}
      categories={categories}
      brands={brands}
      units={units}
      taxes={taxes}
      analyticAccounts={analyticAccounts}
      suppliers={suppliers}
      warehouses={warehouses}
      onSaved={onSaved}
      onCategoryCreated={(category) => useProductCategories.add(category)}
      initialOwnerAgentId={agentId}
    />
  );
}
