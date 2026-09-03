"use client";

import { useEffect, useMemo, useState } from "react";
import { Users } from "lucide-react";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { ModalSection } from "@/components/shared/modal-section";
import { EnterpriseButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { DepartmentPicker } from "@/components/business/department-picker";
import { EntityCombobox } from "@/components/shared/entity-combobox";
import { usersService, type UserRow } from "@/services/users-service";
import {
  salesTeamsService,
  type SalesTeamPayload,
  type SalesTeamRow,
} from "@/services/sales-teams-service";
import type { DepartmentRow } from "@/config/master-data/entities";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";

function departmentFromTeam(team: SalesTeamRow): DepartmentRow {
  return {
    id: team.department.id,
    code: team.department.code,
    name: team.department.name,
    nameEn: team.department.nameEn,
    description: null,
    sortOrder: 0,
    isActive: team.department.isActive,
    deletedAt: team.department.deletedAt,
  };
}

export function SalesTeamEditorModal({
  open,
  onOpenChange,
  team,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  team: SalesTeamRow | null;
  onSaved: () => void;
}) {
  const { t } = useLocale();
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [department, setDepartment] = useState<DepartmentRow | null>(null);
  const [manager, setManager] = useState<UserRow | null>(null);
  const [members, setMembers] = useState<UserRow[]>([]);
  const [eligibleUsers, setEligibleUsers] = useState<UserRow[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (!team) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setName("");
      setNotes("");
      setDepartment(null);
      setManager(null);
      setMembers([]);
      return;
    }
    setName(team.name);
    setNotes(team.notes ?? "");
    setDepartment(departmentFromTeam(team));
    setManager({
      id: team.manager.id,
      fullName: team.manager.fullName,
      username: team.manager.username,
      email: "",
      mobile: null,
      departmentId: team.departmentId,
      department: team.department,
      isActive: true,
      isLocked: false,
      mustChangePassword: false,
      lastLoginAt: null,
      createdAt: "",
      updatedAt: "",
      jobTitleId: null,
      jobTitle: null,
      branchId: null,
      branch: null,
    });
    setMembers(
      team.members.map((member) => ({
        id: member.user.id,
        fullName: member.user.fullName,
        username: member.user.username,
        email: "",
        mobile: null,
        departmentId: team.departmentId,
        department: team.department,
        isActive: true,
        isLocked: false,
        mustChangePassword: false,
        lastLoginAt: null,
        createdAt: "",
        updatedAt: "",
        jobTitleId: null,
        jobTitle: null,
        branchId: null,
        branch: null,
      })),
    );
  }, [open, team]);

  useEffect(() => {
    if (!open) return;
    usersService
      .list()
      .then((rows) => {
        const active = rows.filter((row) => row.isActive && !row.isLocked);
        if (!department?.id) {
          setEligibleUsers(active);
          return;
        }
        setEligibleUsers([
          ...active.filter((row) => row.departmentId === department.id),
          ...active.filter((row) => row.departmentId !== department.id),
        ]);
      })
      .catch(() => setEligibleUsers([]));
  }, [open, department?.id]);

  const memberOptions = useMemo(
    () => eligibleUsers.filter((user) => user.id !== manager?.id),
    [eligibleUsers, manager?.id],
  );

  const toggleMember = (user: UserRow, checked: boolean) => {
    setMembers((current) =>
      checked
        ? current.some((row) => row.id === user.id)
          ? current
          : [...current, user]
        : current.filter((row) => row.id !== user.id),
    );
  };

  const handleSave = async () => {
    if (!name.trim() || !department || !manager) {
      toast.error(t("crm.salesTeams.validationRequired"));
      return;
    }
    setSaving(true);
    try {
      const payload: SalesTeamPayload = {
        name: name.trim(),
        departmentId: department.id,
        managerId: manager.id,
        memberIds: members.map((member) => member.id),
        notes: notes.trim() || undefined,
      };
      if (team) {
        await salesTeamsService.update(team.id, payload);
        toast.success(t("crm.salesTeams.toasts.saved"));
      } else {
        await salesTeamsService.create(payload);
        toast.success(t("crm.salesTeams.toasts.created"));
      }
      onOpenChange(false);
      onSaved();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("errors.generic"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <EnterpriseModal
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      icon={Users}
      title={team ? team.name : t("crm.salesTeams.editor.newTitle")}
      footer={(requestClose) => (
        <>
          <EnterpriseButton
            type="button"
            variant="outline"
            onClick={requestClose}
            disabled={saving}
          >
            {t("common.cancel")}
          </EnterpriseButton>
          <EnterpriseButton type="button" onClick={handleSave} disabled={saving} isLoading={saving}>
            {t("common.save")}
          </EnterpriseButton>
        </>
      )}
    >
      <div className="flex flex-col gap-3">
        <ModalSection title={t("crm.salesTeams.editor.sectionDetails")} columns={2}>
          <div className="flex flex-col gap-1">
            <label className="text-caption text-muted-foreground">
              {t("crm.salesTeams.fields.name")} <span className="text-destructive">*</span>
            </label>
            <Input inputSize="sm" value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-caption text-muted-foreground">
              {t("crm.salesTeams.fields.department")} <span className="text-destructive">*</span>
            </label>
            <DepartmentPicker
              value={department}
              onChange={(next) => {
                setDepartment(next);
                setManager(null);
                setMembers([]);
              }}
              requiredArchived={team ? departmentFromTeam(team) : null}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-caption text-muted-foreground">
              {t("crm.salesTeams.fields.manager")} <span className="text-destructive">*</span>
            </label>
            <EntityCombobox
              items={eligibleUsers}
              value={manager}
              onChange={setManager}
              getId={(user) => user.id}
              getTitle={(user) => user.fullName}
              getSubtitle={(user) => user.username}
              placeholder={t("crm.salesTeams.selectManager")}
              disabled={!department}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-caption text-muted-foreground">
              {t("crm.salesTeams.fields.notes")}
            </label>
            <Input
              inputSize="sm"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>
        </ModalSection>

        <ModalSection title={t("crm.salesTeams.fields.members")} columns={2}>
          <div className="col-span-full flex max-h-56 flex-col gap-1 overflow-auto rounded-md border border-border p-2">
            {memberOptions.length === 0 ? (
              <p className="text-caption text-muted-foreground">
                {t("crm.salesTeams.noEligibleMembers")}
              </p>
            ) : (
              memberOptions.map((user) => {
                const checked = members.some((member) => member.id === user.id);
                return (
                  <label
                    key={user.id}
                    className="flex items-center gap-2 rounded-sm px-1 py-1 hover:bg-muted/50"
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(value) => toggleMember(user, !!value)}
                    />
                    <span className="text-body">{user.fullName}</span>
                    <span className="text-caption text-muted-foreground" dir="ltr">
                      {user.username}
                    </span>
                  </label>
                );
              })
            )}
          </div>
        </ModalSection>
      </div>
    </EnterpriseModal>
  );
}
