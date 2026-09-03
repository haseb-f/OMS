"use client";

import { useState } from "react";
import { CalendarClock } from "lucide-react";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { EnterpriseButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { leadsService } from "@/services/leads-service";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";

const OUTCOMES = [
  "answered",
  "noAnswer",
  "interested",
  "callback",
  "wrongNumber",
  "notInterested",
] as const;

export function LeadFollowUpDialog({
  open,
  onOpenChange,
  leadId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadId: string;
  onSaved?: () => void;
}) {
  const { t } = useLocale();
  const [outcome, setOutcome] = useState("");
  const [note, setNote] = useState("");
  const [followUpAt, setFollowUpAt] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await leadsService.addFollowUp(leadId, {
        outcome: outcome || undefined,
        note: note || undefined,
        followUpAt: followUpAt ? new Date(followUpAt).toISOString() : undefined,
      });
      toast.success(t("crm.leads.followUp.saved"));
      onSaved?.();
      onOpenChange(false);
      setOutcome("");
      setNote("");
      setFollowUpAt("");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.loadFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <EnterpriseModal
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      icon={CalendarClock}
      title={t("crm.leads.followUp.title")}
      description={t("crm.leads.followUp.description")}
      footer={(requestClose) => (
        <>
          <EnterpriseButton variant="outline" onClick={requestClose}>
            {t("common.cancel")}
          </EnterpriseButton>
          <EnterpriseButton disabled={busy} onClick={() => void save()}>
            {t("common.save")}
          </EnterpriseButton>
        </>
      )}
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <Label>{t("crm.leads.followUp.outcome")}</Label>
          <Select value={outcome} onValueChange={setOutcome}>
            <SelectTrigger>
              <SelectValue placeholder={t("crm.leads.followUp.outcome")} />
            </SelectTrigger>
            <SelectContent>
              {OUTCOMES.map((item) => (
                <SelectItem key={item} value={item}>
                  {t(`crm.leads.followUp.outcomes.${item}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label>{t("crm.leads.followUp.nextAt")}</Label>
          <Input
            type="datetime-local"
            value={followUpAt}
            onChange={(e) => setFollowUpAt(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label>{t("crm.leads.followUp.note")}</Label>
          <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>
    </EnterpriseModal>
  );
}
