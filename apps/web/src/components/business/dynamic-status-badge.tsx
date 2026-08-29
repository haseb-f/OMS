import { StatusBadge, type StatusTone } from "@/components/business/status-badge";

const COLOR_TO_TONE: Record<string, StatusTone> = {
  neutral: "neutral",
  info: "info",
  warning: "warning",
  success: "success",
  destructive: "destructive",
};

/**
 * Renders a status badge from dynamic Master Data — label + semantic color
 * token from the API, never hard-coded enum labels in page components.
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
  const tone = COLOR_TO_TONE[colorKey ?? "neutral"] ?? "neutral";
  return <StatusBadge label={label} tone={tone} className={className} />;
}
