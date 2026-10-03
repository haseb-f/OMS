"use client";

import { useState } from "react";
import Link from "next/link";
import {
  CircleOff,
  Clock,
  Hand,
  Repeat,
  Settings2,
  TriangleAlert,
  Users,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { DismissibleAlert } from "@/components/shared/dismissible-alert";
import { StatusBadge } from "@/components/business/status-badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Spinner } from "@/components/ui/spinner";
import type {
  LeadDistributionState,
  RuntimeStatus,
} from "@/components/crm/lead-distribution-control";
import {
  DISTRIBUTION_MODES,
  MODE_KEY,
  canConfirmDistribution,
  describeDistributionControl,
  describeDistributionResult,
  isAutoMode,
  previewDistributionMode,
  type DistributionButtonTone,
} from "@/components/crm/lead-distribution-logic";
import type { StatusTone } from "@/components/business/status-tone";
import { LeadDistributionPool } from "@/components/crm/lead-distribution-pool";
import { useLocale } from "@/providers/locale-provider";
import { formatDateTime } from "@/lib/date";
import { cn } from "@/lib/utils";

const MODE_ICON: Record<RuntimeStatus, LucideIcon> = {
  CONTINUOUS: Repeat,
  TIME_LIMITED: Clock,
  MANUAL: Hand,
  PAUSED: CircleOff,
};

/** Solid status surface per tone — Button variants for green/amber; red is the solid destructive token pair. */
const BUTTON_VARIANT: Record<DistributionButtonTone, "success" | "warning" | "destructive"> = {
  success: "success",
  warning: "warning",
  destructive: "destructive",
};

/**
 * R6 spec C3 — the ONE lead distribution control: a solid status button
 * (green active · amber paused/manual · red blocked) that always names the
 * state and the pending count; `onOpen` shows `LeadDistributionDialog`.
 * The page owns the dialog, outside the list that remounts after a
 * distribution changes, so the confirmed result stays on screen. Only
 * `crm.leads.manage` sees it (`state.canManage`).
 */
export function LeadDistributionStatusButton({
  state,
  onOpen,
}: {
  state: LeadDistributionState;
  onOpen: () => void;
}) {
  const { t } = useLocale();
  if (!state.canManage) return null;

  // No snapshot yet: claim no state and do not open the dialog.
  if (state.loading) {
    return (
      <EnterpriseButton
        type="button"
        size="sm"
        variant="outline"
        disabled
        aria-busy
        data-testid="lead-distribution-control"
        data-state-tone="loading"
      >
        <Spinner className="size-3.5" />
        {t("leadOps.distribution.button.loading")}
      </EnterpriseButton>
    );
  }
  // The snapshot could not be read: say so, offer a retry.
  if (state.loadFailed || !state.snapshot) {
    return (
      <EnterpriseButton
        type="button"
        size="sm"
        variant="destructive"
        data-testid="lead-distribution-control"
        data-state-tone="error"
        onClick={() => void state.refresh()}
      >
        <TriangleAlert aria-hidden className="size-3.5" />
        {t("leadOps.distribution.button.unavailable")}
        <span className="font-normal">· {t("leadOps.distribution.button.retry")}</span>
      </EnterpriseButton>
    );
  }

  const d = describeDistributionControl(state.snapshot, state.status);
  const StateIcon = d.blocked ? TriangleAlert : MODE_ICON[state.status];
  const label = d.blocked
    ? t("leadOps.distribution.button.blocked")
    : d.running
      ? d.expiresAt
        ? t("leadOps.distribution.button.activeUntil", { time: formatDateTime(d.expiresAt) })
        : t("leadOps.distribution.button.active")
      : state.status === "MANUAL"
        ? t("leadOps.distribution.button.manual")
        : t("leadOps.distribution.button.paused");

  return (
    <EnterpriseButton
      type="button"
      size="sm"
      variant={BUTTON_VARIANT[d.tone]}
      disabled={state.busy}
      aria-busy={state.busy || undefined}
      aria-haspopup="dialog"
      data-testid="lead-distribution-control"
      data-state-tone={d.tone}
      // The destructive variant is the soft red; a blocked state is solid red.
      className={cn(
        "max-w-full min-w-0",
        d.tone === "destructive" &&
          "border-transparent bg-destructive text-destructive-foreground not-disabled:hover:bg-destructive/90",
      )}
      onClick={onOpen}
    >
      {state.busy ? (
        <Spinner className="size-3.5" />
      ) : (
        <StateIcon aria-hidden className="size-3.5" />
      )}
      <span className="truncate">{state.busy ? t("leadOps.distribution.button.busy") : label}</span>
      {!state.busy ? (
        <span className="num font-normal opacity-90">
          · {t("leadOps.distribution.button.pending", { count: d.pendingCount })}
        </span>
      ) : null}
    </EnterpriseButton>
  );
}

interface DistributionResultView {
  text: string;
  tone: StatusTone;
  failureCode: string | null;
}

/**
 * Mode picker. Selecting a mode is a preview only; Confirm calls the
 * existing activate endpoint once (save + drain for the automatic modes)
 * and shows the server-confirmed result. Cancel sends nothing.
 */
export function LeadDistributionDialog({
  open,
  onOpenChange,
  state,
  onOpenTools,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: LeadDistributionState;
  onOpenTools: () => void;
}) {
  const { t } = useLocale();
  const [selected, setSelected] = useState<RuntimeStatus>(state.status);
  const [result, setResult] = useState<DistributionResultView | null>(null);
  const [wasOpen, setWasOpen] = useState(open);
  // Each opening starts from the applied mode with no stale result.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setSelected(state.status);
      setResult(null);
    }
  }

  const d = describeDistributionControl(state.snapshot, state.status);
  const preview = previewDistributionMode(state.status, selected, d.eligibleCount);
  const canConfirm = canConfirmDistribution(state.status, selected, state.busy);
  const modeLabel = (mode: RuntimeStatus) =>
    t(`crm.leads.distribution.control.modes.${MODE_KEY[mode]}`);

  const previewText =
    preview === "unchanged"
      ? t("leadOps.distribution.dialog.previewUnchanged")
      : preview === "autoNoEligible"
        ? t("leadOps.distribution.dialog.previewNoEligible")
        : preview === "manual"
          ? t("leadOps.distribution.dialog.previewManual")
          : preview === "paused"
            ? t("leadOps.distribution.dialog.previewPaused")
            : preview === "autoRerun"
              ? t("leadOps.distribution.dialog.previewAutoRerun", { pending: d.pendingCount })
              : t("leadOps.distribution.dialog.previewAuto", {
                  pending: d.pendingCount,
                  eligible: d.eligibleCount,
                });

  const confirm = async () => {
    if (!canConfirm) return;
    const mode = selected;
    setResult(null);
    const outcome = await state.applyMode(mode);
    if (!outcome) return; // reportApiError already explained the failure
    const pendingAfter = outcome.snapshot.pendingEligibleCount ?? 0;
    const heldAfter = outcome.snapshot.held?.count ?? 0;
    const { kind, tone } = describeDistributionResult(outcome.run, pendingAfter);
    const until =
      mode === "TIME_LIMITED" && outcome.snapshot.policy?.expiresAt
        ? ` ${t("leadOps.distribution.dialog.resultActiveUntil", {
            time: formatDateTime(outcome.snapshot.policy.expiresAt),
          })}`
        : "";
    const text =
      kind === "saved"
        ? t("leadOps.distribution.dialog.resultNoAuto", { mode: modeLabel(mode) })
        : kind === "alreadyRunning"
          ? t("crm.leads.distribution.control.resultAlreadyRunning")
          : kind === "blocked"
            ? t("leadOps.distribution.dialog.resultFailed", {
                code: outcome.run?.failureCode ?? "—",
                reason:
                  outcome.run?.failureCode === "NO_ELIGIBLE_EMPLOYEES"
                    ? t("crm.leads.distribution.control.noEligible")
                    : (outcome.run?.failureReason ?? ""),
              })
            : kind === "nothing"
              ? t("crm.leads.distribution.control.resultNothing")
              : t("leadOps.distribution.dialog.resultAssigned", {
                  assigned: outcome.run?.assigned ?? 0,
                  pending: pendingAfter,
                  held: heldAfter,
                });
    setResult({
      text: `${text}${until}`,
      tone,
      failureCode: kind === "blocked" ? (outcome.run?.failureCode ?? null) : null,
    });
    setSelected(mode);
  };

  const showFixLinks = result?.failureCode === "NO_ELIGIBLE_EMPLOYEES" || (!result && d.emptyPool);

  return (
    <EnterpriseModal
      open={open}
      onOpenChange={(next) => {
        // A running confirm finishes before the dialog can close.
        if (!next && state.busy) return;
        onOpenChange(next);
      }}
      size="sm"
      title={t("leadOps.distribution.dialog.title")}
      description={t("leadOps.distribution.dialog.description")}
      testId="lead-distribution-dialog"
      footer={(requestClose) => (
        <>
          <EnterpriseButton
            type="button"
            variant="outline"
            disabled={state.busy}
            onClick={requestClose}
          >
            {result ? t("leadOps.distribution.dialog.close") : t("common.cancel")}
          </EnterpriseButton>
          <EnterpriseButton
            type="button"
            disabled={!canConfirm}
            isLoading={state.busy}
            data-testid="lead-distribution-confirm"
            onClick={() => void confirm()}
          >
            {state.busy
              ? isAutoMode(selected)
                ? t("leadOps.distribution.dialog.running")
                : t("leadOps.distribution.dialog.saving")
              : isAutoMode(selected)
                ? t("leadOps.distribution.dialog.confirmRun")
                : t("leadOps.distribution.dialog.confirm")}
          </EnterpriseButton>
        </>
      )}
    >
      <div className="flex flex-col gap-3">
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 rounded-sm border border-border bg-surface-sunken px-3 py-2.5 text-caption">
          <div className="col-span-2 flex min-w-0 flex-wrap items-center gap-1.5">
            <dt className="text-muted-foreground">{t("leadOps.distribution.dialog.current")}</dt>
            <dd>
              <StatusBadge tone={d.tone} label={modeLabel(state.status)} />
            </dd>
            {d.expiresAt ? (
              <dd className="text-muted-foreground">
                {t("crm.leads.distribution.control.activeUntil", {
                  time: formatDateTime(d.expiresAt),
                })}
              </dd>
            ) : null}
          </div>
          <div className="flex min-w-0 flex-col">
            <dt className="text-muted-foreground">{t("leadOps.distribution.dialog.eligible")}</dt>
            <dd className="num font-medium text-foreground" data-testid="distribution-eligible">
              {d.eligibleCount}
            </dd>
          </div>
          <div className="flex min-w-0 flex-col">
            <dt className="text-muted-foreground">{t("leadOps.distribution.dialog.pending")}</dt>
            <dd className="num font-medium text-foreground">
              {d.pendingCount}
              {d.heldCount > 0 ? (
                <span className="font-normal text-muted-foreground">
                  {" "}
                  · {t("leadOps.distribution.dialog.held")} {d.heldCount}
                </span>
              ) : null}
            </dd>
          </div>
          <div className="col-span-2 flex min-w-0 flex-col">
            <dt className="text-muted-foreground">{t("leadOps.distribution.dialog.scope")}</dt>
            <dd className="text-foreground">
              {d.teamName
                ? t("leadOps.distribution.dialog.scopeTeam", { name: d.teamName })
                : t("leadOps.distribution.dialog.scopeCompany")}
            </dd>
          </div>
        </dl>

        <LeadDistributionPool snapshot={state.snapshot} />

        <RadioGroup
          value={selected}
          onValueChange={(value) => {
            setSelected(value as RuntimeStatus);
            setResult(null);
          }}
          aria-label={t("leadOps.distribution.dialog.modes")}
          disabled={state.busy}
          className="gap-1"
        >
          {DISTRIBUTION_MODES.map((mode) => {
            const Icon = MODE_ICON[mode];
            const id = `lead-distribution-mode-${MODE_KEY[mode]}`;
            return (
              <label
                key={mode}
                htmlFor={id}
                className={cn(
                  "flex cursor-pointer items-start gap-2.5 rounded-sm border px-2.5 py-2",
                  selected === mode
                    ? "border-primary bg-(--control-pressed)"
                    : "border-border not-has-disabled:hover:bg-(--control-hover)",
                )}
              >
                <RadioGroupItem id={id} value={mode} className="mt-0.5" />
                <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex flex-wrap items-center gap-1.5 text-body font-medium">
                    {modeLabel(mode)}
                    {mode === state.status ? (
                      <StatusBadge
                        tone="neutral"
                        label={t("leadOps.distribution.dialog.currentTag")}
                      />
                    ) : null}
                  </span>
                  <span className="text-caption text-muted-foreground">
                    {t(`crm.leads.distribution.control.modeHints.${MODE_KEY[mode]}`)}
                  </span>
                </span>
              </label>
            );
          })}
        </RadioGroup>

        <p
          className="text-caption text-muted-foreground"
          data-testid="lead-distribution-preview"
          data-preview={preview}
        >
          {previewText}
          {selected === "TIME_LIMITED" && preview !== "autoNoEligible" ? (
            <> {t("leadOps.distribution.dialog.previewHours")}</>
          ) : null}
        </p>

        {result ? (
          <DismissibleAlert tone={result.tone} live dismissible={false}>
            <span data-testid="lead-distribution-result">{result.text}</span>
          </DismissibleAlert>
        ) : d.blocked && d.failureReason ? (
          <DismissibleAlert tone="destructive" dismissible={false}>
            {d.emptyPool ? t("crm.leads.distribution.control.noEligible") : d.failureReason}
          </DismissibleAlert>
        ) : null}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {showFixLinks ? (
            <>
              <EnterpriseButton asChild variant="link" size="inline">
                <Link href="/settings/users">
                  <Users />
                  {t("crm.leads.distribution.control.fixUsers")}
                </Link>
              </EnterpriseButton>
              <EnterpriseButton asChild variant="link" size="inline">
                <Link href="/crm/sales-teams">
                  <UsersRound />
                  {t("crm.leads.distribution.control.fixTeams")}
                </Link>
              </EnterpriseButton>
            </>
          ) : null}
          <EnterpriseButton
            type="button"
            variant="link"
            size="inline"
            disabled={state.busy}
            onClick={onOpenTools}
          >
            <Settings2 />
            {t("crm.leads.distribution.control.manualTools")}
          </EnterpriseButton>
        </div>
      </div>
    </EnterpriseModal>
  );
}
