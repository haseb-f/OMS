"use client";

import { FolderKanban } from "lucide-react";
import { EntityCombobox } from "@/components/shared/entity-combobox";
import { createMasterDataService } from "@/services/master-data-service";
import type { ProjectRow } from "@/config/master-data/entities";
import { useLocale } from "@/providers/locale-provider";

const projectsService = createMasterDataService<ProjectRow>("/projects");

/** The one searchable Project selector — mirrors `AccountPicker`/`CostCenterPicker` exactly. */
export function ProjectPicker({
  value,
  onChange,
  disabled,
  placeholder,
  items,
}: {
  value: ProjectRow | null | undefined;
  onChange: (project: ProjectRow | null) => void;
  disabled?: boolean;
  placeholder?: string;
  /** Skip the async search and filter this already-fetched list instead — for callers (e.g. a line-grid) that prefetch the project list once for the whole page rather than per-row. */
  items?: ProjectRow[];
}) {
  const { t } = useLocale();

  return (
    <EntityCombobox
      value={value ?? null}
      onChange={onChange}
      items={items}
      onSearch={
        items
          ? undefined
          : async (search) => {
              const result = await projectsService.list({
                search: search || undefined,
                pageSize: 20,
              });
              return result.items;
            }
      }
      getId={(project) => project.id}
      getTitle={(project) => project.name}
      getSearchText={(project) => project.code}
      getSubtitle={(project) => project.code}
      subtitleDir="ltr"
      placeholder={placeholder ?? t("accounting.journalEntries.lines.selectProject")}
      disabled={disabled}
      allowClear
      icon={<FolderKanban className="size-3.5 shrink-0 text-muted-foreground" />}
    />
  );
}
