import type { ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export interface EntityTab {
  value: string;
  label: string;
  content: ReactNode;
  badge?: ReactNode;
}

/**
 * The standard tab set for an entity detail page (Overview / Activity /
 * Documents / …) — a thin, typed wrapper over the Tabs primitive so no page
 * hand-builds its own TabsList/TabsTrigger boilerplate.
 */
export function EntityTabs({
  tabs,
  defaultValue,
  className,
}: {
  tabs: EntityTab[];
  defaultValue?: string;
  className?: string;
}) {
  return (
    <Tabs defaultValue={defaultValue ?? tabs[0]?.value} className={className}>
      <TabsList variant="line">
        {tabs.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value} className="gap-1.5">
            {tab.label}
            {tab.badge}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((tab) => (
        <TabsContent key={tab.value} value={tab.value} className="pt-4">
          {tab.content}
        </TabsContent>
      ))}
    </Tabs>
  );
}
