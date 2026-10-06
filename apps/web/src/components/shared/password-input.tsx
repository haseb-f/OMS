"use client";

import { forwardRef, useCallback, useRef, useState, type ComponentProps } from "react";
import { Eye, EyeOff, RefreshCw, WandSparkles } from "lucide-react";
import { Input } from "@/components/ui/input";
import { IconActionButton } from "@/components/shared/icon-action-button";
import { CopyButton } from "@/components/shared/copy-button";
import { generateSecurePassword } from "@/lib/password-generator";
import { cn } from "@/lib/utils";
import { useLocale } from "@/providers/locale-provider";

export type PasswordInputProps = Omit<ComponentProps<typeof Input>, "type"> & {
  /** Show the Copy action (copies what is typed right now). Default true. */
  copyable?: boolean;
  /**
   * Opt-in Generate / Regenerate action (R13 A2) — only where an authorized
   * person SETS a password for someone else (user create, admin reset). Fills
   * the field with a policy-compliant password from `crypto.getRandomValues`,
   * reveals it and reports it through the normal `onChange`.
   */
  generatable?: boolean;
  /** Called after a password was generated into the field (e.g. to mark it temporary). */
  onGenerated?: (password: string) => void;
  /** Start revealed — for a password the form itself suggested and the admin must see to pass on. */
  defaultVisible?: boolean;
};

/**
 * Writes `next` into the input the way typing would, so React's `onChange`
 * (controlled, RHF or uncontrolled) sees it: the native value setter bypasses
 * React's value tracker, then a bubbling `input` event is dispatched.
 */
function setNativeInputValue(input: HTMLInputElement, next: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, next);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

/**
 * The ONE password field (R6 B1) — standalone, and the control inside the
 * RHF `PasswordFormField`. Masked by default; Show/Hide; Copy of the value
 * currently TYPED (read from the field itself — a stored password is never
 * fetched); paste allowed; the caller's `autoComplete` is kept
 * (`current-password` / `new-password`). The value is never logged or
 * persisted here.
 *
 * LTR value (cursor and characters) with the actions in a local `dir="ltr"`
 * wrapper, so padding-end and the icons stay on the same side in an RTL page.
 * Every prop (id, aria-*, value/onChange, ref) reaches the `<input>`, so it
 * works under a `FormControl` slot.
 *
 * Copy confirms with the button's own «Copied» state AND a "Password copied"
 * toast. The generated value is never logged, stored or sent anywhere but the
 * form that owns the field.
 */
export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  function PasswordInput(
    {
      className,
      disabled,
      copyable = true,
      generatable = false,
      onGenerated,
      defaultVisible = false,
      value,
      defaultValue,
      onChange,
      inputSize,
      readOnly,
      ...props
    },
    ref,
  ) {
    const { t } = useLocale();
    const [visible, setVisible] = useState(defaultVisible);
    const inputRef = useRef<HTMLInputElement | null>(null);
    // Controlled: the prop says whether there is anything to copy;
    // uncontrolled: tracked from the input's own changes.
    const [typedLength, setTypedLength] = useState(() => String(defaultValue ?? "").length);
    const hasValue = value !== undefined ? String(value ?? "").length > 0 : typedLength > 0;

    const setRefs = useCallback(
      (node: HTMLInputElement | null) => {
        inputRef.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) ref.current = node;
      },
      [ref],
    );

    const toggleLabel = visible ? t("auth.hidePassword") : t("auth.showPassword");
    // Dense fields (sm/xs) take the 24px icon buttons so they sit inside the border.
    const dense = inputSize === "sm" || inputSize === "xs";
    const canGenerate = generatable && !disabled && !readOnly;
    const actionCount = 1 + (copyable ? 1 : 0) + (generatable ? 1 : 0);
    // Room for the in-field actions at the inline end (24px dense / 32px icons).
    const endPadding = dense
      ? (["pe-8", "pe-14", "pe-20"] as const)[actionCount - 1]
      : (["pe-10", "pe-16", "pe-24"] as const)[actionCount - 1];

    const generate = () => {
      const input = inputRef.current;
      if (!input) return;
      const password = generateSecurePassword();
      setNativeInputValue(input, password);
      setVisible(true);
      onGenerated?.(password);
    };

    return (
      <div className="relative w-full" dir="ltr" data-slot="password-input">
        <Input
          {...props}
          inputSize={inputSize}
          ref={setRefs}
          value={value}
          defaultValue={defaultValue}
          onChange={(event) => {
            setTypedLength(event.target.value.length);
            onChange?.(event);
          }}
          dir="ltr"
          type={visible ? "text" : "password"}
          disabled={disabled}
          readOnly={readOnly}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="none"
          className={cn(endPadding, className)}
        />
        <div className="absolute inset-y-0 end-0 flex items-center gap-0.5 pe-1">
          {generatable ? (
            <IconActionButton
              label={hasValue ? t("controls.password.regenerate") : t("controls.password.generate")}
              disabled={!canGenerate}
              className={dense ? "size-(--control-height-xs)" : undefined}
              onMouseDown={(event) => event.preventDefault()}
              onClick={generate}
            >
              {hasValue ? (
                <RefreshCw className="size-4" aria-hidden />
              ) : (
                <WandSparkles className="size-4" aria-hidden />
              )}
            </IconActionButton>
          ) : null}
          {copyable ? (
            <CopyButton
              size={dense ? "xs" : "sm"}
              label={t("controls.password.label")}
              value={() => inputRef.current?.value}
              disabled={disabled || !hasValue}
              successToast={t("controls.password.copied")}
              preserveFocus
            />
          ) : null}
          <IconActionButton
            label={toggleLabel}
            disabled={disabled}
            pressed={visible}
            className={dense ? "size-(--control-height-xs)" : undefined}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setVisible((current) => !current)}
          >
            {visible ? (
              <EyeOff className="size-4" aria-hidden />
            ) : (
              <Eye className="size-4" aria-hidden />
            )}
          </IconActionButton>
        </div>
      </div>
    );
  },
);
