"use client";

import { forwardRef, type ComponentProps } from "react";
import Link from "next/link";
import {
  Ban,
  CheckCheck,
  CheckCircle2,
  Eye,
  GitCompareArrows,
  HandCoins,
  Scale,
  ShieldAlert,
  Undo2,
  Unlink,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { MessageKey } from "@/i18n/translate";
import { useLocale } from "@/providers/locale-provider";

/**
 * Semantic payment action presets (Round 5 spec 3C) — a thin layer over the
 * shared `EnterpriseButton`, never a fork: each intent fixes its variant,
 * icon and label so "Reject declaration" can never look like "Refund
 * customer", nor "Unmatch" like "Reverse posting".
 */
export type PaymentActionIntent =
  | "confirmPost"
  | "confirmMatchPost"
  | "match"
  | "review"
  | "rejectDeclaration"
  | "dispute"
  | "unmatch"
  | "reversePosting"
  | "refundCustomer"
  | "openWorkspace"
  | "acceptStrong";

type Variant = ComponentProps<typeof EnterpriseButton>["variant"];

export const PAYMENT_ACTION_PRESETS: Record<
  PaymentActionIntent,
  { variant: Variant; icon: LucideIcon; labelKey: MessageKey }
> = {
  confirmPost: {
    variant: "success",
    icon: CheckCheck,
    labelKey: "paymentVocabulary.action.confirmPost",
  },
  confirmMatchPost: {
    variant: "success",
    icon: CheckCircle2,
    labelKey: "paymentVocabulary.action.confirmMatchPost",
  },
  match: {
    variant: "default",
    icon: GitCompareArrows,
    labelKey: "paymentVocabulary.action.match",
  },
  review: { variant: "default", icon: Eye, labelKey: "paymentVocabulary.action.review" },
  rejectDeclaration: {
    variant: "destructive",
    icon: Ban,
    labelKey: "paymentVocabulary.action.rejectDeclaration",
  },
  dispute: { variant: "outline", icon: ShieldAlert, labelKey: "paymentVocabulary.action.dispute" },
  unmatch: { variant: "outline", icon: Unlink, labelKey: "paymentVocabulary.action.unmatch" },
  reversePosting: {
    variant: "outline",
    icon: Undo2,
    labelKey: "paymentVocabulary.action.reversePosting",
  },
  refundCustomer: {
    variant: "outline",
    icon: HandCoins,
    labelKey: "paymentVocabulary.action.refundCustomer",
  },
  openWorkspace: {
    variant: "outline",
    icon: Scale,
    labelKey: "paymentVocabulary.action.openWorkspace",
  },
  acceptStrong: {
    variant: "success",
    icon: Zap,
    labelKey: "paymentVocabulary.action.acceptStrong",
  },
};

type ButtonProps = Omit<ComponentProps<typeof EnterpriseButton>, "variant" | "children" | "size">;

export const PaymentActionButton = forwardRef<
  HTMLButtonElement,
  ButtonProps & {
    intent: PaymentActionIntent;
    /** Invalid actions stay visible: disabled, with this reason as the tooltip. */
    disabledReason?: string | null;
    /** Replaces the preset label (e.g. "Reverse posting · JE-2026-000123"). */
    label?: string;
    /** A link action (refund flow, reconciliation workspace). */
    href?: string;
    size?: "xs" | "sm";
    /** Emphasis override inside a row where another action is primary. */
    quiet?: boolean;
  }
>(function PaymentActionButton(
  { intent, disabledReason, label, href, size = "sm", quiet = false, disabled, ...props },
  ref,
) {
  const { t } = useLocale();
  const preset = PAYMENT_ACTION_PRESETS[intent];
  const Icon = preset.icon;
  const blocked = !!disabledReason;
  const variant: Variant = quiet && preset.variant === "default" ? "outline" : preset.variant;
  const text = label ?? t(preset.labelKey);

  const button =
    href && !blocked && !disabled ? (
      <EnterpriseButton ref={ref} variant={variant} size={size} asChild {...props}>
        <Link href={href}>
          <Icon aria-hidden />
          {text}
        </Link>
      </EnterpriseButton>
    ) : (
      <EnterpriseButton
        ref={ref}
        type="button"
        variant={variant}
        size={size}
        disabled={disabled || blocked}
        aria-disabled={blocked || undefined}
        {...props}
      >
        <Icon aria-hidden />
        {text}
      </EnterpriseButton>
    );

  if (!blocked) return button;
  // A disabled button receives no pointer events: the focusable wrapper carries the reason.
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className="inline-flex rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          aria-label={`${text} — ${disabledReason}`}
        >
          {button}
        </span>
      </TooltipTrigger>
      <TooltipContent>{disabledReason}</TooltipContent>
    </Tooltip>
  );
});
