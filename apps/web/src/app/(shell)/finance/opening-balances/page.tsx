"use client";

import { useCallback, useEffect, useId, useState } from "react";
import Link from "next/link";
import { BookCheck } from "lucide-react";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { HeaderActions } from "@/components/shared/header-actions";
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
} from "@/components/accounting/journal-entry-lines-grid";
import { fiscalYearsService, type FiscalYearRow } from "@/services/fiscal-years-service";
import { openingBalancesService } from "@/services/opening-balances-service";
import { journalEntriesService, type JournalEntryRow } from "@/services/journal-entries-service";
import {
  JOURNAL_ENTRY_STATUS_LABEL_KEY,
  JOURNAL_ENTRY_STATUS_TONE,
} from "@/config/accounting/status";
import { useUserContext } from "@/providers/user-context";
import { useLocale } from "@/providers/locale-provider";
import { reportApiError, toast } from "@/lib/toast";
import { FieldMessage } from "@/components/ui/form";
import { DocumentActionBar } from "@/components/documents/document-action-bar";
import { ModuleImportButtons } from "@/components/shared/module-import-buttons";
import { PermissionGate } from "@/components/shared/permission-gate";

const NO_PREFETCHED_ACCOUNTS: never[] = [];

function emptyLine(): JournalEntryLineGridRow {
  return {
    id: `row-${Date.now()}-${Math.random()}`,
    accountId: "",
    description: "",
    costCenterId: "",
    projectId: "",
    partnerId: "",
    partner: null,
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
  const fiscalYearFieldId = useId();
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
    // No account prefetch: every line is new here, and the grid's account
    // picker searches posting accounts remotely (cached), so the whole chart
    // stays findable instead of the first 500 rows only.
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
  const validLines = lines.filter((l) => l.accountId && (l.debit > 0 || l.credit > 0));

  /** Shown inline under the fields after the first attempt (design §8); entered lines are never cleared. */
  const [showValidation, setShowValidation] = useState(false);
  const validate = (): { openingDate?: string; lines?: string } | null => {
    const errors: { openingDate?: string; lines?: string } = {};
    if (!openingDate)
      errors.openingDate = t("accounting.openingBalances.validation.openingDateRequired");
    if (validLines.length === 0) {
      errors.lines = t("accounting.openingBalances.validation.minLines");
    } else if (!isBalanced) {
      errors.lines = t("accounting.journalEntries.validation.unbalanced");
    }
    return Object.keys(errors).length > 0 ? errors : null;
  };
  const fieldErrors = showValidation ? validate() : null;

  const handleGenerate = async () => {
    if (!fiscalYearId) return;
    if (validate() || !openingDate) {
      setShowValidation(true);
      return;
    }
    setShowValidation(false);
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
      reportApiError(error, "errors.generic");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <PageWorkspace
      title={t("nav.financeOpeningBalances")}
      description={t("accounting.openingBalances.description")}
      actions={<HeaderActions inline={<ModuleImportButtons importType="OPENING_BALANCES" />} />}
    >
      <EnterpriseCard size="sm">
        <EnterpriseCardContent className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label htmlFor={fiscalYearFieldId} className="text-caption text-muted-foreground">
                {t("accounting.openingBalances.fields.fiscalYear")}
              </label>
              <Select value={fiscalYearId || undefined} onValueChange={setFiscalYearId}>
                <SelectTrigger id={fiscalYearFieldId} size="sm" className="w-full">
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
              <FieldMessage>{fieldErrors?.openingDate}</FieldMessage>
            </div>
          </div>

          {isLoadingExisting ? (
            <p className="text-caption text-muted-foreground">{t("common.loading")}</p>
          ) : existingEntry ? (
            <div className="flex flex-col gap-3 rounded-md border border-border bg-muted/20 p-4">
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
              <EnterpriseButton asChild variant="outline" size="sm" className="w-fit">
                <Link href={`/finance/journal-entries/${existingEntry.id}`}>
                  {t("accounting.openingBalances.viewEntry")}
                </Link>
              </EnterpriseButton>
            </div>
          ) : fiscalYearId ? (
            <>
              <JournalEntryLinesGrid
                lines={lines}
                accounts={NO_PREFETCHED_ACCOUNTS}
                onChange={setLines}
                disabled={!canManage}
              />
              <FieldMessage>{fieldErrors?.lines}</FieldMessage>
              {canManage ? (
                <div className="flex justify-end pb-16 md:pb-0">
                  <DocumentActionBar
                    status="DRAFT"
                    context={undefined}
                    isBusy={isSubmitting}
                    actions={[
                      {
                        key: "generate",
                        primary: true,
                        label: t("accounting.openingBalances.generate"),
                        icon: BookCheck,
                        // Posting is irreversible — confirmed in the bar, but only once
                        // the entry is valid (otherwise the click shows what is missing).
                        confirm: validate()
                          ? undefined
                          : {
                              title: t("accounting.openingBalances.confirmGenerateTitle"),
                              description: t(
                                "accounting.openingBalances.confirmGenerateDescription",
                              ),
                            },
                        onAction: handleGenerate,
                      },
                    ]}
                  />
                </div>
              ) : null}
            </>
          ) : (
            <p className="text-caption text-muted-foreground">
              {t("accounting.openingBalances.selectFiscalYearHint")}
            </p>
          )}
        </EnterpriseCardContent>
      </EnterpriseCard>
    </PageWorkspace>
  );
}

export default function OpeningBalancesPage() {
  return (
    <PermissionGate permission="accounting.opening-balances.view">
      <OpeningBalancesPageContent />
    </PermissionGate>
  );
}
