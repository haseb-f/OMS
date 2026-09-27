"use client";

import { Fragment, isValidElement, useState, type ReactElement, type ReactNode } from "react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Ellipsis } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { useIsMobile } from "@/hooks/use-mobile";
import { useLocale } from "@/providers/locale-provider";
import { cn } from "@/lib/utils";

/**
 * One header action. Exactly one of `onSelect` / `href` drives it. When the
 * action moves into the overflow menu its `testId` travels with it (as the
 * menu item's `data-testid`), and its label stays the accessible name.
 */
export interface ActionSpec {
  key: string;
  label: string;
  icon?: LucideIcon;
  onSelect?: () => void | Promise<unknown>;
  href?: string;
  disabled?: boolean;
  loading?: boolean;
  /** Omit the action entirely (permission / state does not allow it). */
  hidden?: boolean;
  testId?: string;
  /** Button variant when shown inline. Primary defaults to `default`, secondary to `outline`. */
  variant?: "default" | "outline" | "success" | "warning";
}

export interface DestructiveActionSpec extends ActionSpec {
  /** Destructive actions always confirm before running (design-system §11.2). */
  confirm: { title: string; description?: ReactNode; confirmLabel: string };
}

/** Max secondary actions shown inline (outline) on sm+; the rest overflow. */
export const MAX_INLINE_SECONDARY = 2;

/**
 * Splits the declared actions into what renders inline and what goes into
 * the «المزيد» overflow. Pure so the ordering/collapse rules are testable.
 *
 * - `inlineSecondary`: the first two secondary actions — inline on sm+,
 *   and ALSO listed in the overflow (`phoneOnly`) because phones collapse
 *   them into the menu.
 * - `overflow`: secondary beyond two, then `more`.
 * - `destructive`: separated at the bottom of the overflow, confirmed.
 */
export function planHeaderActions({
  secondary = [],
  more = [],
  destructive = [],
}: {
  secondary?: ActionSpec[];
  more?: ActionSpec[];
  destructive?: DestructiveActionSpec[];
}) {
  const visibleSecondary = secondary.filter((a) => !a.hidden);
  const inlineSecondary = visibleSecondary.slice(0, MAX_INLINE_SECONDARY);
  const overflow = [
    ...visibleSecondary.slice(MAX_INLINE_SECONDARY),
    ...more.filter((a) => !a.hidden),
  ];
  const visibleDestructive = destructive.filter((a) => !a.hidden);
  return {
    inlineSecondary,
    overflow,
    destructive: visibleDestructive,
    /** Overflow trigger is needed on sm+ only when something always lives in it. */
    overflowOnDesktop: overflow.length > 0 || visibleDestructive.length > 0,
    /** On phones the inline secondary actions also live in the overflow. */
    overflowOnPhone:
      inlineSecondary.length > 0 || overflow.length > 0 || visibleDestructive.length > 0,
  };
}

function InlineAction({ action, variant }: { action: ActionSpec; variant: ActionSpec["variant"] }) {
  const Icon = action.icon;
  const content = (
    <>
      {Icon && !action.loading ? <Icon /> : null}
      {action.label}
    </>
  );
  if (action.href && !action.disabled) {
    return (
      <EnterpriseButton asChild variant={action.variant ?? variant} data-testid={action.testId}>
        <Link href={action.href}>{content}</Link>
      </EnterpriseButton>
    );
  }
  return (
    <EnterpriseButton
      type="button"
      variant={action.variant ?? variant}
      disabled={action.disabled}
      isLoading={action.loading}
      data-testid={action.testId}
      onClick={() => void action.onSelect?.()}
    >
      {content}
    </EnterpriseButton>
  );
}

/**
 * The shared header action cluster (design-system §11.2), in logical order:
 * «المزيد» overflow → `inline` custom controls → secondary (outline, max 2)
 * → the ONE filled primary at the logical end.
 *
 * Phones (<640px): secondary actions collapse into the overflow; the primary
 * is never hidden. Collapse is pure CSS (`sm:`), so there is no layout flash
 * and SSR renders the final shape. `inline` is for self-contained controls
 * that own their own menu/dialog (e.g. the Import menu) — they stay inline at
 * every width, but on phones their `data-slot="action-label"` text becomes
 * screen-reader-only (icon buttons), so the whole cluster keeps to one row.
 */
