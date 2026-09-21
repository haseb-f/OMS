"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { consumeDraft, registerDraftProvider } from "@/lib/navigation-origin";

/**
 * Preserves unsaved editor work across "Open Full Record" → return.
 * `snapshot` is captured when the user leaves through a related-record
 * preview (only while `enabled`, i.e. the document is editable); once the
 * page is `ready` again on return, `restore` receives it (JSON round-tripped,
 * so dates arrive as ISO strings).
 */
export function useNavigationDraft<T>({
  enabled,
  ready,
  snapshot,
  restore,
}: {
  enabled: boolean;
  ready: boolean;
  snapshot: () => T;
  restore: (draft: T) => void;
}): void {
  const pathname = usePathname();
  const snapshotRef = useRef(snapshot);
  const restoreRef = useRef(restore);
  useEffect(() => {
    snapshotRef.current = snapshot;
    restoreRef.current = restore;
  });

  useEffect(() => {
    if (!enabled) return;
    return registerDraftProvider(pathname, () => snapshotRef.current());
  }, [enabled, pathname]);

  useEffect(() => {
    if (!ready) return;
    const draft = consumeDraft(pathname);
    if (draft !== undefined) restoreRef.current(draft as T);
  }, [ready, pathname]);
}
