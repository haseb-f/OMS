import { EnterpriseBadge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type StatusTone = "success" | "warning" | "destructive" | "info" | "neutral";

const toneClasses: Record<StatusTone, string> = {
  success: "bg-success/10 text-success border-success/20",
  warning: "bg-warning/15 text-warning-foreground border-warning/30",
  destructive: "bg-destructive/10 text-destructive border-destructive/20",
  info: "bg-secondary text-secondary-foreground border-transparent",
  neutral: "bg-muted text-muted-foreground border-transparent",
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
      variant="outline"
      className={cn("border font-medium", toneClasses[tone], className)}
    >
      {label}
    </EnterpriseBadge>
  );
}
