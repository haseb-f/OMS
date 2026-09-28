"use client";

import { useId, useState } from "react";
import { CalendarClock } from "lucide-react";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { EnterpriseDatePicker } from "@/components/shared/date-picker";
import { EnterpriseButton } from "@/components/ui/button";
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
import { toast, reportApiError } from "@/lib/toast";
import { useLeadFollowUpTypes } from "@/hooks/use-reference-data";
import {
  FormCardField,
  FormCardRow,
  FormCardSection,
  FormCardStack,
} from "@/components/shared/form-card/form-card";

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
  const followUpTypes = useLeadFollowUpTypes();
  const fieldId = useId();
  const [followUpTypeId, setFollowUpTypeId] = useState("");
  const [outcome, setOutcome] = useState("");
  const [note, setNote] = useState("");
  const [followUpAt, setFollowUpAt] = useState<Date | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await leadsService.addFollowUp(leadId, {
        followUpTypeId: followUpTypeId || undefined,
        outcome: outcome || undefined,
        note: note || undefined,
        followUpAt: followUpAt ? followUpAt.toISOString() : undefined,
      });
      toast.success(t("crm.leads.followUp.saved"));
      onSaved?.();
      onOpenChange(false);
      setFollowUpTypeId("");
      setOutcome("");
      setNote("");
      setFollowUpAt(null);
    } catch (error) {
      reportApiError(error, "common.failedToSave");
    } finally {
      setBusy(false);
    }
  };

  const typeSelect = (
    <Select value={followUpTypeId} onValueChange={setFollowUpTypeId}>
      <SelectTrigger id={`${fieldId}-type`} className="w-full">
        <SelectValue placeholder={t("masterData.leadFollowUpTypes.select")} />
      </SelectTrigger>
      <SelectContent>
        {followUpTypes.map((type) => (
          <SelectItem key={type.id} value={type.id}>
            {type.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
  const outcomeSelect = (
    <Select value={outcome} onValueChange={setOutcome}>
      <SelectTrigger id={`${fieldId}-outcome`} className="w-full">
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
  );
  const nextAtPicker = (
    <EnterpriseDatePicker
      id={`${fieldId}-next`}
      value={followUpAt}
      onChange={setFollowUpAt}
      showTime
      // Date + time needs more than the date-only width, or the value clips.
      className="w-60 max-w-full"
    />
  );
  const noteInput = (
    <Textarea
      id={`${fieldId}-note`}
      rows={3}
      value={note}
      onChange={(e) => setNote(e.target.value)}
    />
  );

  return (
    <EnterpriseModal
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      layout="form-card"
      icon={CalendarClock}
      title={t("crm.leads.followUp.title")}
      description={t("crm.leads.followUp.description")}
      footer={(requestClose) => (
        <>
          <EnterpriseButton variant="outline" onClick={requestClose}>
            {t("common.cancel")}
          </EnterpriseButton>
          <EnterpriseButton disabled={busy} isLoading={busy} onClick={() => void save()}>
            {t("common.save")}
          </EnterpriseButton>
        </>
      )}
    >
      {/* Compact form: contact result (type · outcome in one row), then the next step. */}
      <FormCardStack>
        <FormCardSection title={t("crm.leads.followUp.sectionContact")}>
          <FormCardRow>
            <FormCardField
              size="sm"
              label={t("crm.leads.followUp.type")}
              htmlFor={`${fieldId}-type`}
            >
              {typeSelect}
            </FormCardField>
            <FormCardField
              size="md"
              label={t("crm.leads.followUp.outcome")}
              htmlFor={`${fieldId}-outcome`}
            >
              {outcomeSelect}
            </FormCardField>
          </FormCardRow>
        </FormCardSection>
        <FormCardSection title={t("crm.leads.followUp.sectionNext")}>
          <FormCardField label={t("crm.leads.followUp.nextAt")} htmlFor={`${fieldId}-next`}>
            {nextAtPicker}
          </FormCardField>
          <FormCardField label={t("crm.leads.followUp.note")} htmlFor={`${fieldId}-note`}>
            {noteInput}
          </FormCardField>
        </FormCardSection>
      </FormCardStack>
    </EnterpriseModal>
  );
}
