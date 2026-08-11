"use client";

import { useEffect, useMemo, useState } from "react";
import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/min";
import { Check, TriangleAlert } from "lucide-react";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { useLocale } from "@/providers/locale-provider";
import {
  parsePhone,
  getCallingCode,
  getExampleNumber,
  type PhoneErrorReason,
} from "@/services/phone-service";
import type { MessageKey } from "@/i18n/translate";

/**
 * What the editable input itself should show for a committed value: just the
 * national number when it matches the locked "+CC" addon (never duplicate
 * the calling code the addon already displays), or the raw/international
 * value as-is otherwise — e.g. no country selected yet, or a region
 * mismatch, where showing the full number is the unambiguous choice.
 */
function nationalDisplayValue(rawValue: string, countryCode: string | null | undefined): string {
  if (!rawValue) return rawValue;
  const addonCallingCode = countryCode ? getCallingCode(countryCode) : null;
  if (!addonCallingCode) return rawValue;
  const parsed = parsePhone(rawValue, countryCode);
  if (parsed.isValid && parsed.nationalNumber && parsed.callingCode === addonCallingCode) {
    return parsed.nationalNumber;
  }
  return rawValue;
}

/**
 * The ONE phone number field for every OMS form (Part 3/14/27) — a locked
 * "+CC" prefix (from the selected country, never typed by the user) next to
 * an editable national-number input. Still accepts a pasted full
 * international/00-prefixed number in that same field (Part 8) — whatever
 * the user types is parsed as a whole, the prefix is a visual affordance,
 * not a separate input the value gets concatenated with.
 *
 * Deliberately does NOT reformat on every keystroke (Part 18) — typing
 * stays raw; parsing/validation runs live for the status icon, but the
 * value only gets normalized to E.164 on blur, and only when it's valid.
 * An invalid draft is left exactly as typed so the user can see and fix it.
 */
export function OMSPhoneInput({
  value,
  onChange,
  onBlur,
  countryCode,
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
  /** ISO2 region code from the form's own Country field — determines the "+CC" prefix and every validation/format rule. `null` while no country is selected yet. */
  countryCode: string | null | undefined;
  disabled?: boolean;
  readOnly?: boolean;
  placeholder?: string;
  "aria-invalid"?: boolean;
  id?: string;
}) {
  const { t } = useLocale();
  const [draft, setDraft] = useState(value ?? "");
  const [isFocused, setIsFocused] = useState(false);

  // Only re-sync from the outside value when the field isn't actively being
  // typed into — otherwise a parent re-render mid-keystroke would fight the
  // user's cursor.
  useEffect(() => {
    // Re-syncing a controlled external value into local draft state — only
    // while the field isn't focused, so a parent re-render never fights the
    // user's cursor mid-keystroke (same justified pattern as this
    // codebase's own auth-provider.tsx fetch-on-mount effect). Routed
    // through `nationalDisplayValue` so this is the one place that decides
    // how a committed E.164 value gets displayed next to the "+CC" addon.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!isFocused) setDraft(nationalDisplayValue(value ?? "", countryCode));
  }, [value, isFocused, countryCode]);

  const callingCode = countryCode ? getCallingCode(countryCode) : null;
  const example = countryCode ? getExampleNumber(countryCode) : null;

  const result = useMemo(() => parsePhone(draft, countryCode), [draft, countryCode]);
  const showStatus = draft.trim().length > 0 && !!countryCode;

  const handleBlur = () => {
    setIsFocused(false);
    if (draft.trim() && result.isValid && result.e164) {
      onChange(result.e164);
    } else if (!draft.trim()) {
      onChange("");
    } else {
      onChange(draft);
    }
    onBlur?.();
  };

  return (
    <div className="flex flex-col gap-1">
      <InputGroup className="h-(--control-height-md)" dir="ltr">
        {callingCode && (
          <InputGroupAddon className="text-foreground">+{callingCode}</InputGroupAddon>
        )}
        <InputGroupInput
          id={id}
          dir="ltr"
          inputMode="tel"
          autoComplete="tel"
          disabled={disabled}
          readOnly={readOnly}
          placeholder={placeholder ?? example ?? undefined}
          value={draft}
          aria-invalid={ariaInvalid ?? (showStatus && !result.isValid)}
          onFocus={() => setIsFocused(true)}
          onBlur={handleBlur}
          onChange={(event) => setDraft(event.target.value)}
        />
        {showStatus && (
          <InputGroupAddon align="inline-end">
            {result.isValid ? (
              <Check className="size-4 text-success" aria-label={t("phone.valid")} />
            ) : (
              <TriangleAlert
                className="size-4 text-destructive"
                aria-label={phoneErrorMessage(result.errorReason, countryCode, t)}
              />
            )}
          </InputGroupAddon>
        )}
      </InputGroup>
      {example && (
        <span className="text-caption text-muted-foreground">
          {t("phone.exampleLabel")}:{" "}
          <span dir="ltr">
            +{callingCode} {example}
          </span>
        </span>
      )}
      {result.regionMismatch && result.detectedRegion && (
        <RegionMismatchNote detectedRegion={result.detectedRegion} />
      )}
    </div>
  );
}

function RegionMismatchNote({ detectedRegion }: { detectedRegion: CountryCode }) {
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
    <p className="text-caption text-warning">
      {t("phone.regionMismatchDescription", { country: displayName })}
    </p>
  );
}

/** Maps a `PhoneErrorReason` to its Arabic-first i18n key — the one place that translation lives, reused by every consumer instead of a per-form switch statement. */
export function phoneErrorMessageKey(reason: PhoneErrorReason | null): MessageKey {
  return `phone.errors.${reason ?? "INVALID_PATTERN"}` as MessageKey;
}

/**
 * The full, actionable phone error message every form/field shows the user
 * (Part 3: "no technical validation errors, messages must be actionable") —
 * the base reason plus a real example number for the selected country
 * (never a fabricated one; `getExampleNumber` is the same library metadata
 * `OMSPhoneInput`'s own placeholder/hint already renders). Appends the
 * example only when one is available (a country is actually selected and
 * the library has metadata for it) — `EMPTY`/`INVALID_COUNTRY` never get one
 * since it wouldn't help fix either case.
 */
export function phoneErrorMessage(
  reason: PhoneErrorReason | null,
  countryCode: string | null | undefined,
  t: (key: MessageKey, params?: Record<string, string | number>) => string,
): string {
  const base = t(phoneErrorMessageKey(reason));
  if (reason === "EMPTY" || reason === "INVALID_COUNTRY") return base;

  const callingCode = countryCode ? getCallingCode(countryCode) : null;
  const example = countryCode ? getExampleNumber(countryCode) : null;
  if (!callingCode || !example) return base;

  return `${base} ${t("phone.errors.exampleSuffix", { example: `+${callingCode} ${example}` })}`;
}

/** Standalone validity check for a zod `.superRefine` — parses the same way the input itself does, so form-submit validation and the live status icon can never disagree. */
export function isPhoneValidForCountry(
  value: string | null | undefined,
  countryCode: string | null | undefined,
): boolean {
  if (!value?.trim()) return false;
  if (!countryCode) return !!parsePhoneNumberFromString(value.trim())?.isValid();
  return parsePhone(value, countryCode).isValid;
}
