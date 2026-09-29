"use client";

import { useEffect, useMemo, useRef, useState, type ClipboardEvent } from "react";
import type { CountryCode } from "libphonenumber-js/min";
import { Check, TriangleAlert, X } from "lucide-react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { EnterpriseButton } from "@/components/ui/button";
import { useLocale } from "@/providers/locale-provider";
import {
  parsePhone,
  getCallingCode,
  getExampleNumber,
  getPhonePlaceholder,
  phoneInputDisplayValue,
  resolvePastedPhone,
  type PhoneErrorReason,
} from "@/services/phone-service";
import type { MessageKey } from "@/i18n/translate";

/**
 * The ONE phone number field for every OMS form — a locked "+CC" prefix
 * (from the selected country, never typed by the user) next to an editable
 * national-number input, always LTR inside RTL forms. Still accepts a pasted
 * full international / 00-prefixed number in the same box.
 *
 * Behaviour (specs/usability-financial-reports/phone-field.md):
 * - Typing stays raw; the value is committed as E.164 on blur (or on paste
 *   of a complete number). An invalid draft is committed exactly as typed.
 * - No error indicator while focused or mid-typing — the error ring and
 *   message appear after blur, or when the form forces validation (submit).
 *   A check mark appears as soon as the number is valid.
 * - A number whose calling code differs from the selected country (pasted
 *   "+20…" while "+966" is selected, or the country changed afterwards) is
 *   never silently rewritten or re-homed: the conflict is explained, and when
 *   the form owns the country an explicit "Switch country to …" action is
 *   offered.
 */
export function OMSPhoneInput({
  value,
  onChange,
  onBlur,
  countryCode,
  onCountryChange,
  availableCountryCodes,
  forceValidation,
  disabled,
  readOnly,
  placeholder,
  "aria-invalid": ariaInvalid,
  id,
}: {
  /** The committed value — an E.164 string once valid, or whatever raw text the user last typed while it's still invalid. */
  value: string | null | undefined;
  onChange: (value: string) => void;
  onBlur?: () => void;
  /** ISO2 region code of the phone's country — determines the "+CC" prefix and every validation/format rule. `null` while no country is selected yet. */
  countryCode: string | null | undefined;
  /** When the form owns the country: offered as an explicit "Switch country to …" action on a calling-code conflict. Never called automatically. */
  onCountryChange?: (iso2: CountryCode) => void;
  /** ISO2 codes `onCountryChange` can actually switch to (the form's own country list). Omit to allow any. */
  availableCountryCodes?: readonly string[];
  /** Show the validation state even before the first blur — pass the form's "submit attempted" flag. */
  forceValidation?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  placeholder?: string;
  "aria-invalid"?: boolean;
  id?: string;
}) {
  const { t } = useLocale();
  const [draft, setDraft] = useState(() => phoneInputDisplayValue(value, countryCode));
  const [isFocused, setIsFocused] = useState(false);
  const [touched, setTouched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Re-syncing a controlled external value into local draft state — only
    // while the field isn't focused, so a parent re-render never fights the
    // user's cursor mid-keystroke. `phoneInputDisplayValue` is the one place
    // that decides how a committed value is shown next to the "+CC" addon.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!isFocused) setDraft(phoneInputDisplayValue(value, countryCode));
  }, [value, isFocused, countryCode]);

  const callingCode = countryCode ? getCallingCode(countryCode) : null;
  const result = useMemo(() => parsePhone(draft, countryCode), [draft, countryCode]);
  const hasDraft = draft.trim().length > 0;
  const showValidation = !isFocused && (touched || !!forceValidation);
  const showError = showValidation && hasDraft && !result.isValid;
  const invalid = !isFocused && (!!ariaInvalid || showError);
  const conflict =
    result.isValid && result.regionMismatch && result.detectedRegion ? result.detectedRegion : null;

  const handleBlur = () => {
    setIsFocused(false);
    setTouched(true);
    // Untouched: never rewrite a stored value (e.g. a legacy non-E.164 row)
    // just because the field was focused — it's normalized only when edited.
    const untouched = draft === phoneInputDisplayValue(value, countryCode);
    if (!untouched) {
      onChange(!hasDraft ? "" : result.isValid && result.e164 ? result.e164 : draft);
    }
    onBlur?.();
  };

  // A pasted complete number replaces the field: same calling code → the
  // national part (no duplicated "+966"); another calling code → kept in
  // full and the conflict shown. Partial pastes fall through to the browser.
  const handlePaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const resolution = resolvePastedPhone(event.clipboardData.getData("text"), countryCode);
    if (resolution.kind === "raw") return;
    event.preventDefault();
    setDraft(resolution.display);
    onChange(resolution.e164);
  };

  const handleClear = () => {
    setDraft("");
    setTouched(false);
    onChange("");
    inputRef.current?.focus();
  };

  return (
    <div className="flex flex-col gap-1">
      <InputGroup className="h-(--control-height-md)" dir="ltr">
        {/* The locked prefix only describes a national number — once the
            draft carries its own "+CC" it would read as a second code. */}
        {callingCode && !draft.trim().startsWith("+") && (
          <InputGroupAddon className="text-foreground tabular-nums" aria-hidden>
            +{callingCode}
          </InputGroupAddon>
        )}
        <InputGroupInput
          ref={inputRef}
          id={id}
          dir="ltr"
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          disabled={disabled}
          readOnly={readOnly}
          placeholder={placeholder ?? getPhonePlaceholder(countryCode) ?? undefined}
          value={draft}
          aria-invalid={invalid || undefined}
          onFocus={() => setIsFocused(true)}
          onBlur={handleBlur}
          onPaste={handlePaste}
          onChange={(event) => setDraft(event.target.value)}
        />
        {hasDraft && (result.isValid || showError) && !!countryCode && (
          <InputGroupAddon align="inline-end">
            {conflict ? (
              <TriangleAlert className="size-4 text-warning" aria-hidden />
            ) : result.isValid ? (
              <Check className="size-4 text-success" aria-label={t("phone.valid")} />
            ) : (
              <TriangleAlert className="size-4 text-destructive" aria-hidden />
            )}
          </InputGroupAddon>
        )}
        {!disabled && !readOnly && hasDraft && (
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={t("phone.clear")}
              onClick={handleClear}
            >
              <X className="size-3.5" />
            </InputGroupButton>
          </InputGroupAddon>
        )}
      </InputGroup>
      {/* The field's own message — suppressed when the form already shows one (aria-invalid from its schema). */}
      {showError && !ariaInvalid && (
        <p className="text-caption text-destructive" role="alert">
          {phoneErrorMessage(result.errorReason, countryCode, t)}
        </p>
      )}
      {conflict && (
        <RegionConflictNote
          detectedRegion={conflict}
          callingCode={result.callingCode}
          onSwitch={
            onCountryChange && (!availableCountryCodes || availableCountryCodes.includes(conflict))
              ? () => onCountryChange(conflict)
              : undefined
          }
        />
      )}
    </div>
  );
}

