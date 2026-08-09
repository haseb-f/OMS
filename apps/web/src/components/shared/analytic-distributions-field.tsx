"use client";

import { useEffect, useMemo, useState } from "react";
import { EnterpriseButton } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { createMasterDataService } from "@/services/master-data-service";
import { analyticDistributionsService } from "@/services/analytic-distributions-service";
import type { AnalyticPlanRow, AnalyticAccountRow } from "@/config/master-data/entities";

const plansService = createMasterDataService<AnalyticPlanRow>("/analytic-plans");
const accountsService = createMasterDataService<AnalyticAccountRow>("/analytic-accounts");

/**
 * Odoo-style Analytic Distribution widget (TASK-025 Part 2) — one account
 * per Analytic Plan, attachable to any document via the generic
 * `documentType`/`documentId` pair. Self-contained: loads the current
 * distribution on mount and persists the full set on Save, so a consuming
 * document form only needs to render `<AnalyticDistributionsField
 * documentType="SALES_INVOICE" documentId={invoice.id} />` — no per-module
 * distribution logic is ever duplicated.
 */
export function AnalyticDistributionsField({
  documentType,
  documentId,
  disabled = false,
}: {
  documentType: string;
  documentId: string;
  disabled?: boolean;
}) {
  const { t } = useLocale();
  const [plans, setPlans] = useState<AnalyticPlanRow[]>([]);
  const [accounts, setAccounts] = useState<AnalyticAccountRow[]>([]);
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      try {
        const [plansResult, accountsResult, lines] = await Promise.all([
          plansService.list({ pageSize: 200 }),
          accountsService.list({ pageSize: 500 }),
          analyticDistributionsService.get(documentType, documentId),
        ]);
        if (cancelled) return;
        setPlans(plansResult.items.filter((plan) => plan.active));
        setAccounts(accountsResult.items);
        setSelections(
          Object.fromEntries(lines.map((line) => [line.analyticPlanId, line.analyticAccountId])),
        );
      } catch {
        if (!cancelled) {
          setPlans([]);
          setAccounts([]);
          setSelections({});
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();

    return () => {
      cancelled = true;
    };
  }, [documentType, documentId]);

  const accountsByPlan = useMemo(() => {
    const map = new Map<string, AnalyticAccountRow[]>();
    for (const account of accounts) {
      const list = map.get(account.analyticPlanId) ?? [];
      list.push(account);
      map.set(account.analyticPlanId, list);
    }
    return map;
  }, [accounts]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const lines = Object.entries(selections)
        .filter(([, accountId]) => Boolean(accountId))
        .map(([analyticPlanId, analyticAccountId]) => ({ analyticPlanId, analyticAccountId }));
      const saved = await analyticDistributionsService.set(documentType, documentId, lines);
      setSelections(
        Object.fromEntries(saved.map((line) => [line.analyticPlanId, line.analyticAccountId])),
      );
      toast.success(t("analyticDistributions.saved"));
    } catch {
      toast.error(t("analyticDistributions.saveError"));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border p-4">
      <div>
        <h3 className="text-sm font-medium">{t("analyticDistributions.title")}</h3>
        <p className="text-sm text-muted-foreground">{t("analyticDistributions.description")}</p>
      </div>

      {plans.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("analyticDistributions.noPlans")}</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {plans.map((plan) => (
            <div key={plan.id} className="flex flex-col gap-2">
              <Label>{plan.name}</Label>
              <Select
                disabled={disabled}
                value={selections[plan.id] ?? ""}
                onValueChange={(value) => setSelections((prev) => ({ ...prev, [plan.id]: value }))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t("analyticDistributions.selectAccount")} />
                </SelectTrigger>
                <SelectContent>
                  {(accountsByPlan.get(plan.id) ?? []).map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
      )}

      {plans.length > 0 && (
        <div>
          <EnterpriseButton
            type="button"
            size="sm"
            disabled={disabled || saving}
            onClick={handleSave}
          >
            {t("analyticDistributions.save")}
          </EnterpriseButton>
        </div>
      )}
    </div>
  );
}