export function HeaderActions({
  primary,
  secondary,
  more,
  destructive,
  inline,
  className,
}: {
  /** The ONE filled primary. A ready element is accepted for a primary that is itself a menu (e.g. «حركة جديدة ▾»). */
  primary?: ActionSpec | ReactElement;
  secondary?: ActionSpec[];
  more?: ActionSpec[];
  destructive?: DestructiveActionSpec[];
  inline?: ReactNode;
  className?: string;
}) {
  const { t } = useLocale();
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirming, setConfirming] = useState<DestructiveActionSpec | null>(null);
  const [running, setRunning] = useState(false);
  // Phone-only copies of the inline secondary actions exist in the menu only
  // below `sm` — never a second element with the same `data-testid` (R2-10).
  const isPhone = useIsMobile(640);
  const plan = planHeaderActions({ secondary, more, destructive });
  const primaryNode: ReactNode = isValidElement(primary) ? (
    primary
  ) : primary && !(primary as ActionSpec).hidden ? (
    <InlineAction action={primary as ActionSpec} variant="default" />
  ) : null;
  const showPrimary = Boolean(primaryNode);
  const moreLabel = t("common.more");

  const select = (action: ActionSpec) => {
    // Closing the menu and opening a dialog on the same pointer event
    // dismisses the dialog immediately — defer (same as RowActionsMenu).
    setMenuOpen(false);
    window.setTimeout(() => void action.onSelect?.(), 50);
  };

  const menuItem = (action: ActionSpec, opts?: { phoneOnly?: boolean; destructive?: boolean }) => {
    const Icon = action.icon;
    const itemClass = cn("min-h-9 gap-2", opts?.phoneOnly && "sm:hidden");
    const body = (
      <>
        {Icon ? <Icon className="size-4" /> : null}
        {action.label}
      </>
    );
    if (action.href && !action.disabled) {
      return (
        <DropdownMenuItem
          key={action.key}
          asChild
          className={itemClass}
          data-testid={action.testId}
          data-phone-only={opts?.phoneOnly || undefined}
        >
          <Link href={action.href}>{body}</Link>
        </DropdownMenuItem>
      );
    }
    return (
      <DropdownMenuItem
        key={action.key}
        className={itemClass}
        disabled={action.disabled || action.loading}
        variant={opts?.destructive ? "destructive" : "default"}
        data-testid={action.testId}
        data-phone-only={opts?.phoneOnly || undefined}
        onSelect={(event) => {
          event.preventDefault();
          if (opts?.destructive) {
            setMenuOpen(false);
            window.setTimeout(() => setConfirming(action as DestructiveActionSpec), 50);
            return;
          }
          select(action);
        }}
      >
        {body}
      </DropdownMenuItem>
    );
  };

  const hasAnything =
    showPrimary || inline || plan.overflowOnPhone || plan.inlineSecondary.length > 0;
  if (!hasAnything) return null;

  return (
    <div
      data-slot="header-actions"
      className={cn("flex min-w-0 flex-wrap items-center justify-end gap-2", className)}
    >
      {plan.overflowOnPhone ? (
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <EnterpriseButton
              type="button"
              variant="outline"
              aria-label={moreLabel}
              data-testid="header-actions-more"
              className={cn(
                "px-2 sm:px-3",
                // Only secondary actions in it → phones only.
                !plan.overflowOnDesktop && "sm:hidden",
              )}
            >
              <Ellipsis />
              <span className="hidden sm:inline">{moreLabel}</span>
            </EnterpriseButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-max min-w-48">
            {isPhone ? plan.inlineSecondary.map((a) => menuItem(a, { phoneOnly: true })) : null}
            {isPhone && plan.inlineSecondary.length > 0 && plan.overflow.length > 0 ? (
              <DropdownMenuSeparator className="sm:hidden" />
            ) : null}
            {plan.overflow.map((a) => menuItem(a))}
            {plan.destructive.length > 0 ? (
              <>
                {plan.overflow.length > 0 || (isPhone && plan.inlineSecondary.length > 0) ? (
                  <DropdownMenuSeparator
                    className={cn(plan.overflow.length === 0 && "sm:hidden")}
                  />
                ) : null}
                {plan.destructive.map((a) => (
                  <Fragment key={a.key}>{menuItem(a, { destructive: true })}</Fragment>
                ))}
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {inline ? (
        <div data-header-inline="" className="contents max-sm:[&_[data-slot=action-label]]:sr-only">
          {inline}
        </div>
      ) : null}
      {plan.inlineSecondary.map((action) => (
        <div key={action.key} className="hidden sm:contents" data-header-secondary="">
          <InlineAction action={action} variant="outline" />
        </div>
      ))}
      {primaryNode}
      {confirming ? (
        <ConfirmationDialog
          open
          onOpenChange={(open) => {
            if (!open) setConfirming(null);
          }}
          tone="destructive"
          title={confirming.confirm.title}
          description={confirming.confirm.description}
          confirmLabel={confirming.confirm.confirmLabel}
          isConfirming={running}
          onConfirm={async () => {
            setRunning(true);
            try {
              await confirming.onSelect?.();
            } finally {
              setRunning(false);
              setConfirming(null);
            }
          }}
        />
      ) : null}
    </div>
  );
}
