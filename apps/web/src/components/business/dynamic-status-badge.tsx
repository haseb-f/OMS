import { StatusBadge } from "@/components/business/status-badge";

/**
 * @deprecated Use `<StatusBadge label colorKey />` directly. Kept as a thin
 * wrapper so existing call sites keep working during adoption.
 */
export function DynamicStatusBadge({
  label,
  colorKey,
  className,
}: {
  label: string;
  colorKey?: string | null;
  className?: string;
}) {
  return <StatusBadge label={label} colorKey={colorKey} className={className} />;
}
