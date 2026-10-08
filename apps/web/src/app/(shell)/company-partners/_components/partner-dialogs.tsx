"use client";

import { useEffect, useId, useState } from "react";
import { Handshake, Percent, UserPlus, Wallet } from "lucide-react";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import {
  CreateOperationFooter,
  CreateOperationLayout,
  CreateOperationSummary,
} from "@/components/shared/create-operation";
import { ModalSection } from "@/components/shared/modal-section";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { EnterpriseDatePicker } from "@/components/shared/date-picker";
import { EntityCombobox } from "@/components/shared/entity-combobox";
import { SearchableSelect } from "@/components/shared/searchable-select";
import { MoneyInput } from "@/components/shared/money-input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AccountPicker } from "@/components/business/account-picker";
import { ReportMoney } from "@/components/accounting/financial-report/report-money";
import type { ChartOfAccountRow } from "@/config/master-data/entities";
import { percentText } from "@/config/company-partners/format";
import { agreementEndFromMonths } from "@/config/company-partners/period-statement";
import {
  companyPartnersService,
  type PartnerAgreementFrequency,
  type PartnerAgreementRow,
  type PartnerCandidate,
  type PartnerPaymentRow,
  type PartnerProfitBasis,
} from "@/services/company-partners-service";
import { useLocale } from "@/providers/locale-provider";
import { formatDate, fromISODate, toISODate } from "@/lib/date";
import { reportApiError, toast } from "@/lib/toast";

const BASES: PartnerProfitBasis[] = ["NET_PROFIT", "GROSS_PROFIT"];
const FREQUENCIES: PartnerAgreementFrequency[] = ["MONTHLY", "QUARTERLY", "ANNUAL"];

