"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, X } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { useLocale } from "@/providers/locale-provider";
import { reportApiError, toast } from "@/lib/toast";
import type {
  ImportJobRowRecord,
  ImportJobsApi,
  ImportRowRejectionReasonCode,
} from "@/services/import-jobs-service";
import { RejectReasonPicker, isRejectReasonComplete } from "./reject-reason-picker";

/**
 * R15 — the needs-review rows of one import (e.g. "the phone belongs to an
 * existing customer"): Confirm creates the order for that customer as a new
 * (repeat) order — all lines of the order at once; Reject keeps the row out
 * with a reason. Nothing is ever decided automatically. Used by the company
 * and the agent wizard alike (`jobs` is the caller's endpoint family).
 */
export function ImportReviewRows({
  jobs,
  jobId,
  onChanged,
}: {
  jobs: ImportJobsApi;
  jobId: string;
  onChanged: () => void;
}) {
  const { t } = useLocale();
  const [rows, setRows] = useState<ImportJobRowRecord[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<ImportJobRowRecord | null>(null);
  const [code, setCode] = useState<ImportRowRejectionReasonCode | "">("");
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    try {
      setRows(await jobs.rows(jobId, "NEEDS_REVIEW"));
    } catch (error) {
      reportApiError(error, "errors.loadFailed");
    }
  }, [jobs, jobId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const confirm = async (row: ImportJobRowRecord) => {
    setBusyId(row.id);
    try {
      await jobs.confirmRow(jobId, row.id);
      toast.success(t("salesImport.review.confirmed"));
      await load();
      onChanged();
    } catch (error) {
      reportApiError(error, "common.failedToSave");
    } finally {
      setBusyId(null);
    }
  };

  const reject = async () => {
    if (!rejectTarget || !isRejectReasonComplete(code, note)) return;
    setBusyId(rejectTarget.id);
    try {
      await jobs.rejectRow(jobId, rejectTarget.id, {
        reasonCode: code as ImportRowRejectionReasonCode,
        note: code === "OTHER" ? note.trim() : undefined,
      });
      toast.success(t("salesImport.review.rejected"));
      setRejectTarget(null);
      await load();
      onChanged();
    } catch (error) {
      reportApiError(error, "common.failedToSave");
    } finally {
      setBusyId(null);
    }
  };

  if (rows.length === 0) return null;
  return (
    <section className="flex flex-col gap-2 rounded-md border border-warning/30 bg-warning/5 p-3">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-caption font-semibold text-foreground">
          {t("salesImport.review.title")}
        </h3>
        <p className="text-caption text-muted-foreground">{t("salesImport.review.description")}</p>
      </div>
      <ul className="flex flex-col divide-y divide-border rounded-md border border-border bg-card">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-col gap-2 p-2 sm:flex-row sm:items-start">
            <span className="num shrink-0 text-caption font-semibold text-muted-foreground">
              {t("importCenter.wizard.preview.rowNumber")} {row.rowNumber}
            </span>
            <p className="min-w-0 flex-1 text-caption">{row.reviewReason}</p>
            <div className="flex shrink-0 gap-1.5">
              <EnterpriseButton
                type="button"
                size="sm"
                onClick={() => void confirm(row)}
                disabled={busyId !== null}
              >
                <Check />
                {t("salesImport.review.confirm")}
              </EnterpriseButton>
              <EnterpriseButton
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setCode("");
                  setNote("");
                  setRejectTarget(row);
                }}
                disabled={busyId !== null}
              >
                <X />
                {t("salesImport.review.reject")}
              </EnterpriseButton>
            </div>
          </li>
        ))}
      </ul>
      <ConfirmationDialog
        open={!!rejectTarget}
        onOpenChange={(open) => {
          if (!open) setRejectTarget(null);
        }}
        tone="destructive"
        title={t("salesImport.review.rejectTitle")}
        description={rejectTarget?.reviewReason ?? undefined}
        extra={
          <RejectReasonPicker
            code={code}
            note={note}
            onCodeChange={setCode}
            onNoteChange={setNote}
          />
        }
        confirmLabel={t("salesImport.review.reject")}
        cancelLabel={t("common.cancel")}
        confirmDisabled={!isRejectReasonComplete(code, note)}
        isConfirming={busyId !== null}
        onConfirm={() => void reject()}
      />
    </section>
  );
}
