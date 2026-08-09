"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";

/**
 * Global Feedback System (TASK-028) — "Long operations: Progress dialog
 * with progress bar." Reusable shell for any future multi-step/long-running
 * flow (bulk import, bulk export, multi-record processing); nothing in
 * Products currently runs long enough to need it, so this is prepared
 * infrastructure, not wired into a specific flow yet — the same "build the
 * primitive, wire it when a real consumer needs it" pattern as
 * ImportDialog/ExportDialog. No close button: progress dialogs are
 * non-dismissible while work is in flight, by design.
 */
export function ProgressDialog({
  open,
  title,
  description,
  value,
  currentLabel,
}: {
  open: boolean;
  title: string;
  description?: string;
  /** 0–100 */
  value: number;
  /** e.g. "3 of 10" — shown under the bar. */
  currentLabel?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={() => undefined}>
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-sm"
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Progress value={value} />
          <div className="flex items-center justify-between text-caption text-muted-foreground">
            {currentLabel && <span>{currentLabel}</span>}
            <span dir="ltr">{Math.round(value)}%</span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