function Field({
  id,
  label,
  required,
  hint,
  children,
  wide,
}: {
  id?: string;
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "col-span-full flex flex-col gap-1" : "flex flex-col gap-1"}>
      <Label htmlFor={id}>
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </Label>
      {children}
      {hint ? <p className="text-caption text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function useBasisOptions() {
  const { t } = useLocale();
  return {
    basisOptions: BASES.map((value) => ({
      value,
      label: t(`companyPartners.basis.${value}`),
    })),
    frequencyOptions: FREQUENCIES.map((value) => ({
      value,
      label: t(`companyPartners.frequency.${value}`),
    })),
  };
}

type EndMode = "date" | "months";

/**
 * R15 (4.5) — an agreement ends on a date, or after a duration in months
 * (the end date is computed and shown); empty = open-ended. Reports the
 * resulting "YYYY-MM-DD" (or "") to the caller.
 */
function AgreementEndField({
  id,
  start,
  onChange,
}: {
  id: string;
  start: string;
  onChange: (effectiveTo: string) => void;
}) {
  const { t } = useLocale();
  const [mode, setMode] = useState<EndMode>("date");
  const [date, setDate] = useState("");
  const [months, setMonths] = useState("");
  const fromMonths = months.trim() ? agreementEndFromMonths(start, Number(months)) : null;
  const effectiveTo = mode === "date" ? date : (fromMonths ?? "");

  useEffect(() => {
    onChange(effectiveTo);
  }, [effectiveTo, onChange]);

  return (
    <Field
      id={id}
      label={t(`companyPartners.agreementDialog.endMode.${mode}`)}
      hint={
        mode === "months" && fromMonths
          ? t("companyPartners.agreementDialog.endsOn", { date: formatDate(fromMonths) })
          : effectiveTo
            ? undefined
            : t("companyPartners.agreementDialog.openEnded")
      }
    >
      <div className="flex min-w-0 items-center gap-2">
        <ToggleGroup
          type="single"
          value={mode}
          onValueChange={(next) => next && setMode(next as EndMode)}
          className="w-fit shrink-0"
        >
          <ToggleGroupItem size="sm" value="date">
            {t("companyPartners.agreementDialog.endMode.date")}
          </ToggleGroupItem>
          <ToggleGroupItem size="sm" value="months">
            {t("companyPartners.agreementDialog.endMode.months")}
          </ToggleGroupItem>
        </ToggleGroup>
        {mode === "date" ? (
          <EnterpriseDatePicker
            id={id}
            value={fromISODate(date)}
            onChange={(next) => setDate(next ? toISODate(next) : "")}
          />
        ) : (
          <Input
            id={id}
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            dir="ltr"
            placeholder={t("companyPartners.agreementDialog.months")}
            value={months}
            onChange={(e) => setMonths(e.target.value)}
          />
        )}
      </div>
    </Field>
  );
}

const firstOfMonth = () => {
  const today = new Date();
  return toISODate(new Date(today.getFullYear(), today.getMonth(), 1));
};

/** Add a company partner: an existing contact or a new one, optionally with its first agreement. */
export function AddPartnerDialog({
  open,
  onOpenChange,
  defaultFrequency,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The pool's frequency (one per company) — preselected so the agreement fits. */
  defaultFrequency: PartnerAgreementFrequency;
  onSaved: (partnerId: string) => void;
}) {
  const { t } = useLocale();
  const fieldId = useId();
  const { basisOptions, frequencyOptions } = useBasisOptions();
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [candidate, setCandidate] = useState<PartnerCandidate | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [ownership, setOwnership] = useState("");
  const [share, setShare] = useState("");
  const [basis, setBasis] = useState<PartnerProfitBasis>("NET_PROFIT");
  const [frequency, setFrequency] = useState<PartnerAgreementFrequency>(defaultFrequency);
  const [effectiveFrom, setEffectiveFrom] = useState(firstOfMonth());
  const [effectiveTo, setEffectiveTo] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMode("existing");
    setCandidate(null);
    setName("");
    setPhone("");
    setOwnership("");
    setShare("");
    setBasis("NET_PROFIT");
    setFrequency(defaultFrequency);
    setEffectiveFrom(firstOfMonth());
  }, [open, defaultFrequency]);

  const shareValue = Number(share);
  const hasShare = share.trim() !== "";
  const valid =
    (mode === "existing" ? Boolean(candidate) : name.trim().length > 0) &&
    (!hasShare || (shareValue > 0 && shareValue <= 100 && Boolean(effectiveFrom)));

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      const profile = await companyPartnersService.create({
        partnerId: mode === "existing" ? candidate?.id : undefined,
        name: mode === "new" ? name.trim() : undefined,
        phone: mode === "new" ? phone.trim() : undefined,
        ownershipPercent: ownership.trim() ? Number(ownership) : undefined,
      });
      toast.success(t("companyPartners.toasts.partnerAdded"));
      if (hasShare) {
        try {
          await companyPartnersService.createAgreement({
            partnerId: profile.partnerId,
            profitSharePercent: shareValue,
            basis,
            frequency,
            effectiveFrom,
            effectiveTo,
          });
          toast.success(t("companyPartners.toasts.agreementSaved"));
        } catch (error) {
          // The partner exists; the agreement can be added from the partner page.
          reportApiError(error, "errors.saveFailed");
        }
      }
      onSaved(profile.partnerId);
    } catch (error) {
      reportApiError(error, "errors.saveFailed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <EnterpriseModal
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      icon={UserPlus}
      title={t("companyPartners.addDialog.title")}
      description={t("companyPartners.addDialog.description")}
      footer={(requestClose) => (
        <CreateOperationFooter
          requestClose={requestClose}
          onSubmit={() => void save()}
          isSubmitting={saving}
          submitDisabled={!valid}
        />
      )}
    >
      <CreateOperationLayout>
        <ToggleGroup
          type="single"
          value={mode}
          onValueChange={(next) => next && setMode(next as "existing" | "new")}
          className="w-fit"
        >
          <ToggleGroupItem size="sm" value="existing">
            {t("companyPartners.addDialog.existing")}
          </ToggleGroupItem>
          <ToggleGroupItem size="sm" value="new">
            {t("companyPartners.addDialog.new")}
          </ToggleGroupItem>
        </ToggleGroup>
        <ModalSection title={t("companyPartners.fields.partner")} columns={2}>
          {mode === "existing" ? (
            <Field
              id={`${fieldId}-partner`}
              label={t("companyPartners.fields.partner")}
              required
              wide
            >
              <EntityCombobox
                id={`${fieldId}-partner`}
                value={candidate}
                onChange={setCandidate}
                onSearch={(search) => companyPartnersService.candidates(search)}
                getId={(row) => row.id}
                getTitle={(row) => row.name}
                getSubtitle={(row) =>
                  [row.partnerNumber, row.mobile ?? row.phone].filter(Boolean).join(" · ")
                }
                subtitleDir="ltr"
                placeholder={t("companyPartners.addDialog.pickPartner")}
                searchPlaceholder={t("companyPartners.addDialog.search")}
                emptyText={t("companyPartners.addDialog.noResults")}
              />
            </Field>
          ) : (
            <>
              <Field id={`${fieldId}-name`} label={t("companyPartners.fields.name")} required>
                <Input
                  id={`${fieldId}-name`}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>
              <Field id={`${fieldId}-phone`} label={t("companyPartners.fields.phone")}>
                <Input
                  id={`${fieldId}-phone`}
                  dir="ltr"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </Field>
            </>
          )}
          <Field
            id={`${fieldId}-ownership`}
            label={t("companyPartners.fields.ownershipPercent")}
            hint={t("companyPartners.fields.ownershipHint")}
          >
            <MoneyInput
              id={`${fieldId}-ownership`}
              value={ownership}
              onChange={(e) => setOwnership(e.target.value)}
            />
          </Field>
        </ModalSection>
        <ModalSection
          title={t("companyPartners.addDialog.agreementSection")}
          description={t("companyPartners.addDialog.agreementHint")}
          columns={2}
          optional
          collapsible
          defaultOpen
        >
          <Field id={`${fieldId}-share`} label={t("companyPartners.fields.profitShare")}>
            <MoneyInput
              id={`${fieldId}-share`}
              value={share}
              onChange={(e) => setShare(e.target.value)}
            />
          </Field>
          <Field
            id={`${fieldId}-basis`}
            label={t("companyPartners.fields.basis")}
            hint={t(`companyPartners.agreementDialog.basisHint.${basis}`)}
          >
            <SearchableSelect
              id={`${fieldId}-basis`}
              value={basis}
              onValueChange={(value) => setBasis(value as PartnerProfitBasis)}
              options={basisOptions}
            />
          </Field>
          <Field id={`${fieldId}-frequency`} label={t("companyPartners.fields.frequency")}>
            <SearchableSelect
              id={`${fieldId}-frequency`}
              value={frequency}
              onValueChange={(value) => setFrequency(value as PartnerAgreementFrequency)}
              options={frequencyOptions}
            />
          </Field>
          <Field id={`${fieldId}-from`} label={t("companyPartners.fields.effectiveFrom")}>
            <EnterpriseDatePicker
              id={`${fieldId}-from`}
              value={fromISODate(effectiveFrom)}
              onChange={(next) => setEffectiveFrom(next ? toISODate(next) : "")}
            />
          </Field>
          {open ? (
            <AgreementEndField
              id={`${fieldId}-to`}
              start={effectiveFrom}
              onChange={setEffectiveTo}
            />
          ) : null}
        </ModalSection>
      </CreateOperationLayout>
    </EnterpriseModal>
  );
}

