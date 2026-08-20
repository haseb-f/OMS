"use client";

import { useEffect, useState } from "react";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { ModalSection } from "@/components/shared/modal-section";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { EnterpriseButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/business/status-badge";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";
import {
  physicalCountService,
  type PhysicalCountDetailRow,
} from "@/services/physical-count-service";
import type { MessageKey } from "@/i18n/translate";

const STATUS_TONE: Record<string, "success" | "neutral" | "warning"> = {
  DRAFT: "warning",
  CONFIRMED: "success",
  CANCELLED: "neutral",
};

/** TASK-029 — Physical Count detail: enter counted quantities per line, then Confirm (generates the adjustment movements) or Cancel. */
export function CountDetailDialog({
  countId,
  onOpenChange,
  onChanged,
}: {
  countId: string | null;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const { t } = useLocale();
  const [count, setCount] = useState<PhysicalCountDetailRow | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingLineId, setSavingLineId] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const load = () => {
    if (!countId) return;
    setIsLoading(true);
    physicalCountService
      .get(countId)
      .then((row) => {
        setCount(row);
        setDrafts(
          Object.fromEntries(
            row.lines.map((line) => [line.id, line.countedQuantity?.toString() ?? ""]),
          ),
        );
      })
      .catch(() => setCount(null))
      .finally(() => setIsLoading(false));
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countId]);

  const isDraft = count?.status === "DRAFT";

  const saveLine = async (lineId: string) => {
    if (!count) return;
    const value = drafts[lineId];
    if (value === "" || value === undefined || Number(value) < 0) return;
    setSavingLineId(lineId);
    try {
      const updated = await physicalCountService.updateLine(count.id, lineId, Number(value));
      setCount(updated);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.noResults"));
    } finally {
      setSavingLineId(null);
    }
  };

  const confirm = async () => {
    if (!count) return;
    setIsSubmitting(true);
    try {
      await physicalCountService.confirm(count.id);
      toast.success(t("inventory.physicalCount.confirmedSuccess"));
      setConfirmOpen(false);
      onChanged();
      load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.noResults"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const cancel = async () => {
    if (!count) return;
    setIsSubmitting(true);
    try {
      await physicalCountService.cancel(count.id);
      toast.success(t("inventory.physicalCount.cancelledSuccess"));
      setCancelOpen(false);
      onChanged();
      load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.noResults"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const allCounted =
    count?.lines.every((line) => drafts[line.id] !== "" && drafts[line.id] !== undefined) ?? false;

  return (
    <>
      <EnterpriseModal
        open={!!countId}
        onOpenChange={(next) => !next && onOpenChange(false)}
        size="lg"
        title={count?.countNumber ?? t("inventory.physicalCount.title")}
        description={
          count?.warehouse ? `${count.warehouse.code} — ${count.warehouse.name}` : undefined
        }
        footer={(requestClose) => (
          <>
            <EnterpriseButton type="button" variant="ghost" onClick={requestClose}>
              {t("common.close")}
            </EnterpriseButton>
            {isDraft && (
              <>
                <EnterpriseButton
                  type="button"
                  variant="destructive"
                  onClick={() => setCancelOpen(true)}
                  disabled={isSubmitting}
                >
                  {t("inventory.physicalCount.cancelCount")}
                </EnterpriseButton>
                <EnterpriseButton
                  type="button"
                  onClick={() => setConfirmOpen(true)}
                  disabled={isSubmitting || !allCounted}
                >
                  {t("inventory.physicalCount.confirmCount")}
                </EnterpriseButton>
              </>
            )}
          </>
        )}
      >
        {count && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <StatusBadge
                tone={STATUS_TONE[count.status]}
                label={t(`inventory.physicalCount.status.${count.status}` as MessageKey)}
              />
              {count.notes && (
                <span className="text-caption text-muted-foreground">{count.notes}</span>
              )}
            </div>

            <ModalSection title={t("inventory.physicalCount.lines")} columns={2}>
              <div className="col-span-full overflow-hidden rounded-md border border-border">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>{t("inventory.fields.product")}</TableHead>
                      <TableHead>{t("inventory.physicalCount.systemQuantity")}</TableHead>
                      <TableHead>{t("inventory.physicalCount.countedQuantity")}</TableHead>
                      <TableHead>{t("inventory.physicalCount.difference")}</TableHead>
                      {!isDraft && <TableHead>{t("inventory.fields.movementNumber")}</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {count.lines.map((line) => {
                      const draftValue = drafts[line.id] ?? "";
                      const counted = draftValue === "" ? null : Number(draftValue);
                      const difference = counted === null ? null : counted - line.systemQuantity;
                      return (
                        <TableRow key={line.id}>
                          <TableCell>
                            <div className="flex flex-col whitespace-normal">
                              <span>{line.product.displayName || line.product.name}</span>
                              <code dir="ltr" className="text-xs text-muted-foreground">
                                {line.product.sku}
                              </code>
                            </div>
                          </TableCell>
                          <TableCell dir="ltr">{line.systemQuantity}</TableCell>
                          <TableCell>
                            {isDraft ? (
                              <Input
                                type="number"
                                dir="ltr"
                                min={0}
                                step={1}
                                className="h-9 w-24"
                                value={draftValue}
                                disabled={savingLineId === line.id}
                                onChange={(event) =>
                                  setDrafts((current) => ({
                                    ...current,
                                    [line.id]: event.target.value,
                                  }))
                                }
                                onBlur={() => saveLine(line.id)}
                              />
                            ) : (
                              <span dir="ltr">{line.countedQuantity ?? "—"}</span>
                            )}
                          </TableCell>
                          <TableCell dir="ltr">
                            {difference === null ? (
                              "—"
                            ) : (
                              <span
                                className={
                                  difference === 0
                                    ? "text-muted-foreground"
                                    : difference > 0
                                      ? "text-success"
                                      : "text-destructive"
                                }
                              >
                                {difference > 0 ? `+${difference}` : difference}
                              </span>
                            )}
                          </TableCell>
                          {!isDraft && (
                            <TableCell>
                              {line.movement ? (
                                <code dir="ltr" className="text-xs">
                                  {line.movement.movementNumber}
                                </code>
                              ) : (
                                "—"
                              )}
                            </TableCell>
                          )}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              {isDraft && !allCounted && (
                <p className="col-span-full text-caption text-muted-foreground">
                  {t("inventory.physicalCount.enterAllHint")}
                </p>
              )}
            </ModalSection>
          </div>
        )}
        {isLoading && !count && (
          <p className="text-caption text-muted-foreground">{t("table.noResults")}</p>
        )}
      </EnterpriseModal>

      <ConfirmationDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        tone="warning"
        title={t("inventory.physicalCount.confirmTitle")}
        description={t("inventory.physicalCount.confirmDescription")}
        onConfirm={confirm}
        confirmLabel={t("inventory.physicalCount.confirmCount")}
      />
      <ConfirmationDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        tone="destructive"
        title={t("inventory.physicalCount.cancelTitle")}
        description={t("inventory.physicalCount.cancelDescription")}
        onConfirm={cancel}
        confirmLabel={t("inventory.physicalCount.cancelCount")}
      />
    </>
  );
}
