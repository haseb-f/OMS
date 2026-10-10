"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Copy, Pencil, Plus, PowerOff, Trash2, Truck } from "lucide-react";
import { DetailField, DetailFieldGrid, DetailSection } from "@/components/shared/detail-workspace";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { HeaderActions } from "@/components/shared/header-actions";
import {
  CompactDetailTable,
  type CompactDetailColumn,
} from "@/components/shared/data-table/compact-detail-table";
import { StatusBadge } from "@/components/business/status-badge";
import { EnterpriseButton } from "@/components/ui/button";
import { tableIdentityCellClass } from "@/components/ui/table";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { addDays, formatDate, formatDateTime, toISODate } from "@/lib/date";
import { ltrIsolate } from "@/lib/bidi";
import { apiErrorMessage, reportApiError, reportDestructiveDone, toast } from "@/lib/toast";
import type { MessageKey } from "@/i18n/translate";
import { localizedApiMessage } from "@/config/orders/agent-order-entry";
import {
  shippingAgreementsApi,
  type ShippingAgreementActivity,
  type ShippingAgreementDetail,
  type ShippingAgreementList,
  type ShippingAgreementListItem,
} from "./shipping-agreements-api";
import {
  SHIPPING_AGREEMENT_STATUS_TONE,
  activePhase,
  agreementPeriod,
  defaultSelectedAgreement,
} from "./shipping-agreement-view";
import { ShippingCoverageTable } from "./shipping-coverage-table";
import { ShippingAgreementEditorDialog } from "./shipping-agreement-editor-dialog";
import {
  ActivateShippingAgreementDialog,
  DeactivateShippingAgreementDialog,
} from "./shipping-agreement-dialogs";

const PHASE_LABEL = {
  IN_FORCE: "agentShippingAgreements.inForceToday",
  SCHEDULED: "agentShippingAgreements.scheduled",
  ENDED: "agentShippingAgreements.ended",
} as const;

/**
 * Agent → Settings → Shipping agreement (R15 D15-13): the agreement shown
 * (in force today by default) with its service × destination charges and
 * its actions — New / Duplicate / Edit draft / Activate / Deactivate /
 * Discard draft — and the history of every agreement of the agent. Reads
 * need `agents.view` (the page), changes `agents.agreements.manage`; every
 * rule (overlap, coverage, immutability) is enforced by the API.
 */
