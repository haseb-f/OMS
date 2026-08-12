"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { EnterpriseButton } from "@/components/ui/button";
import { EnterpriseCard, EnterpriseCardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EnterpriseDatePicker } from "@/components/shared/date-picker";
import { StatusBadge } from "@/components/business/status-badge";
import {
  JournalEntryLinesGrid,
  type JournalEntryLineGridRow,
  type JournalEntryAccountOption,
} from "@/components/accounting/journal-entry-lines-grid";
import { fiscalYearsService, type FiscalYearRow } from "@/services/fiscal-years-service";
import { openingBalancesService } from "@/services/opening-balances-service";
import { journalEntriesService, type JournalEntryRow } from "@/services/journal-entries-service";
import { createMasterDataService } from "@/services/master-data-service";
import type { ChartOfAccountRow } from "@/config/master-data/entities";
import {
  JOURNAL_ENTRY_STATUS_LABEL_KEY,
  JOURNAL_ENTRY_STATUS_TONE,
} from "@/config/accounting/status";
import { useUserContext } from "@/providers/user-context";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";
import { ModuleImportButtons } from "@/components/shared/module-import-buttons";
import { PermissionGate } from "@/components/shared/permission-gate";

const accountsService = createMasterDataService<ChartOfAccountRow>("/chart-of-accounts");

function emptyLine(): JournalEntryLineGridRow {
  return {
    id: `row-${Date.now()}-${Math.random()}`,
    accountId: "",
    description: "",
    costCenterId: "",
    projectId: "",
    debit: 0,
    credit: 0,
  };
}

