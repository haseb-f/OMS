"use client";

import { useEffect, useState } from "react";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { EnterpriseButton } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EntityCombobox } from "@/components/shared/entity-combobox";
import { useNoPurchaseReasons } from "@/hooks/use-reference-data";
import { leadsService } from "@/services/leads-service";
import { ApiError } from "@/services/api-client";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import type { NoPurchaseReasonRow } from "@/config/master-data/entities";

export function LeadCloseWithoutPurchaseDialog({
  leadId,
  classificationId,
  open,
  onOpenChange,
  onClosed,
}: {
  leadId: string;
  classificationId?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onClosed: () => void;
}) {
  const { t } = useLocale();
  const reasons = useNoPurchaseReasons();
  const [reason, setReason] = useState<NoPurchaseReasonRow | null>(null);
  const [notes, setNotes] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReason(null);
    setNotes("");
  }, [open]);

  const suggested = classificationId
    ? reasons.filter((row) => row.classifications?.some((item) => item.id === classificationId))
    : [];
  const remaining = reasons.filter((row) => !suggested.some((item) => item.id === row.id));
  const items = [...suggested, ...remaining];

  const submit = async () => {
    if (!reason) return;
    setIsSaving(true);
    try {
      await leadsService.closeWithoutPurchase(leadId, {
        noPurchaseReasonId: reason.id,
        notes: notes.trim() || undefined,
      });
      toast.success(t("crm.leads.closeWithoutPurchase.success"));
      onOpenChange(false);
      onClosed();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.loadFailed"));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <EnterpriseModal
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      title={t("crm.leads.closeWithoutPurchase.title")}
      description={t("crm.leads.closeWithoutPurchase.description")}
      footer={(requestClose) => (
        <>
          <EnterpriseButton variant="outline" onClick={requestClose}>
            {t("common.cancel")}
          </EnterpriseButton>
          <EnterpriseButton
            variant="destructive"
            disabled={!reason || isSaving}
            onClick={() => void submit()}
          >
            {t("crm.leads.closeWithoutPurchase.confirm")}
          </EnterpriseButton>
        </>
      )}
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <Label>
            {t("crm.leads.closeWithoutPurchase.reason")} <span className="text-destructive">*</span>
          </Label>
          <EntityCombobox
            value={reason}
            onChange={setReason}
            items={items}
            getId={(item) => item.id}
            getTitle={(item) => item.name}
            placeholder={t("masterData.noPurchaseReasons.select")}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label>{t("crm.leads.closeWithoutPurchase.notes")}</Label>
          <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} />
        </div>
      </div>
    </EnterpriseModal>
  );
}
