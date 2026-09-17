"use client";

import { forwardRef, type KeyboardEvent } from "react";
import { Search, X } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { useLocale } from "@/providers/locale-provider";
import { cn } from "@/lib/utils";

/**
 * The ONE search control in OMS (Component Unification task). The magnifier,
 * the field and the clear button all sit inside a single border — never an
 * icon absolutely positioned over a padded `Input`, and never a separately
 * bordered "Search" button beside the field, both of which read as two
 * controls for one job.
 *
 * Searching is always live: `onValueChange` fires per keystroke and the
 * caller debounces with `useDebouncedValue` when it talks to the API. The
 * optional `onSubmit` only exists for surfaces where Enter should *also*
 * force an immediate fetch (a lookup dialog); it is never the only way to
 * run the search.
 */
export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  {
    value,
    onValueChange,
    onSubmit,
    onClear,
    placeholder,
    isLoading = false,
    disabled,
    autoFocus,
    className,
    inputClassName,
    clearLabel,
    id,
    name,
    dir,
    "aria-label": ariaLabel,
  },
  ref,
) {
  const { t } = useLocale();

  // `onClear` fully replaces the default when given, so a caller that has to
  // cancel an in-flight debounce or reset results does that once — not on top
  // of a redundant `onValueChange("")`.
  const clear = () => {
    if (onClear) {
      onClear();
      return;
    }
    onValueChange("");
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && onSubmit) {
      event.preventDefault();
      onSubmit(value);
      return;
    }
    // Escape clears the field rather than bubbling to close the surrounding
    // dialog/popover, which would discard the user's place in the list.
    if (event.key === "Escape" && value) {
      event.preventDefault();
      event.stopPropagation();
      clear();
    }
  };

  return (
    <InputGroup
      className={cn("h-(--control-height-sm) max-w-(--width-control-search)", className)}
      data-slot="search-input"
    >
      <InputGroupInput
        ref={ref}
        id={id}
        name={name}
        dir={dir}
        type="text"
        role="searchbox"
        autoComplete="off"
        autoFocus={autoFocus}
        disabled={disabled}
        aria-label={ariaLabel ?? placeholder ?? t("common.search")}
        placeholder={placeholder ?? t("common.search")}
        value={value}
        className={inputClassName}
        onChange={(event) => onValueChange(event.target.value)}
        onKeyDown={handleKeyDown}
      />
      <InputGroupAddon>
        {isLoading ? (
          <Spinner aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        ) : (
          <Search aria-hidden className="size-4 shrink-0 opacity-50" />
        )}
      </InputGroupAddon>
      {value && !disabled ? (
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            type="button"
            size="icon-xs"
            aria-label={clearLabel ?? t("table.clearSearch")}
            onClick={clear}
          >
            <X />
          </InputGroupButton>
        </InputGroupAddon>
      ) : null}
    </InputGroup>
  );
});

export type SearchInputProps = {
  value: string;
  onValueChange: (value: string) => void;
  /** Enter-to-search, for surfaces that also fetch on demand. */
  onSubmit?: (value: string) => void;
  /**
   * Replaces the default `onValueChange("")` — for callers that must also
   * cancel a pending debounce or drop fetched results.
   */
  onClear?: () => void;
  placeholder?: string;
  /** Swaps the magnifier for a spinner while results are in flight. */
  isLoading?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  className?: string;
  inputClassName?: string;
  clearLabel?: string;
  id?: string;
  name?: string;
  dir?: "ltr" | "rtl";
  "aria-label"?: string;
};