/** TASK-055 Part 4 — a real wizard, not a decorative field: produces exactly one balanced JournalEntry (sourceType='OPENING_BALANCE') via the same Journal Engine every other entry uses. */
function OpeningBalancesPageContent() {
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const canManage = hasPermission("accounting.fiscal-years.manage");

  const [fiscalYears, setFiscalYears] = useState<FiscalYearRow[]>([]);
  const [accounts, setAccounts] = useState<JournalEntryAccountOption[]>([]);
  const [fiscalYearId, setFiscalYearId] = useState("");
  const [openingDate, setOpeningDate] = useState<Date | null>(null);
  const [lines, setLines] = useState<JournalEntryLineGridRow[]>([emptyLine(), emptyLine()]);
  const [existingEntry, setExistingEntry] = useState<JournalEntryRow | null | undefined>(undefined);
  const [isLoadingExisting, setIsLoadingExisting] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    fiscalYearsService
      .list()
      .then(setFiscalYears)
      .catch(() => setFiscalYears([]));
    accountsService
      .list({ pageSize: 500 })
      .then((result) =>
        setAccounts(result.items.map((a) => ({ id: a.id, code: a.code, name: a.name }))),
      )
      .catch(() => setAccounts([]));
  }, []);

  const checkExisting = useCallback(async (id: string) => {
    setIsLoadingExisting(true);
    try {
      const result = await journalEntriesService.list({
        sourceType: "OPENING_BALANCE",
        sourceId: id,
        pageSize: 1,
      });
      setExistingEntry(result.items[0] ?? null);
    } catch {
      setExistingEntry(null);
    } finally {
      setIsLoadingExisting(false);
    }
  }, []);

  useEffect(() => {
    if (!fiscalYearId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setExistingEntry(undefined);
      return;
    }
    void checkExisting(fiscalYearId);
    const fy = fiscalYears.find((f) => f.id === fiscalYearId);
    setOpeningDate(fy ? new Date(fy.startDate) : null);
  }, [fiscalYearId, fiscalYears, checkExisting]);

  const totalDebit = lines.reduce((sum, l) => sum + l.debit, 0);
  const totalCredit = lines.reduce((sum, l) => sum + l.credit, 0);
  const isBalanced = lines.length > 0 && Math.abs(totalDebit - totalCredit) < 0.01;

  const canGenerate = useMemo(
    () => canManage && fiscalYearId && openingDate && lines.some((l) => l.accountId) && isBalanced,
    [canManage, fiscalYearId, openingDate, lines, isBalanced],
  );

  const handleGenerate = async () => {
    if (!fiscalYearId || !openingDate) return;
    const validLines = lines.filter((l) => l.accountId && (l.debit > 0 || l.credit > 0));
    if (validLines.length === 0) {
      toast.error(t("accounting.openingBalances.validation.minLines"));
      return;
    }
    if (!isBalanced) {
      toast.error(t("accounting.journalEntries.validation.unbalanced"));
      return;
    }
    setIsSubmitting(true);
    try {
      const entry = await openingBalancesService.create({
        fiscalYearId,
        openingDate: openingDate.toISOString(),
        lines: validLines.map((l) => ({
          accountId: l.accountId,
          description: l.description || undefined,
          debit: l.debit || undefined,
          credit: l.credit || undefined,
        })),
      });
      toast.success(t("accounting.openingBalances.toasts.created"));
      void checkExisting(fiscalYearId);
      setExistingEntry(entry as unknown as JournalEntryRow);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Something went wrong.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("nav.financeOpeningBalances")}
        subtitle={t("accounting.openingBalances.description")}
        actions={<ModuleImportButtons importType="OPENING_BALANCES" />}
      />

      <EnterpriseCard size="sm">
        <EnterpriseCardContent className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label className="text-caption text-muted-foreground">
                {t("accounting.openingBalances.fields.fiscalYear")}
              </label>
              <Select value={fiscalYearId || undefined} onValueChange={setFiscalYearId}>
                <SelectTrigger size="sm" className="w-full">
                  <SelectValue
                    placeholder={t("accounting.openingBalances.fields.selectFiscalYear")}
                  />
                </SelectTrigger>
                <SelectContent>
                  {fiscalYears.map((fy) => (
                    <SelectItem key={fy.id} value={fy.id}>
                      {fy.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-caption text-muted-foreground">
                {t("accounting.openingBalances.fields.openingDate")}
              </label>
              <EnterpriseDatePicker
                value={openingDate}
                onChange={setOpeningDate}
                disabled={!fiscalYearId}
              />
            </div>
          </div>

          {isLoadingExisting ? (
            <p className="text-caption text-muted-foreground">{t("common.loading")}</p>
          ) : existingEntry ? (
            <div className="flex flex-col gap-3 rounded-md border border-border/60 bg-muted/20 p-4">
              <div className="flex items-center gap-2">
                <StatusBadge
                  label={t(JOURNAL_ENTRY_STATUS_LABEL_KEY[existingEntry.status])}
                  tone={JOURNAL_ENTRY_STATUS_TONE[existingEntry.status]}
                />
                <span className="text-caption text-muted-foreground">
                  {t("accounting.openingBalances.alreadyExists", {
                    entryNumber: existingEntry.entryNumber,
                  })}
                </span>
              </div>
              <Link href={`/finance/journal-entries/${existingEntry.id}`} className="w-fit">
                <EnterpriseButton type="button" variant="outline" size="sm">
                  {t("accounting.openingBalances.viewEntry")}
                </EnterpriseButton>
              </Link>
            </div>
          ) : fiscalYearId ? (
            <>
              <JournalEntryLinesGrid
                lines={lines}
                accounts={accounts}
                onChange={setLines}
                disabled={!canManage}
              />
              <div className="flex justify-end">
                <EnterpriseButton
                  type="button"
                  disabled={!canGenerate || isSubmitting}
                  onClick={handleGenerate}
                >
                  {t("accounting.openingBalances.generate")}
                </EnterpriseButton>
              </div>
            </>
          ) : (
            <p className="text-caption text-muted-foreground">
              {t("accounting.openingBalances.selectFiscalYearHint")}
            </p>
          )}
        </EnterpriseCardContent>
      </EnterpriseCard>
    </div>
  );
}

export default function OpeningBalancesPage() {
  return (
    <PermissionGate permission="accounting.opening-balances.view">
      <OpeningBalancesPageContent />
    </PermissionGate>
  );
}
