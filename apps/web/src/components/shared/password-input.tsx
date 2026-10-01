"use client";

import { forwardRef, useCallback, useRef, useState, type ComponentProps } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { IconActionButton } from "@/components/shared/icon-action-button";
import { CopyButton } from "@/components/shared/copy-button";
import { cn } from "@/lib/utils";
import { useLocale } from "@/providers/locale-provider";

export type PasswordInputProps = Omit<ComponentProps<typeof Input>, "type"> & {
  /** Show the Copy action (copies what is typed right now). Default true. */
  copyable?: boolean;
};

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
 */
export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  function PasswordInput(
    { className, disabled, copyable = true, value, defaultValue, onChange, inputSize, ...props },
    ref,
  ) {
    const { t } = useLocale();
    const [visible, setVisible] = useState(false);
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
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="none"
          className={cn(
            copyable ? (dense ? "pe-14" : "pe-16") : dense ? "pe-8" : "pe-10",
            className,
          )}
        />
        <div className="absolute inset-y-0 end-0 flex items-center gap-0.5 pe-1">
          {copyable ? (
            <CopyButton
              size={dense ? "xs" : "sm"}
              label={t("controls.password.label")}
              value={() => inputRef.current?.value}
              disabled={disabled || !hasValue}
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
