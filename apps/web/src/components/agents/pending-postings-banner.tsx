"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { EnterpriseButton } from "@/components/ui/button";
import { agentFinanceService } from "@/services/agents-service";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { reportApiError, toast } from "@/lib/toast";

/**
 * Decision D1: while the agent GL accounts are not configured, ledger entries
 * are recorded `PENDING_CONFIGURATION`. This banner states how many are
 * waiting and lets Finance (`agents.finance.post`) post them once the
 * accounts exist. Renders nothing when nothing is pending.
 */
export function PendingPostingsBanner({
  agentId,
  onPosted,
}: {
  /** Omit for every agent (collections queue). */
  agentId?: string;
  onPosted?: () => void;
}) {
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const canView = hasPermission("agents.finance.view");
  const canPost = hasPermission("agents.finance.post");
  const [count, setCount] = useState(0);
  const [isPosting, setIsPosting] = useState(false);

  const load = useCallback(async () => {
    if (!canView) return;
    try {
      const result = await agentFinanceService.pendingPostings(agentId);
      setCount(result.total);
    } catch {
      setCount(0);
    }
  }, [agentId, canView]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  if (!canView || count === 0) return null;

  const post = async () => {
    setIsPosting(true);
    try {
      await agentFinanceService.postPending(agentId);
      toast.success(t("agents.pending.posted"));
      await load();
      onPosted?.();
    } catch (error) {
      reportApiError(error, "errors.generic");
    } finally {
      setIsPosting(false);
    }
  };

  return (
    <Alert tone="warning">
      <TriangleAlert />
      <AlertDescription className="flex flex-col gap-2">
        <AlertTitle>{t("agents.pending.title", { count })}</AlertTitle>
        <p>{t("agents.pending.description")}</p>
        <div className="flex flex-wrap gap-2">
          {canPost ? (
            <EnterpriseButton
              type="button"
              size="sm"
              variant="outline"
              isLoading={isPosting}
              disabled={isPosting}
              onClick={() => void post()}
            >
              {t("agents.pending.post")}
            </EnterpriseButton>
          ) : null}
          <EnterpriseButton asChild size="sm" variant="ghost">
            <Link href="/finance/accounting-settings">{t("agents.pending.openSettings")}</Link>
          </EnterpriseButton>
        </div>
      </AlertDescription>
    </Alert>
  );
}
