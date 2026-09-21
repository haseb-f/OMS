"use client";

import { useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Loader2, MoreHorizontal } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmationDialog, type ConfirmationTone } from "@/components/shared/confirmation-dialog";
import { useKeyboardInset } from "@/hooks/use-keyboard-inset";
import { useLocale } from "@/providers/locale-provider";
import { cn } from "@/lib/utils";

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
  /** Legacy visual hint from older configs; `primary`/`destructive` win. */
  variant?: "default" | "outline" | "destructive" | "ghost";
  visibleForStatuses?: string[];
  confirm?: DocumentActionConfirmation;
  onAction: (context: TContext) => void | Promise<void>;
}

/**
 * The one action bar every document editor uses: exactly one primary
 * action for the current status, everything else in a compact "More" menu,
 * and a confirmation that states the next state/document and its effects
 * before any consequential transition runs. On phones the same bar is
 * pinned to the bottom of the screen above the keyboard, so the next step
 * is always reachable with a thumb.
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
  const secondary = visible.filter((action) => action !== primary && !action.destructive);
  const destructive = visible.filter((action) => action !== primary && action.destructive);
  const busy = Boolean(isBusy || running);

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

  const renderBar = (mobile: boolean) => (
    <div className={cn("flex items-center gap-2", mobile ? "w-full" : "flex-wrap justify-end")}>
      {leading}
      {primary ? (
        <EnterpriseButton
          type="button"
          size={mobile ? "default" : "sm"}
          className={cn("gap-1.5", mobile && "h-11 flex-1")}
          disabled={busy}
          onClick={() => trigger(primary)}
        >
          {running === primary.key ? (
            <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
          ) : primary.icon ? (
            <primary.icon className="size-3.5" />
          ) : null}
          {primary.label}
        </EnterpriseButton>
      ) : null}
      {secondary.length + destructive.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <EnterpriseButton
              type="button"
              variant="outline"
              size={mobile ? "icon" : "sm"}
              className={cn("gap-1.5", mobile && "size-11 shrink-0")}
              disabled={busy}
              aria-label={t("docFlow.actions.more")}
            >
              <MoreHorizontal className="size-4" />
              {mobile ? null : t("docFlow.actions.more")}
            </EnterpriseButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-48">
            {secondary.map((action) => (
              <DropdownMenuItem
                key={action.key}
                className="min-h-9 gap-2"
                onSelect={() => trigger(action)}
              >
                {action.icon ? <action.icon className="size-3.5" /> : null}
                {action.label}
              </DropdownMenuItem>
            ))}
            {destructive.length > 0 && secondary.length > 0 ? <DropdownMenuSeparator /> : null}
            {destructive.map((action) => (
              <DropdownMenuItem
                key={action.key}
                variant="destructive"
                className="min-h-9 gap-2"
                onSelect={() => trigger(action)}
              >
                {action.icon ? <action.icon className="size-3.5" /> : null}
                {action.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );

  return (
    <>
      <div className="hidden md:block">{renderBar(false)}</div>
      <div
        className="fixed inset-x-0 z-(--z-action-bar) border-t border-border bg-card px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-sm md:hidden"
        style={{ bottom: keyboardInset }}
      >
        {renderBar(true)}
      </div>
      <ConfirmationDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open && !running) setPending(null);
        }}
        tone={pending?.confirm?.tone ?? (pending?.destructive ? "destructive" : "default")}
        title={pending?.confirm?.title ?? ""}
        description={pending?.confirm?.description}
        confirmLabel={pending?.confirm?.confirmLabel ?? pending?.label}
        cancelLabel={t("common.close")}
        isConfirming={Boolean(pending && running === pending.key)}
        onConfirm={() => {
          if (!pending) return;
          const action = pending;
          void execute(action).finally(() => setPending(null));
        }}
      />
    </>
  );
}