export type AgreementDialogMode =
  | { kind: "new"; partnerId: string; frequency: PartnerAgreementFrequency }
  | { kind: "change"; agreement: PartnerAgreementRow }
  | { kind: "end"; agreement: PartnerAgreementRow };

/** New agreement / change share (supersede) / end — the three ways terms move; an active agreement is never edited. */
export function AgreementDialog({
  mode,
  onOpenChange,
  onSaved,
}: {
  mode: AgreementDialogMode | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const { t } = useLocale();
  const fieldId = useId();
  const { basisOptions, frequencyOptions } = useBasisOptions();
  const [share, setShare] = useState("");
  const [basis, setBasis] = useState<PartnerProfitBasis>("NET_PROFIT");
  const [frequency, setFrequency] = useState<PartnerAgreementFrequency>("MONTHLY");
  const [date, setDate] = useState(firstOfMonth());
  const [effectiveTo, setEffectiveTo] = useState("");
  const [activate, setActivate] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!mode) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShare(mode.kind === "change" ? String(mode.agreement.profitSharePercent) : "");
    setBasis(mode.kind === "new" ? "NET_PROFIT" : mode.agreement.basis);
    setFrequency(mode.kind === "new" ? mode.frequency : mode.agreement.frequency);
    setDate(firstOfMonth());
    setActivate(true);
  }, [mode]);

  if (!mode) return null;
  const shareValue = Number(share);
  const valid = Boolean(date) && (mode.kind === "end" || (shareValue > 0 && shareValue <= 100));

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      if (mode.kind === "new") {
        await companyPartnersService.createAgreement({
          partnerId: mode.partnerId,
          profitSharePercent: shareValue,
          basis,
          frequency,
          effectiveFrom: date,
          effectiveTo,
          activate,
        });
        toast.success(t("companyPartners.toasts.agreementSaved"));
      } else if (mode.kind === "change") {
        await companyPartnersService.supersedeAgreement(mode.agreement.id, {
          effectiveFrom: date,
          profitSharePercent: shareValue,
          basis,
        });
        toast.success(t("companyPartners.toasts.shareChanged"));
      } else {
        await companyPartnersService.endAgreement(mode.agreement.id, date);
        toast.success(t("companyPartners.toasts.agreementEnded"));
      }
      onSaved();
    } catch (error) {
      reportApiError(error, "errors.saveFailed");
    } finally {
      setSaving(false);
    }
  };

  const title =
    mode.kind === "new"
      ? t("companyPartners.agreementDialog.newTitle")
      : mode.kind === "change"
        ? t("companyPartners.agreementDialog.changeTitle")
        : t("companyPartners.agreementDialog.endTitle");
  const description =
    mode.kind === "change"
      ? t("companyPartners.agreementDialog.changeDescription")
      : mode.kind === "end"
        ? t("companyPartners.agreementDialog.endDescription")
        : undefined;

  return (
    <EnterpriseModal
      open
      onOpenChange={onOpenChange}
      size="md"
      icon={mode.kind === "end" ? Handshake : Percent}
      title={title}
      description={description}
      footer={(requestClose) => (
        <CreateOperationFooter
          requestClose={requestClose}
          onSubmit={() => void save()}
          isSubmitting={saving}
          submitDisabled={!valid}
        />
      )}
    >
      <CreateOperationLayout>
        {mode.kind !== "new" ? (
          <CreateOperationSummary
            title={t("companyPartners.summary.currentShare")}
            rows={[
              {
                label: t("companyPartners.fields.profitShare"),
                value: (
                  <span className="num">{percentText(mode.agreement.profitSharePercent)}</span>
                ),
              },
              {
                label: t("companyPartners.fields.basis"),
                value: t(`companyPartners.basis.${mode.agreement.basis}`),
              },
              {
                label: t("companyPartners.fields.effectiveFrom"),
                value: <span className="num">{mode.agreement.effectiveFrom}</span>,
              },
            ]}
          />
        ) : null}
        <ModalSection title={title} columns={2}>
          {mode.kind !== "end" ? (
            <>
              <Field
                id={`${fieldId}-share`}
                label={t("companyPartners.fields.profitShare")}
                required
              >
                <MoneyInput
                  id={`${fieldId}-share`}
                  value={share}
                  onChange={(e) => setShare(e.target.value)}
                />
              </Field>
              <Field
                id={`${fieldId}-basis`}
                label={t("companyPartners.fields.basis")}
                hint={t(`companyPartners.agreementDialog.basisHint.${basis}`)}
              >
                <SearchableSelect
                  id={`${fieldId}-basis`}
                  value={basis}
                  onValueChange={(value) => setBasis(value as PartnerProfitBasis)}
                  options={basisOptions}
                />
              </Field>
            </>
          ) : null}
          {mode.kind === "new" ? (
            <Field id={`${fieldId}-frequency`} label={t("companyPartners.fields.frequency")}>
              <SearchableSelect
                id={`${fieldId}-frequency`}
                value={frequency}
                onValueChange={(value) => setFrequency(value as PartnerAgreementFrequency)}
                options={frequencyOptions}
              />
            </Field>
          ) : null}
          <Field
            id={`${fieldId}-date`}
            label={
              mode.kind === "end"
                ? t("companyPartners.fields.effectiveTo")
                : t("companyPartners.fields.effectiveFrom")
            }
            required
          >
            <EnterpriseDatePicker
              id={`${fieldId}-date`}
              value={fromISODate(date)}
              onChange={(next) => setDate(next ? toISODate(next) : "")}
            />
          </Field>
          {mode.kind === "new" ? (
            <>
              <AgreementEndField id={`${fieldId}-to`} start={date} onChange={setEffectiveTo} />
              <Field id={`${fieldId}-status`} label={t("companyPartners.agreementDialog.status")}>
                <ToggleGroup
                  id={`${fieldId}-status`}
                  type="single"
                  value={activate ? "active" : "draft"}
                  onValueChange={(next) => next && setActivate(next === "active")}
                  className="w-fit"
                >
                  <ToggleGroupItem size="sm" value="active">
                    {t("companyPartners.agreementDialog.activateNow")}
                  </ToggleGroupItem>
                  <ToggleGroupItem size="sm" value="draft">
                    {t("companyPartners.agreementDialog.keepDraft")}
                  </ToggleGroupItem>
                </ToggleGroup>
              </Field>
            </>
          ) : null}
        </ModalSection>
      </CreateOperationLayout>
    </EnterpriseModal>
  );
}

