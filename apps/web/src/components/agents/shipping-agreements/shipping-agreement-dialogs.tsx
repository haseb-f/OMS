"use client";

import { useId, useState } from "react";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useLocale } from "@/providers/locale-provider";
import { formatDate } from "@/lib/date";
import type { ShippingAgreementDetail } from "./shipping-agreements-api";
import { agreementPeriod, canConfirmActivation, destinationName } from "./shipping-agreement-view";

/**
 * Activate a DRAFT (spec-w3 §1): shows what the server's activation check
 * found — the service × destination combinations still missing (a warning,
 * never a block), and an overlapping ACTIVE agreement with the "replace from
 * <date>" choice when it started earlier (else the overlap blocks).
 */
export function ActivateShippingAgreementDialog({
  agreement,
  isBusy,
  onOpenChange,
  onConfirm,
}: {
  agreement: ShippingAgreementDetail;
  isBusy: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (replaceFrom: boolean) => void;
}) {
  const { t, locale } = useLocale();
  const replaceId = useId();
  const [replaceFrom, setReplaceFrom] = useState(false);
  const activation = agreement.activation;
  const overlap = activation?.overlapping[0] ?? null;
  const openEnded = t("agentShippingAgreements.openEnded");

  // Missing combinations grouped per destination: "Egypt / Cairo: Carrier · prepaid, …".
  const missing = new Map<string, { destination: string; services: string[] }>();
  for (const item of agreement.coverage.missing) {
    const entry = missing.get(item.destinationKey) ?? {
      destination: destinationName(item, locale) ?? t("agentShippingAgreements.allDestinations"),
      services: [],
    };
    entry.services.push(t(`agentShippingAgreements.services.${item.service}`));
    missing.set(item.destinationKey, entry);
  }

  return (
    <ConfirmationDialog
      open
      onOpenChange={onOpenChange}
      tone="success"
      size="lg"
      title={t("agentShippingAgreements.activate.title", { number: agreement.agreementNumber })}
      description={t("agentShippingAgreements.activate.description", {
        period: agreementPeriod(agreement, openEnded),
      })}
      extra={
        <div className="flex flex-col gap-2 text-caption">
          {activation?.problems.includes("SHIPPING_AGREEMENT_NO_RATES") ? (
            <p className="text-destructive">{t("agentShippingAgreements.activate.noRates")}</p>
          ) : null}
          {overlap && activation?.replaceCloses ? (
            <label htmlFor={replaceId} className="flex items-start gap-2 text-body select-none">
              <Checkbox
                id={replaceId}
                checked={replaceFrom}
                onCheckedChange={(checked) => setReplaceFrom(checked === true)}
              />
              {t("agentShippingAgreements.activate.replace", {
                number: overlap.agreementNumber,
                from: formatDate(agreement.effectiveFrom),
                closes: formatDate(activation.replaceCloses),
              })}
            </label>
          ) : overlap ? (
            <p className="text-destructive">
              {t("agentShippingAgreements.activate.overlap", {
                number: overlap.agreementNumber,
                period: agreementPeriod(overlap, openEnded),
              })}
            </p>
          ) : null}
          {agreement.rates.length === 0 ? null : agreement.coverage.complete ? (
            <p className="text-muted-foreground">{t("agentShippingAgreements.coverageComplete")}</p>
          ) : (
            <div className="flex flex-col gap-1 text-warning-soft-foreground">
              <p className="font-medium">{t("agentShippingAgreements.activate.missingTitle")}</p>
              <ul className="flex flex-col gap-0.5 ps-4">
                {[...missing.values()].map((entry) => (
                  <li key={entry.destination} className="list-disc">
                    {entry.destination}: {entry.services.join(locale === "ar" ? "، " : ", ")}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      }
      confirmLabel={t("agentShippingAgreements.actions.activate")}
      confirmDisabled={!canConfirmActivation(activation, replaceFrom)}
      isConfirming={isBusy}
      onConfirm={() => onConfirm(replaceFrom)}
    />
  );
}

/** ACTIVE → INACTIVE with a required reason (it stays in the history). */
export function DeactivateShippingAgreementDialog({
  agreement,
  isBusy,
  onOpenChange,
  onConfirm,
}: {
  agreement: ShippingAgreementDetail;
  isBusy: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: string) => void;
}) {
  const { t } = useLocale();
  const reasonId = useId();
  const [reason, setReason] = useState("");
  return (
    <ConfirmationDialog
      open
      onOpenChange={onOpenChange}
      tone="destructive"
      title={t("agentShippingAgreements.deactivate.title", { number: agreement.agreementNumber })}
      description={t("agentShippingAgreements.deactivate.description")}
      extra={
        <div className="flex flex-col gap-1">
          <Label htmlFor={reasonId}>{t("agentShippingAgreements.deactivate.reason")}</Label>
          <Textarea
            id={reasonId}
            rows={2}
            maxLength={500}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
      }
      confirmLabel={t("agentShippingAgreements.actions.deactivate")}
      confirmDisabled={!reason.trim()}
      isConfirming={isBusy}
      onConfirm={() => onConfirm(reason.trim())}
    />
  );
}
