import { EnterpriseBadge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type StatusTone = "success" | "warning" | "destructive" | "info" | "neutral";

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
 * `<span>`. Pass a semantic `tone`, not a raw color, so hierarchy stays
 * driven by tokens instead of ad-hoc hex values.
 */
export function StatusBadge({
  label,
  tone = "neutral",
  className,
}: {
  label: string;
  tone?: StatusTone;
  className?: string;
}) {
  return (
    <EnterpriseBadge
      variant={toneVariant[tone]}
      title={label}
      className={cn("max-w-full min-w-0 shrink truncate", className)}
    >
      {label}
    </EnterpriseBadge>
  );
}
