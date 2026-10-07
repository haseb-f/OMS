"use client";

import { useEffect, useMemo, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { ModalSection } from "@/components/shared/modal-section";
import { EnterpriseButton } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { UserPicker } from "@/components/business/user-picker";
import { PermissionMatrix, usePermissionNameLabel } from "./permission-matrix";
import { jobTitlesService, type JobTitleTemplateImpact } from "@/services/job-titles-service";
import { usersService } from "@/services/users-service";
import { useUserContext } from "@/providers/user-context";
import { useLocale } from "@/providers/locale-provider";
import { reportApiError, toast } from "@/lib/toast";

const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && a.every((name) => b.includes(name));

/**
 * R14 W2 (spec-2 §A) — "الصلاحيات الافتراضية": a job title's default
 * permission template in the shared Permission Matrix. Saving is two clicks:
 * "Review impact" asks the server for the per-holder preview (gained / lost,
 * overrides that make a change ineffective), "Save and apply" applies the
 * template live to every holder.
 */
export function JobTitlePermissionsModal({
  jobTitle,
  onOpenChange,
}: {
  /** The title being edited; null = closed. */
  jobTitle: { id: string; name: string } | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const permissionLabel = usePermissionNameLabel();
  const canEdit = hasPermission("job-titles.manage_permissions");
  const [saved, setSaved] = useState<string[] | null>(null);
  const [holderCount, setHolderCount] = useState(0);
  const [draft, setDraft] = useState<string[]>([]);
  const [impact, setImpact] = useState<JobTitleTemplateImpact | null>(null);
  const [seedUserId, setSeedUserId] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    if (!jobTitle) return;
    let cancelled = false;
    jobTitlesService
      .getPermissionTemplate(jobTitle.id)
      .then((template) => {
        if (cancelled) return;
        setSaved(template.permissions);
        setDraft(template.permissions);
        setHolderCount(template.holderCount);
        setImpact(null);
        setSeedUserId("");
      })
      .catch((error) => {
        if (!cancelled) reportApiError(error, "errors.loadFailed");
      });
    return () => {
      cancelled = true;
      setSaved(null);
    };
  }, [jobTitle]);

  const isDirty = saved !== null && !sameSet(saved, draft);
  const affected = useMemo(
    () => impact?.users.filter((u) => u.gained.length > 0 || u.lost.length > 0).length ?? 0,
    [impact],
  );

  const loadSeed = async () => {
    if (!seedUserId) return;
    try {
      const source = await usersService.getPermissionOverrides(seedUserId);
      setDraft([...new Set([...draft, ...source.grants])]);
      toast.success(t("permissionTemplates.jobTitle.seeded"));
    } catch (error) {
      reportApiError(error, "errors.generic");
    }
  };

  const reviewImpact = async () => {
    if (!jobTitle) return;
    if (!isDirty) {
      toast.info(t("permissionTemplates.jobTitle.noChanges"));
      return;
    }
    setIsBusy(true);
    try {
      setImpact(await jobTitlesService.previewPermissionTemplate(jobTitle.id, draft));
    } catch (error) {
      reportApiError(error, "errors.generic");
    } finally {
      setIsBusy(false);
    }
  };

  const save = async () => {
    if (!jobTitle) return;
    setIsBusy(true);
    try {
      const result = await jobTitlesService.setPermissionTemplate(jobTitle.id, draft);
      toast.success(t("permissionTemplates.jobTitle.saved", { count: String(result.holderCount) }));
      onOpenChange(false);
    } catch (error) {
      reportApiError(error, "errors.generic");
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <EnterpriseModal
      open={jobTitle !== null}
      onOpenChange={onOpenChange}
      size="xl"
      icon={ShieldCheck}
      title={t("permissionTemplates.jobTitle.title", { name: jobTitle?.name ?? "" })}
      description={t("permissionTemplates.jobTitle.description", { count: String(holderCount) })}
      isDirty={isDirty}
      footer={(requestClose) =>
        impact ? (
          <>
            <EnterpriseButton
              type="button"
              variant="outline"
              onClick={() => setImpact(null)}
              disabled={isBusy}
            >
              {t("permissionTemplates.jobTitle.back")}
            </EnterpriseButton>
            <EnterpriseButton type="button" onClick={save} disabled={isBusy} isLoading={isBusy}>
              {t("permissionTemplates.jobTitle.confirmSave")}
            </EnterpriseButton>
          </>
        ) : (
          <>
            <EnterpriseButton
              type="button"
              variant="outline"
              onClick={requestClose}
              disabled={isBusy}
            >
              {t("common.cancel")}
            </EnterpriseButton>
            {canEdit ? (
              <EnterpriseButton
                type="button"
                onClick={reviewImpact}
                disabled={isBusy || saved === null}
                isLoading={isBusy}
              >
                {t("permissionTemplates.jobTitle.reviewImpact")}
              </EnterpriseButton>
            ) : null}
          </>
        )
      }
    >
      {saved === null ? (
        <p className="p-6 text-center text-caption text-muted-foreground">{t("common.loading")}</p>
      ) : impact ? (
        <div className="flex flex-col gap-3">
          <Alert tone="info">
            <AlertDescription>
              {t("permissionTemplates.jobTitle.impactSummary", {
                added: String(impact.added.length),
                removed: String(impact.removed.length),
                affected: String(affected),
                holders: String(impact.holderCount),
              })}
            </AlertDescription>
          </Alert>
          {impact.users.length === 0 ||
          (affected === 0 && impact.users.every((u) => u.ineffective.length === 0)) ? (
            <p className="text-caption text-muted-foreground">
              {t("permissionTemplates.jobTitle.noImpact")}
            </p>
          ) : (
            <div className="max-h-[26rem] overflow-auto rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("permissionTemplates.jobTitle.columnUser")}</TableHead>
                    <TableHead>{t("permissionTemplates.jobTitle.columnGained")}</TableHead>
                    <TableHead>{t("permissionTemplates.jobTitle.columnLost")}</TableHead>
                    <TableHead>{t("permissionTemplates.jobTitle.columnIneffective")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {impact.users
                    .filter(
                      (u) => u.gained.length > 0 || u.lost.length > 0 || u.ineffective.length > 0,
                    )
                    .map((u) => (
                      <TableRow key={u.userId}>
                        <TableCell className="font-medium">{u.fullName}</TableCell>
                        <TableCell className="text-caption whitespace-normal">
                          {u.gained.map(permissionLabel).join("، ") || "—"}
                        </TableCell>
                        <TableCell className="text-caption whitespace-normal">
                          {u.lost.map(permissionLabel).join("، ") || "—"}
                        </TableCell>
                        <TableCell className="text-caption whitespace-normal">
                          {u.ineffective.length === 0
                            ? "—"
                            : u.ineffective
                                .map((item) =>
                                  t(
                                    item.reason === "DENIED_INDIVIDUALLY"
                                      ? "permissionTemplates.jobTitle.ineffectiveDenied"
                                      : "permissionTemplates.jobTitle.ineffectiveGranted",
                                    { permission: permissionLabel(item.permission) },
                                  ),
                                )
                                .join("، ")}
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {!canEdit ? (
            <Alert tone="neutral">
              <AlertDescription>{t("permissionTemplates.jobTitle.readOnly")}</AlertDescription>
            </Alert>
          ) : (
            <ModalSection title={t("permissionTemplates.jobTitle.seedFromUser")} columns={2}>
              <div className="col-span-full flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <UserPicker
                    value={seedUserId}
                    onValueChange={setSeedUserId}
                    activeOnly={false}
                    aria-label={t("permissionTemplates.jobTitle.seedFromUser")}
                  />
                </div>
                <EnterpriseButton
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!seedUserId}
                  onClick={loadSeed}
                >
                  {t("permissionTemplates.jobTitle.seedLoad")}
                </EnterpriseButton>
              </div>
            </ModalSection>
          )}
          <PermissionMatrix value={draft} onChange={setDraft} disabled={!canEdit} />
        </div>
      )}
    </EnterpriseModal>
  );
}
