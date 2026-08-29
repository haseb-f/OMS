"use client";

import { useEffect, useMemo, useState } from "react";
import { apiClient } from "@/services/api-client";
import type { WorkflowTypeValue } from "@/services/workflow-service";

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

function createWorkflowStatusHook(workflowType: WorkflowTypeValue) {
  let cache: WorkflowStatusRow[] | null = null;
  let inFlight: Promise<WorkflowStatusRow[]> | null = null;
  const listeners = new Set<() => void>();

  function ensureLoaded() {
    if (cache || inFlight) return;
    inFlight = fetchStatuses(workflowType)
      .then((data) => {
        cache = data;
        inFlight = null;
        listeners.forEach((l) => l());
        return data;
      })
      .catch(() => {
        cache = [];
        inFlight = null;
        listeners.forEach((l) => l());
        return cache!;
      });
  }

  return function useWorkflowStatuses() {
    const [items, setItems] = useState<WorkflowStatusRow[]>(cache ?? []);

    useEffect(() => {
      ensureLoaded();
      const listener = () => setItems(cache ?? []);
      listeners.add(listener);
      if (cache) setItems(cache);
      return () => {
        listeners.delete(listener);
      };
    }, []);

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
