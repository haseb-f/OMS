"use client";

import { useCallback, useEffect, useState } from "react";
import { KeyRound } from "lucide-react";
import { DetailSection } from "@/components/shared/detail-workspace";
import { EmptyState } from "@/components/shared/empty-state";
import { EnterpriseButton } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { StatusBadge } from "@/components/business/status-badge";
import { investorsService, type InvestorPortalStatus } from "@/services/investors-service";
import { useLocale } from "@/providers/locale-provider";
import { formatDateTime } from "@/lib/date";
import { toast, reportApiError } from "@/lib/toast";
import type { MessageKey } from "@/i18n/translate";

const STATUS_TONE: Record<string, "success" | "neutral" | "warning" | "destructive"> = {
  INVITED: "neutral",
  ACTIVE: "success",
  SUSPENDED: "warning",
  DISABLED: "destructive",
};

/** Investor Engine Milestone 4, Part J — Admin management of an Investor's Portal access, from the Investor Details page. */
export function PortalAccessSection({
  investorId,
  canView,
  canInvite,
  canManage,
}: {
  investorId: string;
  canView: boolean;
  canInvite: boolean;
  canManage: boolean;
}) {
  const { t } = useLocale();
  const [status, setStatus] = useState<InvestorPortalStatus | null>(null);
  const [confirmAction, setConfirmAction] = useState<"suspend" | "disable" | null>(null);
  const [isActing, setIsActing] = useState(false);

  const load = useCallback(async () => {
    const result = await investorsService.portal.status(investorId);
    setStatus(result);
  }, [investorId]);

  useEffect(() => {
    if (canView) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void load();
    }
  }, [canView, load]);

  if (!canView) return null;

  const run = async (action: () => Promise<InvestorPortalStatus>, successMessage: string) => {
    setIsActing(true);
    try {
      const result = await action();
      setStatus(result);
      toast.success(successMessage);
    } catch (error) {
      reportApiError(error, t("errors.SERVER_ERROR"));
    } finally {
      setIsActing(false);
      setConfirmAction(null);
    }
  };

  return (
    <DetailSection title={t("investorPortal.admin.sectionTitle")}>
      {!status || !status.hasAccount ? (
        <EmptyState
          icon={KeyRound}
          title={t("investorPortal.admin.noAccount")}
          action={
            canInvite ? (
              <EnterpriseButton
                size="sm"
                isLoading={isActing}
                onClick={() =>
                  void run(
                    () => investorsService.portal.invite(investorId),
                    t("investorPortal.admin.toasts.invited"),
                  )
                }
              >
                {t("investorPortal.admin.actions.invite")}
              </EnterpriseButton>
            ) : undefined
          }
        />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <div className="text-caption text-muted-foreground">
                {t("investorPortal.admin.fields.email")}
              </div>
              <div className="mt-1 font-medium text-foreground">{status.email}</div>
            </div>
            <div>
              <div className="text-caption text-muted-foreground">
                {t("investorPortal.admin.fields.status")}
              </div>
              <div className="mt-1">
                <StatusBadge
                  label={t(`investorPortal.accountStatus.${status.status}` as MessageKey)}
                  tone={STATUS_TONE[status.status]}
                />
              </div>
            </div>
            <div>
              <div className="text-caption text-muted-foreground">
                {t("investorPortal.admin.fields.lastLoginAt")}
              </div>
              <div className="mt-1 font-medium text-foreground">
                {status.lastLoginAt ? formatDateTime(status.lastLoginAt) : "—"}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {status.status === "INVITED" && canInvite && (
              <EnterpriseButton
                size="sm"
                variant="outline"
                isLoading={isActing}
                onClick={() =>
                  void run(
                    () => investorsService.portal.resendInvite(investorId),
                    t("investorPortal.admin.toasts.resent"),
                  )
                }
              >
                {t("investorPortal.admin.actions.resendInvite")}
              </EnterpriseButton>
            )}
            {status.status === "ACTIVE" && canManage && (
              <EnterpriseButton
                size="sm"
                variant="outline"
                onClick={() => setConfirmAction("suspend")}
              >
                {t("investorPortal.admin.actions.suspend")}
              </EnterpriseButton>
            )}
            {status.status === "SUSPENDED" && canManage && (
              <EnterpriseButton
                size="sm"
                variant="outline"
                isLoading={isActing}
                onClick={() =>
                  void run(
                    () => investorsService.portal.reactivate(investorId),
                    t("investorPortal.admin.toasts.reactivated"),
                  )
                }
              >
                {t("investorPortal.admin.actions.reactivate")}
              </EnterpriseButton>
            )}
            {(status.status === "ACTIVE" || status.status === "SUSPENDED") && canManage && (
              <EnterpriseButton
                size="sm"
                variant="destructive"
                onClick={() => setConfirmAction("disable")}
              >
                {t("investorPortal.admin.actions.disable")}
              </EnterpriseButton>
            )}
          </div>
        </div>
      )}

      <ConfirmationDialog
        open={confirmAction === "suspend"}
        onOpenChange={(open) => !open && setConfirmAction(null)}
        title={t("investorPortal.admin.confirm.suspendTitle")}
        description={t("investorPortal.admin.confirm.suspendDescription")}
        tone="destructive"
        isConfirming={isActing}
        onConfirm={() =>
          void run(
            () => investorsService.portal.suspend(investorId),
            t("investorPortal.admin.toasts.suspended"),
          )
        }
      />
      <ConfirmationDialog
        open={confirmAction === "disable"}
        onOpenChange={(open) => !open && setConfirmAction(null)}
        title={t("investorPortal.admin.confirm.disableTitle")}
        description={t("investorPortal.admin.confirm.disableDescription")}
        tone="destructive"
        isConfirming={isActing}
        onConfirm={() =>
          void run(
            () => investorsService.portal.disable(investorId),
            t("investorPortal.admin.toasts.disabled"),
          )
        }
      />
    </DetailSection>
  );
}
