import { EnterpriseBadge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  resolveStatusColor,
  STATUS_TONE_DOT_CLASS,
  type StatusTone,
} from "@/components/business/status-tone";

export {
  resolveStatusColor,
  toneFromColorKey,
  STATUS_TONES,
  STATUS_TONE_DOT_CLASS,
  type StatusTone,
  type ResolvedStatusColor,
} from "@/components/business/status-tone";

const toneVariant: Record<
  StatusTone,
  "success" | "warning" | "destructive" | "info" | "secondary"
> = {
  success: "success",
  warning: "warning",
  destructive: "destructive",
  info: "info",
  neutral: "secondary",
};

/**
 * The one status pill every business module uses — never a bespoke colored
 * `<span>`. The label always names the state; color is secondary.
 *
 * - `tone`: a semantic tone from a code-side mapper (`shipmentStatusTone`, ...).
 * - `colorKey`: an admin-configured color (workflow statuses, shipping-status
 *   catalog, classifications) — mapped to the closest semantic tone by
 *   `resolveStatusColor`; a color with no status meaning renders neutral with
 *   that color on the dot only (never a raw background).
 * - `dot`: adds a small leading dot in the tone color (classifications).
 *
 * An explicit `tone` wins over `colorKey`.
 */
export function StatusBadge({
  label,
  tone,
  colorKey,
  dot = false,
  className,
}: {
  label: string;
  tone?: StatusTone;
  colorKey?: string | null;
  dot?: boolean;
  className?: string;
}) {
  const resolved = tone ? { tone, dotColor: undefined } : resolveStatusColor(colorKey);
  const showDot = dot || resolved.dotColor !== undefined;

  return (
    <EnterpriseBadge
      variant={toneVariant[resolved.tone]}
      title={label}
      data-tone={resolved.tone}
      className={cn("max-w-full min-w-0 shrink", className)}
    >
      {showDot && (
        <span
          aria-hidden
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            !resolved.dotColor && STATUS_TONE_DOT_CLASS[resolved.tone],
          )}
          style={resolved.dotColor ? { backgroundColor: resolved.dotColor } : undefined}
        />
      )}
      <span className="min-w-0 truncate">{label}</span>
    </EnterpriseBadge>
  );
}
