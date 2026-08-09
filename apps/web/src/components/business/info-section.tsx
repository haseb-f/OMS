import type { ReactNode } from "react";

export interface InfoItem {
  label: string;
  value: ReactNode;
}

/**
 * A titled block of label/value pairs — the standard "details" panel used
 * across every entity detail page (contact info, terms, dates, …).
 */
export function InfoSection({
  title,
  items,
  columns = 2,
  className,
}: {
  title?: string;
  items: InfoItem[];
  columns?: 1 | 2 | 3;
  className?: string;
}) {
  const gridCols = { 1: "sm:grid-cols-1", 2: "sm:grid-cols-2", 3: "sm:grid-cols-3" }[columns];

  return (
    <div className={className}>
      {title && <h3 className="mb-3 text-section-title">{title}</h3>}
      <dl className={`grid grid-cols-1 gap-4 ${gridCols}`}>
        {items.map((item, index) => (
          <div key={index} className="flex flex-col gap-0.5">
            <dt className="text-caption text-muted-foreground">{item.label}</dt>
            <dd className="text-body font-medium">{item.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
