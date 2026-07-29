"use client";

import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { EmptyState } from "@/components/shared/empty-state";

/** No notification-producing backend event exists yet — this is the shell wired up in advance, always showing the empty state. */
export function NotificationsMenu() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Notifications">
          <Bell />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-b px-4 py-3">
          <p className="text-sm font-medium">Notifications</p>
        </div>
        <EmptyState
          icon={Bell}
          title="You're all caught up"
          description="Nothing new to review yet."
        />
      </PopoverContent>
    </Popover>
  );
}
