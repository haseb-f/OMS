"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { CreateOperationFooter } from "@/components/shared/create-operation";
import {
  FormCardField,
  FormCardRow,
  FormCardSection,
  FormCardStack,
} from "@/components/shared/form-card/form-card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CurrencyPicker } from "@/components/business/currency-picker";
import { OMSPhoneInput, optionalPhoneIssue } from "@/components/shared/phone-input";
import { useCountries } from "@/hooks/use-reference-data";
import { agentsService, type AgentDetail, type AgentInput } from "@/services/agents-service";
import { useLocale } from "@/providers/locale-provider";
import { reportApiError, reportSuccess, toast } from "@/lib/toast";
import { invalidateLookups } from "@/lib/lookup-cache";
import { FieldNote } from "./field-note";

interface AgentFormState {
  name: string;
  legalName: string;
  contactName: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
  currencyId: string;
}

function toState(agent: AgentDetail | null): AgentFormState {
  return {
    name: agent?.name ?? "",
    legalName: agent?.legalName ?? "",
    contactName: agent?.contactName ?? "",
    phone: agent?.phone ?? "",
    email: agent?.email ?? "",
    address: agent?.address ?? "",
    notes: agent?.notes ?? "",
    currencyId: agent?.currencyId ?? "",
  };
}

/**
 * Create / edit an agent. The agent number (AG-####) and its Partner record
 * are server-made — never typed. Mount only while open so every open starts
 * from the record (or blank).
 */
export function AgentFormDialog({
  agent,
  onOpenChange,
  onSaved,
}: {
  /** null = create. */
  agent: AgentDetail | null;
  onOpenChange: (open: boolean) => void;
  onSaved?: (agent: AgentDetail) => void;
}) {
  const { t } = useLocale();
  const router = useRouter();
  const fieldId = useId();
  const countries = useCountries();
  const [initial] = useState(() => toState(agent));
  const [form, setForm] = useState<AgentFormState>(initial);
  const [showErrors, setShowErrors] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const set = (key: keyof AgentFormState) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }));
  const isDirty = JSON.stringify(form) !== JSON.stringify(initial);
  const nameError = !form.name.trim() ? t("agents.form.nameRequired") : null;
  const currencyError = !form.currencyId ? t("agents.form.currencyRequired") : null;
  const phoneError = optionalPhoneIssue(form.phone, t);

  const submit = async () => {
    if (nameError || currencyError || phoneError) {
      setShowErrors(true);
      return;
    }
    const payload: AgentInput = {
      name: form.name.trim(),
      legalName: form.legalName.trim() || undefined,
      contactName: form.contactName.trim() || undefined,
      phone: form.phone.trim() || undefined,
      email: form.email.trim() || null,
      address: form.address.trim() || undefined,
      notes: form.notes.trim() || undefined,
      currencyId: form.currencyId,
    };
    setIsSaving(true);
    try {
      const saved = agent
        ? await agentsService.update(agent.id, payload)
        : await agentsService.create(payload);
      invalidateLookups("agents:");
      if (agent) {
        toast.success(t("agents.toasts.saved"));
      } else {
        reportSuccess(t("agents.toasts.created", { number: saved.agentNumber }), {
          href: `/agents/${saved.id}`,
          navigate: router.push,
        });
      }
      onSaved?.(saved);
      onOpenChange(false);
    } catch (error) {
      reportApiError(error, "common.failedToSave");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <EnterpriseModal
      open
      onOpenChange={onOpenChange}
      size="md"
      layout="form-card"
      title={agent ? t("agents.form.editTitle") : t("agents.form.createTitle")}
      description={agent ? agent.agentNumber : t("agents.form.numberAuto")}
      isDirty={isDirty}
      footer={(requestClose) => (
        <CreateOperationFooter
          requestClose={requestClose}
          onSubmit={() => void submit()}
          isSubmitting={isSaving}
        />
      )}
    >
      <FormCardStack>
        <FormCardSection title={t("agents.form.identity")}>
          <FormCardRow>
            <FormCardField
              size="md"
              required
              label={t("agents.fields.name")}
              htmlFor={`${fieldId}-name`}
              message={<FieldNote error={showErrors ? nameError : null} />}
            >
              <Input
                id={`${fieldId}-name`}
                value={form.name}
                aria-invalid={showErrors && !!nameError}
                onChange={(event) => set("name")(event.target.value)}
              />
            </FormCardField>
            <FormCardField
              size="md"
              label={t("agents.fields.legalName")}
              htmlFor={`${fieldId}-legal`}
            >
              <Input
                id={`${fieldId}-legal`}
                value={form.legalName}
                onChange={(event) => set("legalName")(event.target.value)}
              />
            </FormCardField>
          </FormCardRow>
          <FormCardField
            required
            label={t("agents.fields.currency")}
            htmlFor={`${fieldId}-currency`}
            message={
              <FieldNote
                error={showErrors ? currencyError : null}
                hint={t("agents.form.currencyHint")}
              />
            }
          >
            <CurrencyPicker
              id={`${fieldId}-currency`}
              valueKey="id"
              value={form.currencyId || null}
              onValueChange={set("currencyId")}
              error={showErrors && !!currencyError}
            />
          </FormCardField>
        </FormCardSection>
        <FormCardSection title={t("agents.form.contact")}>
          <FormCardRow>
            <FormCardField
              size="md"
              label={t("agents.fields.contactName")}
              htmlFor={`${fieldId}-contact`}
            >
              <Input
                id={`${fieldId}-contact`}
                value={form.contactName}
                onChange={(event) => set("contactName")(event.target.value)}
              />
            </FormCardField>
            <FormCardField size="md" label={t("agents.fields.phone")} htmlFor={`${fieldId}-phone`}>
              {/* The calling code is the phone's own (R13 A1): picked in the field, read back from the stored number. */}
              <OMSPhoneInput
                id={`${fieldId}-phone`}
                value={form.phone}
                onChange={set("phone")}
                countries={countries}
                forceValidation={showErrors}
              />
            </FormCardField>
            <FormCardField size="md" label={t("agents.fields.email")} htmlFor={`${fieldId}-email`}>
              <Input
                id={`${fieldId}-email`}
                dir="ltr"
                type="email"
                value={form.email}
                onChange={(event) => set("email")(event.target.value)}
              />
            </FormCardField>
          </FormCardRow>
          <FormCardField label={t("agents.fields.address")} htmlFor={`${fieldId}-address`}>
            <Input
              id={`${fieldId}-address`}
              value={form.address}
              onChange={(event) => set("address")(event.target.value)}
            />
          </FormCardField>
          <FormCardField label={t("agents.fields.notes")} htmlFor={`${fieldId}-notes`}>
            <Textarea
              id={`${fieldId}-notes`}
              rows={2}
              value={form.notes}
              onChange={(event) => set("notes")(event.target.value)}
            />
          </FormCardField>
        </FormCardSection>
      </FormCardStack>
    </EnterpriseModal>
  );
}
