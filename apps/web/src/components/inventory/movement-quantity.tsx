"use client";

import { Lock, LockOpen, PackageMinus, PackagePlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLocale } from "@/providers/locale-provider";
import {
  movementEffect,
  signedFigure,
  type MovementEffectInput,
} from "@/config/inventory/movement-effect";

/**
 * The one way a stock movement's quantity is shown (movements table, Grid card, product history,
 * inventory report, agent stock history). Physical rows: green "+100" received / red "−100" issued
 * at the row's warehouse, neutral "0"; reservation rows: blue "المتاح −10" (reserve, lock icon) /
 * "المتاح +10" (release, open-lock icon) with a note that on-hand is unchanged. The sign, the icon
 * and the label carry the meaning — colour is never the only cue. Bidi-isolated so signs read
 * correctly in RTL.
 */
export function MovementQuantity({
  row,
  format = (n: number) => n.toLocaleString("en-US"),
  className,
}: {
  row: MovementEffectInput;
  format?: (n: number) => string;
  className?: string;
}) {
  const { t } = useLocale();
  const effect = movementEffect(row);

  if (effect.kind === "reservation") {
    const release = effect.action === "release";
    const Icon = release ? LockOpen : Lock;
    const hint = t("inventory.effect.reservationHint");
    return (
      <span
        data-effect={effect.action}
        title={hint}
        className={cn(
          "inline-flex items-center gap-1 font-medium text-info-soft-foreground",
          className,
        )}
      >
        <Icon className="size-3.5 shrink-0" aria-hidden />
        <span>{t("inventory.effect.available")}</span>
        <bdi dir="ltr" className="num whitespace-nowrap">
          {signedFigure(effect.availableDelta, format)}
        </bdi>
        <span className="sr-only">
          {t(release ? "inventory.effect.release" : "inventory.effect.reserve")} — {hint}
        </span>
      </span>
    );
  }

  const Icon =
    effect.direction === "in" ? PackagePlus : effect.direction === "out" ? PackageMinus : null;
  return (
    <span
      data-effect={effect.direction}
      className={cn(
        "inline-flex items-center gap-1 font-medium",
        effect.direction === "in" && "text-success",
        effect.direction === "out" && "text-destructive",
        effect.direction === "none" && "text-muted-foreground",
        className,
      )}
    >
      {Icon ? <Icon className="size-3.5 shrink-0" aria-hidden /> : null}
      <bdi dir="ltr" className="num whitespace-nowrap">
        {signedFigure(effect.delta, format)}
      </bdi>
      <span className="sr-only">
        {t(
          effect.direction === "in"
            ? "inventory.effect.in"
            : effect.direction === "out"
              ? "inventory.effect.out"
              : "inventory.effect.none",
        )}
      </span>
    </span>
  );
}
