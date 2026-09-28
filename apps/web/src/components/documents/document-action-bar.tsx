"use client";

import { cloneElement, isValidElement, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import { ConfirmationDialog, type ConfirmationTone } from "@/components/shared/confirmation-dialog";
import {
  HeaderActions,
  type ActionSpec,
  type DestructiveActionSpec,
} from "@/components/shared/header-actions";
import { useKeyboardInset } from "@/hooks/use-keyboard-inset";
import { useLocale } from "@/providers/locale-provider";

/** Explains, before it happens, what a transition creates and changes. */
export interface DocumentActionConfirmation {
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  tone?: ConfirmationTone;
}

export interface DocumentAction<TContext = void> {
  key: string;
  label: string;
  icon?: LucideIcon;
  /** The single next step for the current status — rendered as the one filled button. */
  primary?: boolean;
  /** Irreversible/negative (Cancel, Archive) — listed last, in red. */
  destructive?: boolean;
  /**
   * A frequent secondary action shown inline (outline) on sm+ — at most two
   * are shown; everything else lives in «المزيد». Print is secondary by
   * default.
   */
  secondary?: boolean;
  /**
   * A confirming step (Approve, Confirm, Post): drawn in the refined green
   * success variant when it is the primary (design-system §12.4).
   */
  success?: boolean;
  /** Legacy visual hint from older configs; `primary`/`destructive` win. */
  variant?: "default" | "outline" | "destructive" | "ghost";
  visibleForStatuses?: string[];
  confirm?: DocumentActionConfirmation;
  onAction: (context: TContext) => void | Promise<void>;
}

const isSecondary = (action: { key: string; secondary?: boolean }) =>
  action.secondary ?? action.key === "print";

/**
 * The one action bar every document editor uses, built on the shared
 * `HeaderActions` (design-system §11.2): exactly one filled primary for the
 * current status, up to two frequent secondary actions (outline), the rest
 * in «المزيد», and destructive actions separated in red at the bottom of that
 * menu. Every consequential transition states its next state/effects in a
 * confirmation before it runs.
 *
 * Phones (<768px): the same controls are pinned to the bottom of the screen
 * above the keyboard, with the primary stretched to a full tap target.
 */
export function DocumentActionBar<TContext>({
  status,
  actions,
  context,
  leading,
  isBusy,
  isNew = false,
}: {
  status: string;
  /** Unsaved document: only Save is offered until it has a number. */
  isNew?: boolean;
  actions: DocumentAction<TContext>[];
  context: TContext;
  /** Save/Discard — always first, never hidden in the menu. */
  leading?: ReactNode;
  isBusy?: boolean;
}) {
  const { t } = useLocale();
  const keyboardInset = useKeyboardInset();
  const [pending, setPending] = useState<DocumentAction<TContext> | null>(null);
  const [running, setRunning] = useState<string | null>(null);

  const visible = isNew
    ? []
    : actions.filter(
        (action) => !action.visibleForStatuses || action.visibleForStatuses.includes(status),
      );
  const primary = visible.find((action) => action.primary) ?? null;
  const rest = visible.filter((action) => action !== primary && !action.destructive);
  const destructive = visible.filter((action) => action !== primary && action.destructive);
  const busy = Boolean(isBusy || running);
  // Exactly one filled button per bar: while a status transition is the
  // primary action — or Save is unavailable (a posted document) — a leading
  // Save button is shown as secondary (outline), never as a greyed primary.
  const leadingControl =
    isValidElement<{ variant?: string; disabled?: boolean }>(leading) &&
    leading.type === EnterpriseButton &&
    (primary || leading.props.disabled)
      ? cloneElement(leading, { variant: "outline" })
      : leading;

  const execute = async (action: DocumentAction<TContext>) => {
    setRunning(action.key);
    try {
      await action.onAction(context);
    } finally {
      setRunning(null);
    }
  };

  const trigger = (action: DocumentAction<TContext>) => {
    if (action.confirm) {
      setPending(action);
      return;
    }
    void execute(action);
  };

  const toSpec = (action: DocumentAction<TContext>): ActionSpec => ({
    key: action.key,
    label: action.label,
    icon: action.icon,
    disabled: busy,
    loading: running === action.key,
    onSelect: () => trigger(action),
  });

  const destructiveSpecs: DestructiveActionSpec[] = destructive.map((action) => ({
    ...toSpec(action),
    // HeaderActions confirms destructive actions itself — run directly after it.
    onSelect: () => execute(action),
    confirm: {
      title: action.confirm?.title ?? action.label,
      description: action.confirm?.description,
      confirmLabel: action.confirm?.confirmLabel ?? action.label,
    },
  }));

  return (
    <>
      <div
        data-slot="document-action-bar"
        className="max-md:fixed max-md:inset-x-0 max-md:z-(--z-action-bar) max-md:border-t max-md:border-border max-md:bg-card max-md:px-3 max-md:pt-2 max-md:pb-[max(0.5rem,env(safe-area-inset-bottom))]"
        style={{ bottom: keyboardInset }}
      >
        <HeaderActions
          className="max-md:flex-nowrap max-md:[&>button]:h-(--control-height-lg) max-md:[&>button:last-child]:flex-1"
          primary={
            primary
              ? {
                  ...toSpec(primary),
                  ...(primary.success ? { variant: "success" as const } : {}),
                }
              : undefined
          }
          secondary={rest.filter(isSecondary).map(toSpec)}
          more={rest.filter((action) => !isSecondary(action)).map(toSpec)}
          destructive={destructiveSpecs}
          inline={leadingControl}
        />
      </div>
      <ConfirmationDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
        tone={pending?.confirm?.tone ?? (pending?.success ? "success" : "default")}
        title={pending?.confirm?.title ?? ""}
        description={pending?.confirm?.description}
        confirmLabel={pending?.confirm?.confirmLabel ?? pending?.label}
        cancelLabel={t("common.close")}
        onConfirm={() => {
          if (!pending) return;
          // Close the confirmation before running: a follow-up step (e.g. an
          // exchange-rate request) then appears on its own, and the primary
          // button shows progress meanwhile.
          const action = pending;
          setPending(null);
          void execute(action);
        }}
      />
    </>
  );
}
