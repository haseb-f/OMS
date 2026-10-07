"use client";

import { useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { PermissionMatrix } from "./permission-matrix";
import { jobTitlesService } from "@/services/job-titles-service";
import type {
  PermissionOverrides,
  UserPermissionPanel as UserPermissionPanelData,
} from "@/services/users-service";
import { useLocale } from "@/providers/locale-provider";

/**
 * R14 W2 (spec-2 §A) — a user's permissions as job-title template +
 * individual overrides. The template shown is the one of the job title
 * currently selected in the form (a title change switches the inherited set
 * immediately); individual GRANT / DENY rows are edited tri-state in the
 * shared Permission Matrix. Purely controlled: the caller saves `value`
 * through `PUT /users/:id/permission-overrides`.
 */
export function UserPermissionPanel({
  panel,
  jobTitleId,
  jobTitleName,
  value,
  onChange,
  readOnlyReason,
}: {
  /** The loaded panel of an existing user (null while creating). */
  panel: UserPermissionPanelData | null;
  /** The job title selected in the form right now. */
  jobTitleId: string | null;
  jobTitleName: string | null;
  value: PermissionOverrides;
  onChange: (next: PermissionOverrides) => void;
  /** When set, the matrix is read only and this explains why. */
  readOnlyReason?: string | null;
}) {
  const { t } = useLocale();
  const savedTitleId = panel?.jobTitle?.id ?? null;
  const [fetchedTemplate, setFetchedTemplate] = useState<{
    jobTitleId: string;
    permissions: string[];
  } | null>(null);

  useEffect(() => {
    if (!jobTitleId || jobTitleId === savedTitleId) return;
    let cancelled = false;
    jobTitlesService
      .getPermissionTemplate(jobTitleId)
      .then((template) => {
        if (!cancelled) setFetchedTemplate({ jobTitleId, permissions: template.permissions });
      })
      // Without the job-title view right the template cannot be previewed;
      // the server still applies it after saving.
      .catch(() => {
        if (!cancelled) setFetchedTemplate({ jobTitleId, permissions: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [jobTitleId, savedTitleId]);

  const inherited = !jobTitleId
    ? []
    : jobTitleId === savedTitleId
      ? (panel?.inherited ?? [])
      : fetchedTemplate?.jobTitleId === jobTitleId
        ? fetchedTemplate.permissions
        : [];

  return (
    <div className="flex flex-col gap-2">
      {panel?.permissionsReviewRequired ? (
        <Alert tone="warning">
          <AlertDescription>{t("permissionTemplates.userPanel.reviewRequired")}</AlertDescription>
        </Alert>
      ) : null}
      {readOnlyReason ? (
        <Alert tone="neutral">
          <AlertDescription>{readOnlyReason}</AlertDescription>
        </Alert>
      ) : null}
      <p className="text-caption text-muted-foreground">
        {jobTitleId
          ? t("permissionTemplates.userPanel.inheritsFrom", { title: jobTitleName ?? "—" })
          : t("permissionTemplates.userPanel.noJobTitle")}{" "}
        {t("permissionTemplates.userPanel.summary", {
          grants: String(value.grants.length),
          denies: String(value.denies.length),
        })}
      </p>
      <PermissionMatrix
        disabled={Boolean(readOnlyReason)}
        overrides={{
          inherited,
          grants: value.grants,
          denies: value.denies,
          onChange,
        }}
      />
    </div>
  );
}