function RegionConflictNote({
  detectedRegion,
  callingCode,
  onSwitch,
}: {
  detectedRegion: CountryCode;
  callingCode: string | null;
  onSwitch?: () => void;
}) {
  const { locale, t } = useLocale();
  const displayName = useMemo(() => {
    try {
      return (
        new Intl.DisplayNames([locale], { type: "region" }).of(detectedRegion) ?? detectedRegion
      );
    } catch {
      return detectedRegion;
    }
  }, [locale, detectedRegion]);
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <p className="text-caption text-warning">
        {t("phone.regionMismatchDescription", {
          country: displayName,
          callingCode: callingCode ? `+${callingCode}` : "",
        })}
      </p>
      {onSwitch && (
        <EnterpriseButton
          type="button"
          variant="link"
          size="sm"
          className="h-auto p-0"
          onClick={onSwitch}
        >
          {t("phone.switchCountry", { country: displayName })}
        </EnterpriseButton>
      )}
    </div>
  );
}

/** Maps a `PhoneErrorReason` to its Arabic-first i18n key — the one place that translation lives, reused by every consumer instead of a per-form switch statement. */
export function phoneErrorMessageKey(reason: PhoneErrorReason | null): MessageKey {
  return `phone.errors.${reason ?? "INVALID_PATTERN"}` as MessageKey;
}

/**
 * The full, actionable phone error message every form/field shows the user —
 * the base reason plus a real example number for the selected country
 * (library metadata, never fabricated). `EMPTY`/`INVALID_COUNTRY` never get
 * an example since it wouldn't help fix either case.
 */
export function phoneErrorMessage(
  reason: PhoneErrorReason | null,
  countryCode: string | null | undefined,
  t: (key: MessageKey, params?: Record<string, string | number>) => string,
): string {
  // No country selected and the number carries no "+CC" either: nothing is
  // "mismatched" yet — the user needs to pick a country (or type the code).
  if (reason === "INVALID_COUNTRY" && !countryCode) return t("phone.errors.COUNTRY_REQUIRED");
  const base = t(phoneErrorMessageKey(reason));
  if (reason === "EMPTY" || reason === "INVALID_COUNTRY") return base;

  const callingCode = countryCode ? getCallingCode(countryCode) : null;
  const example = countryCode ? getExampleNumber(countryCode) : null;
  if (!callingCode || !example) return base;

  return `${base} ${t("phone.errors.exampleSuffix", { example: `+${callingCode} ${example}` })}`;
}

/** Standalone validity check for a zod `.superRefine` — parses the same way the input itself does, so form-submit validation and the field's own state can never disagree. */
export function isPhoneValidForCountry(
  value: string | null | undefined,
  countryCode: string | null | undefined,
): boolean {
  if (!value?.trim()) return false;
  return parsePhone(value, countryCode).isValid;
}