/** Record a partner payment / withdrawal; above the payable it becomes an advance (shown, not blocked). */
export function PaymentDialog({
  partner,
  onOpenChange,
  onSaved,
}: {
  partner: { partnerId: string; name: string; payable: number } | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const { t } = useLocale();
  const fieldId = useId();
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(toISODate(new Date()));
  const [account, setAccount] = useState<ChartOfAccountRow | null>(null);
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!partner) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAmount(partner.payable > 0 ? String(partner.payable) : "");
    setDate(toISODate(new Date()));
    setAccount(null);
    setReference("");
    setNotes("");
  }, [partner]);

  if (!partner) return null;
  const value = Number(amount);
  const valid = value > 0 && Boolean(date) && Boolean(account);
  const overPayable = value > partner.payable;

  const save = async () => {
    if (!valid || !account) return;
    setSaving(true);
    try {
      await companyPartnersService.createPayment({
        partnerId: partner.partnerId,
        amount: value,
        date,
        financialAccountId: account.id,
        reference: reference.trim(),
        notes: notes.trim(),
      });
      toast.success(t("companyPartners.toasts.paymentRecorded"));
      onSaved();
    } catch (error) {
      reportApiError(error, "errors.saveFailed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <EnterpriseModal
      open
      onOpenChange={onOpenChange}
      size="md"
      icon={Wallet}
      title={t("companyPartners.paymentDialog.title")}
      description={partner.name}
      footer={(requestClose) => (
        <CreateOperationFooter
          requestClose={requestClose}
          onSubmit={() => void save()}
          isSubmitting={saving}
          submitDisabled={!valid}
        />
      )}
    >
      <CreateOperationLayout>
        <CreateOperationSummary
          title={t("companyPartners.summary.payable")}
          description={t("companyPartners.paymentDialog.description")}
          rows={[
            {
              label: t("companyPartners.summary.payable"),
              value: <ReportMoney value={partner.payable} align="inline" />,
            },
          ]}
        />
        {overPayable && value > 0 ? (
          <p className="text-caption text-warning-foreground" role="status">
            {t("companyPartners.paymentDialog.overPayable")}
          </p>
        ) : null}
        <ModalSection title={t("companyPartners.paymentDialog.title")} columns={2}>
          <Field id={`${fieldId}-amount`} label={t("companyPartners.fields.amount")} required>
            <MoneyInput
              id={`${fieldId}-amount`}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>
          <Field id={`${fieldId}-date`} label={t("companyPartners.fields.date")} required>
            <EnterpriseDatePicker
              id={`${fieldId}-date`}
              value={fromISODate(date)}
              onChange={(next) => setDate(next ? toISODate(next) : "")}
            />
          </Field>
          <Field
            id={`${fieldId}-account`}
            label={t("companyPartners.fields.financialAccount")}
            required
            wide
          >
            <AccountPicker
              id={`${fieldId}-account`}
              value={account}
              onChange={setAccount}
              accountType="ASSET"
              postingOnly
            />
          </Field>
          <Field id={`${fieldId}-reference`} label={t("companyPartners.fields.reference")}>
            <Input
              id={`${fieldId}-reference`}
              dir="ltr"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          </Field>
          <Field id={`${fieldId}-notes`} label={t("companyPartners.fields.notes")} wide>
            <Textarea
              id={`${fieldId}-notes`}
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>
        </ModalSection>
      </CreateOperationLayout>
    </EnterpriseModal>
  );
}

/** Reverse a payment with a reason (posts the mirror entry today). */
export function ReversePaymentDialog({
  payment,
  onOpenChange,
  onSaved,
}: {
  payment: PartnerPaymentRow | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const { t } = useLocale();
  const fieldId = useId();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (payment) setReason("");
  }, [payment]);

  const confirm = async () => {
    if (!payment || !reason.trim()) return;
    setBusy(true);
    try {
      await companyPartnersService.reversePayment(payment.id, reason.trim());
      toast.success(t("companyPartners.toasts.paymentReversed"));
      onSaved();
    } catch (error) {
      reportApiError(error, "errors.saveFailed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ConfirmationDialog
      open={Boolean(payment)}
      onOpenChange={onOpenChange}
      title={t("companyPartners.paymentDialog.reverseTitle")}
      description={t("companyPartners.paymentDialog.reverseDescription")}
      tone="destructive"
      confirmLabel={t("companyPartners.actions.reverse")}
      confirmDisabled={!reason.trim()}
      isConfirming={busy}
      onConfirm={() => void confirm()}
      extra={
        <div className="flex flex-col gap-1.5 px-6">
          <Label htmlFor={fieldId}>
            {t("companyPartners.fields.reason")} <span className="text-destructive">*</span>
          </Label>
          <Textarea
            id={fieldId}
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
      }
    />
  );
}
