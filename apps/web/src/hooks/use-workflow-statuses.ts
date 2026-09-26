"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { apiClient } from "@/services/api-client";
import type { WorkflowTypeValue } from "@/services/workflow-service";
import {
  createScopedListCache,
  currentDataScope,
  subscribeDataScope,
} from "@/lib/client-data-scope";

const NO_STATUSES: WorkflowStatusRow[] = [];

export interface WorkflowStatusRow {
  id: string;
  workflowType: WorkflowTypeValue;
  code: string;
  name: string;
  nameEn: string | null;
  color: string;
  sortOrder: number;
  isSystem: boolean;
  isFinal: boolean;
  isDefault: boolean;
  deletedAt: string | null;
}

const fetchStatuses = (workflowType: WorkflowTypeValue) =>
  apiClient.get<WorkflowStatusRow[]>(`/status-definitions/by-workflow/${workflowType}`);

/** Company-scoped statuses on the shared SEC-02 scoped cache (reset on identity/company change). */
function createWorkflowStatusHook(workflowType: WorkflowTypeValue) {
  const store = createScopedListCache<WorkflowStatusRow>(`workflowStatuses:${workflowType}`, () =>
    fetchStatuses(workflowType),
  );

  return function useWorkflowStatuses() {
    const [, forceRender] = useState(0);
    const scope = useSyncExternalStore(subscribeDataScope, currentDataScope, currentDataScope);

    useEffect(() => {
      store.ensureLoaded();
      return store.subscribe(() => forceRender((n) => n + 1));
    }, [scope]);

    const items = store.read() ?? NO_STATUSES;

    const active = useMemo(
      () => items.filter((s) => !s.deletedAt).sort((a, b) => a.sortOrder - b.sortOrder),
      [items],
    );

    const byCode = useMemo(() => new Map(items.map((s) => [s.code, s])), [items]);
    const byId = useMemo(() => new Map(items.map((s) => [s.id, s])), [items]);

    return { statuses: active, allStatuses: items, byCode, byId };
  };
}

export const useLeadStatuses = createWorkflowStatusHook("LEAD");