export function ShippingAgreementSection({
  agentId,
  currencyCode,
}: {
  agentId: string;
  /** The agent's settlement currency — every shipping agreement is in it. */
  currencyCode: string;
}) {
  const { t, locale } = useLocale();
  const { hasPermission } = useUserContext();
  const canManage = hasPermission("agents.agreements.manage");
  const [list, setList] = useState<ShippingAgreementList | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<ShippingAgreementDetail | null>(null);
  const [editor, setEditor] = useState<{ draft: ShippingAgreementDetail | null } | null>(null);
  const [dialog, setDialog] = useState<"activate" | "deactivate" | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const today = toISODate(new Date());
  const openEnded = t("agentShippingAgreements.openEnded");

  /** Reloads the history; `select` = the agreement to show (else keep / default). */
  const load = useCallback(
    async (select?: string) => {
      setLoadError(null);
      try {
        const next = await shippingAgreementsApi.list(agentId);
        setList(next);
        setSelectedId((current) => {
          const wanted = select ?? current;
          return wanted && next.items.some((item) => item.id === wanted)
            ? wanted
            : defaultSelectedAgreement(next);
        });
      } catch (error) {
        setLoadError(apiErrorMessage(error, "errors.loadFailed"));
      }
    },
    [agentId],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    shippingAgreementsApi
      .get(agentId, selectedId)
      .then((next) => !cancelled && setLoaded(next))
      .catch((error: unknown) => reportApiError(error, "errors.loadFailed"));
    return () => {
      cancelled = true;
    };
  }, [agentId, selectedId]);

  /** After a change: the history and the shown agreement reflect it at once. */
  const changed = (agreement: ShippingAgreementDetail) => {
    setLoaded(agreement);
    void load(agreement.id);
  };

  const run = async (action: () => Promise<void>) => {
    setIsBusy(true);
    try {
      await action();
      setDialog(null);
    } catch (error) {
      reportApiError(error, "errors.generic");
    } finally {
      setIsBusy(false);
    }
  };

  const duplicate = (source: ShippingAgreementDetail) =>
    run(async () => {
      const copy = await shippingAgreementsApi.duplicate(agentId, source.id);
      changed(copy);
      toast.success(
        t("agentShippingAgreements.toasts.duplicated", {
          number: copy.agreementNumber,
          source: source.agreementNumber,
        }),
      );
      setEditor({ draft: copy });
    });

  const activate = (draft: ShippingAgreementDetail, replaceFrom: boolean) =>
    run(async () => {
      const replaced = replaceFrom ? (draft.activation?.overlapping[0] ?? null) : null;
      changed(await shippingAgreementsApi.activate(agentId, draft.id, replaceFrom));
      toast.success(
        replaced && draft.activation?.replaceCloses
          ? t("agentShippingAgreements.toasts.replaced", {
              number: draft.agreementNumber,
              previous: replaced.agreementNumber,
              closes: formatDate(draft.activation.replaceCloses),
            })
          : t("agentShippingAgreements.toasts.activated", { number: draft.agreementNumber }),
      );
    });

  const deactivate = (agreement: ShippingAgreementDetail, reason: string) =>
    run(async () => {
      changed(await shippingAgreementsApi.deactivate(agentId, agreement.id, reason));
      reportDestructiveDone(
        t("agentShippingAgreements.toasts.deactivated", { number: agreement.agreementNumber }),
      );
    });

  const discard = async (draft: ShippingAgreementDetail) => {
    try {
      await shippingAgreementsApi.discard(agentId, draft.id);
      reportDestructiveDone(
        t("agentShippingAgreements.toasts.discarded", { number: draft.agreementNumber }),
      );
      setSelectedId(null);
      void load();
    } catch (error) {
      reportApiError(error, "errors.generic");
    }
  };

  if (loadError) return <ErrorState description={loadError} onRetry={() => void load()} />;
  if (!list) return null;

  // The selected agreement once its detail has arrived (never a stale one).
  const detail = loaded && loaded.id === selectedId ? loaded : null;

  const isDraft = detail?.status === "DRAFT";
  const phase = detail ? activePhase(detail, today) : null;
  const userLine = (user: { fullName: string } | null, at: string | null) =>
    user ? `${user.fullName}${at ? ` · ${ltrIsolate(formatDate(at))}` : ""}` : null;

  const historyColumns: CompactDetailColumn<ShippingAgreementListItem>[] = [
    {
      id: "number",
      header: t("agentShippingAgreements.number"),
      cell: (row) =>
        row.id === selectedId ? (
          <span className={`num ${tableIdentityCellClass}`}>{row.agreementNumber}</span>
        ) : (
          <EnterpriseButton
            type="button"
            variant="link"
            size="inline"
            className="num"
            onClick={() => setSelectedId(row.id)}
          >
            {row.agreementNumber}
          </EnterpriseButton>
        ),
    },
    {
      id: "period",
      header: t("agentShippingAgreements.period"),
      cell: (row) => <span className="num">{agreementPeriod(row, openEnded)}</span>,
    },
    {
      id: "status",
      header: t("common.status"),
      cell: (row) => {
        const rowPhase = activePhase(row, today);
        return (
          <span className="flex flex-wrap items-center gap-1">
            <StatusBadge
              label={t(`agentShippingAgreements.status.${row.status}`)}
              tone={SHIPPING_AGREEMENT_STATUS_TONE[row.status]}
            />
            {rowPhase && rowPhase !== "IN_FORCE" ? (
              <span className="text-caption text-muted-foreground">{t(PHASE_LABEL[rowPhase])}</span>
            ) : null}
          </span>
        );
      },
    },
    {
      id: "charges",
      header: t("agentShippingAgreements.charges"),
      align: "end",
      cell: (row) => <span className="num">{row.rateCount}</span>,
    },
    {
      id: "supersededBy",
      header: t("agentShippingAgreements.supersededBy"),
      cell: (row) => <span className="num">{row.supersededBy?.agreementNumber ?? "—"}</span>,
    },
  ];

  const activityColumns: CompactDetailColumn<ShippingAgreementActivity>[] = [
    {
      id: "when",
      header: t("agentShippingAgreements.activity.when"),
      cell: (row) => <span className="num">{formatDateTime(row.createdAt)}</span>,
    },
    {
      id: "event",
      header: t("agentShippingAgreements.activity.event"),
      cell: (row) => {
        const key = `agentShippingAgreements.activity.types.${row.type}` as MessageKey;
        const label = t(key);
        return label === key ? row.type : label;
      },
    },
    {
      id: "by",
      header: t("agentShippingAgreements.activity.by"),
      cell: (row) => row.user?.fullName ?? "—",
    },
    {
      id: "details",
      header: t("agentShippingAgreements.activity.details"),
      cell: (row) => (
        // Stored bilingual ("العربية — English"): only the UI-language half is shown (rows
        // written before R15 are English only and read as they are).
        <span dir="auto" className="text-caption text-muted-foreground">
          {localizedApiMessage(row.description, locale)}
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <DetailSection
        title={t("agentShippingAgreements.title")}
        actions={
          canManage ? (
            <EnterpriseButton type="button" size="sm" onClick={() => setEditor({ draft: null })}>
              <Plus />
              {t("agentShippingAgreements.new")}
            </EnterpriseButton>
          ) : null
        }
      >
        {list.items.length === 0 ? (
          <EmptyState
            icon={Truck}
            title={t("agentShippingAgreements.empty")}
            description={t("agentShippingAgreements.emptyDescription")}
          />
        ) : detail ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className={`num ${tableIdentityCellClass}`}>{detail.agreementNumber}</span>
                <StatusBadge
                  label={t(`agentShippingAgreements.status.${detail.status}`)}
                  tone={SHIPPING_AGREEMENT_STATUS_TONE[detail.status]}
                />
                {phase ? (
                  <StatusBadge
                    label={t(PHASE_LABEL[phase])}
                    tone={phase === "IN_FORCE" ? "info" : "neutral"}
                  />
                ) : null}
              </div>
              {canManage ? (
                <HeaderActions
                  primary={{
                    key: "activate",
                    label: t("agentShippingAgreements.actions.activate"),
                    icon: CheckCircle2,
                    variant: "success",
                    hidden: !isDraft,
                    onSelect: () => setDialog("activate"),
                  }}
                  secondary={[
                    {
                      key: "edit",
                      label: t("agentShippingAgreements.actions.edit"),
                      icon: Pencil,
                      hidden: !isDraft,
                      onSelect: () => setEditor({ draft: detail }),
                    },
                    {
                      key: "duplicate",
                      label: t("agentShippingAgreements.actions.duplicate"),
                      icon: Copy,
                      loading: isBusy,
                      onSelect: () => duplicate(detail),
                    },
                  ]}
                  destructive={[
                    {
                      key: "discard",
                      label: t("agentShippingAgreements.actions.discard"),
                      icon: Trash2,
                      hidden: !isDraft,
                      onSelect: () => discard(detail),
                      confirm: {
                        title: t("agentShippingAgreements.discard.title", {
                          number: detail.agreementNumber,
                        }),
                        description: t("agentShippingAgreements.discard.description"),
                        confirmLabel: t("agentShippingAgreements.actions.discard"),
                      },
                    },
                    {
                      key: "deactivate",
                      label: t("agentShippingAgreements.actions.deactivate"),
                      icon: PowerOff,
                      hidden: detail.status !== "ACTIVE",
                      onSelect: () => setDialog("deactivate"),
                    },
                  ]}
                />
              ) : null}
            </div>
            <DetailFieldGrid columns={4}>
              <DetailField
                label={t("agentShippingAgreements.period")}
                value={<span className="num">{agreementPeriod(detail, openEnded)}</span>}
              />
              <DetailField
                label={t("agentShippingAgreements.currency")}
                value={detail.currency.code}
              />
              <DetailField
                label={t("agentShippingAgreements.createdBy")}
                value={userLine(detail.createdByUser, detail.createdAt)}
              />
              <DetailField
                label={t("agentShippingAgreements.activatedBy")}
                value={userLine(detail.activatedByUser, detail.activatedAt)}
              />
              {detail.supersedes ? (
                <DetailField
                  label={t("agentShippingAgreements.supersedes")}
                  value={<span className="num">{detail.supersedes.agreementNumber}</span>}
                />
              ) : null}
              {detail.supersededBy ? (
                <DetailField
                  label={t("agentShippingAgreements.supersededBy")}
                  value={<span className="num">{detail.supersededBy.agreementNumber}</span>}
                />
              ) : null}
              {detail.status === "INACTIVE" ? (
                <>
                  <DetailField
                    label={t("agentShippingAgreements.deactivatedBy")}
                    value={userLine(detail.deactivatedByUser, detail.deactivatedAt)}
                  />
                  <DetailField
                    label={t("agentShippingAgreements.reason")}
                    value={detail.deactivationReason}
                  />
                </>
              ) : null}
              {detail.notes ? (
                <DetailField label={t("agentShippingAgreements.notes")} value={detail.notes} />
              ) : null}
            </DetailFieldGrid>
            {detail.rates.length > 0 ? (
              <p
                className={
                  detail.coverage.complete
                    ? "text-caption text-muted-foreground"
                    : "text-caption text-warning-soft-foreground"
                }
              >
                {detail.coverage.complete
                  ? t("agentShippingAgreements.coverageComplete")
                  : t("agentShippingAgreements.coverageMissing", {
                      count: detail.coverage.missing.length,
                    })}
              </p>
            ) : null}
            <ShippingCoverageTable
              destinations={detail.coverage.destinations}
              currency={detail.currency.code}
            />
          </>
        ) : null}
      </DetailSection>

      {list.items.length > 0 ? (
        <DetailSection title={t("agentShippingAgreements.history")}>
          <CompactDetailTable
            columns={historyColumns}
            rows={list.items}
            rowKey={(row) => row.id}
            stacked
          />
        </DetailSection>
      ) : null}

      {detail && detail.activity.length > 0 ? (
        <DetailSection
          title={`${t("agentShippingAgreements.activity.title")} · ${detail.agreementNumber}`}
        >
          <CompactDetailTable
            columns={activityColumns}
            rows={detail.activity}
            rowKey={(row) => row.id}
            stacked
          />
        </DetailSection>
      ) : null}

      {editor ? (
        <ShippingAgreementEditorDialog
          agentId={agentId}
          currencyCode={currencyCode}
          draft={editor.draft}
          // A first agreement starts today; a new version from tomorrow (replace from).
          defaultFrom={list.inForceId ? toISODate(addDays(new Date(), 1)) : today}
          onOpenChange={(open) => !open && setEditor(null)}
          onChanged={changed}
        />
      ) : null}
      {detail && dialog === "activate" ? (
        <ActivateShippingAgreementDialog
          agreement={detail}
          isBusy={isBusy}
          onOpenChange={(open) => !open && setDialog(null)}
          onConfirm={(replaceFrom) => void activate(detail, replaceFrom)}
        />
      ) : null}
      {detail && dialog === "deactivate" ? (
        <DeactivateShippingAgreementDialog
          agreement={detail}
          isBusy={isBusy}
          onOpenChange={(open) => !open && setDialog(null)}
          onConfirm={(reason) => void deactivate(detail, reason)}
        />
      ) : null}
    </div>
  );
}
