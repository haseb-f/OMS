"use client";

import { Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { EmptyState } from "@/components/shared/empty-state";

/** Placeholder — no business operations are wired up yet. A future phase registers real actions (e.g. "New Purchase Order") here. */
export function QuickActionsMenu() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Quick actions">
          <Zap />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0">
        <div className="border-b px-4 py-3">
          <p className="text-sm font-medium">Quick Actions</p>
        </div>
        <EmptyState
          icon={Zap}
          title="No quick actions yet"
          description="Business modules will register actions here."
        />
      </PopoverContent>
    </Popover>
  );
}
