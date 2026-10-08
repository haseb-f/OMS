"use client";

import { useEffect, useId, useState } from "react";
import { KeyRound, Link2, Power, PowerOff, Unlink, UserPlus } from "lucide-react";
import { InsightSurface } from "@/components/shared/insight-card";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { CreateOperationFooter, CreateOperationLayout } from "@/components/shared/create-operation";
import { ModalSection } from "@/components/shared/modal-section";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { EntityCombobox } from "@/components/shared/entity-combobox";
import { StatusBadge } from "@/components/business/status-badge";
import { GeneratedPasswordDialog } from "@/components/settings/generated-password-dialog";
import { EnterpriseButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  companyPartnersService,
  type PartnerLogin,
  type PartnerLoginCandidate,
} from "@/services/company-partners-service";
import { useLocale } from "@/providers/locale-provider";
import { formatDateTime } from "@/lib/date";
import { reportApiError, toast } from "@/lib/toast";

type Confirm = "disable" | "unlink" | "reset" | null;

/** Active / disabled / locked / temporary password — the login's own state. */
function loginStatus(login: PartnerLogin): {
  key: "active" | "disabled" | "locked" | "mustChange";
  tone: "success" | "neutral" | "destructive" | "warning";
} {
  if (!login.isActive) return { key: "disabled", tone: "neutral" };
  if (login.isLocked) return { key: "locked", tone: "destructive" };
  if (login.mustChangePassword) return { key: "mustChange", tone: "warning" };
  return { key: "active", tone: "success" };
}

/**
 * R15 (D15-14, 4.4-4.5) — the partner's own login on the partner page: its
 * e-mail, status and last sign-in, and — for `company-partners.users.manage`
 * — create (generated temporary password, shown once), link an existing
 * unlinked partner login, disable / enable, reset the password, unlink. A
 * login is created only once an agreement is in force; the card says so.
 */
export function PartnerLoginCard({
  partnerId,
  partnerName,
  partnerEmail,
  login,
  canManage,
  hasAgreement,
  onChanged,
}: {
  partnerId: string;
  partnerName: string;
  partnerEmail: string | null;
  login: PartnerLogin | null;
  canManage: boolean;
  /** An agreement is (or was) in force — the login may be created. */
  hasAgreement: boolean;
  onChanged: () => void;
}) {
  const { t } = useLocale();
  const [createOpen, setCreateOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState<string | null>(null);

  const run = async (action: () => Promise<unknown>, successKey: Parameters<typeof t>[0]) => {
    setBusy(true);
    try {
      await action();
      toast.success(t(successKey));
      setConfirm(null);
      onChanged();
    } catch (error) {
      reportApiError(error, "errors.saveFailed");
    } finally {
      setBusy(false);
    }
  };

  const status = login ? loginStatus(login) : null;

  return (
    <InsightSurface tone="neutral" className="gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <span
          data-slot="insight-icon"
          className="flex size-7 shrink-0 items-center justify-center rounded-md"
          aria-hidden
        >
          <KeyRound className="size-4" strokeWidth={2} />
        </span>
        <h3 className="min-w-0 flex-1 text-metric-label text-muted-foreground">
          {t("companyPartners.login.title")}
        </h3>
        {status ? (
          <StatusBadge label={t(`companyPartners.login.${status.key}`)} tone={status.tone} />
        ) : null}
      </div>

      {login ? (
        <dl className="flex flex-col">
          {[
            [
              t("companyPartners.login.email"),
              <span key="e" dir="ltr">
                {login.email}
              </span>,
            ],
            [t("companyPartners.login.fullName"), login.fullName],
            [
              t("companyPartners.login.lastLogin"),
              login.lastLoginAt ? (
                <span key="l" className="num">
                  {formatDateTime(login.lastLoginAt)}
                </span>
              ) : (
                t("companyPartners.login.never")
              ),
            ],
          ].map(([label, value]) => (
            <div
              key={String(label)}
              className="flex min-w-0 items-baseline justify-between gap-3 border-b border-border/60 py-1.5 last:border-b-0"
            >
              <dt className="text-caption text-muted-foreground">{label}</dt>
              <dd className="min-w-0 truncate text-caption">{value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-caption text-muted-foreground">
          {hasAgreement
            ? t("companyPartners.login.none")
            : t("companyPartners.login.needsAgreement")}
        </p>
      )}

      {canManage ? (
        <div className="flex flex-wrap gap-1.5">
          {login ? (
            <>
              {login.isActive ? (
                <EnterpriseButton size="sm" variant="outline" onClick={() => setConfirm("disable")}>
                  <PowerOff aria-hidden />
                  {t("companyPartners.login.disable")}
                </EnterpriseButton>
              ) : (
                <EnterpriseButton
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () => companyPartnersService.setLoginActive(partnerId, true),
                      "companyPartners.login.toasts.enabled",
                    )
                  }
                >
                  <Power aria-hidden />
                  {t("companyPartners.login.enable")}
                </EnterpriseButton>
              )}
              <EnterpriseButton size="sm" variant="outline" onClick={() => setConfirm("reset")}>
                <KeyRound aria-hidden />
                {t("companyPartners.login.reset")}
              </EnterpriseButton>
              <EnterpriseButton size="sm" variant="ghost" onClick={() => setConfirm("unlink")}>
                <Unlink aria-hidden />
                {t("companyPartners.login.unlink")}
              </EnterpriseButton>
            </>
          ) : (
            <>
              <EnterpriseButton
                size="sm"
                disabled={!hasAgreement}
                onClick={() => setCreateOpen(true)}
              >
                <UserPlus aria-hidden />
                {t("companyPartners.login.create")}
              </EnterpriseButton>
              <EnterpriseButton
                size="sm"
                variant="outline"
                disabled={!hasAgreement}
                onClick={() => setLinkOpen(true)}
              >
                <Link2 aria-hidden />
                {t("companyPartners.login.link")}
              </EnterpriseButton>
            </>
          )}
        </div>
      ) : null}

      <CreateLoginDialog
        open={createOpen}
        partnerId={partnerId}
        defaultName={partnerName}
        defaultEmail={partnerEmail ?? ""}
        onOpenChange={setCreateOpen}
        onCreated={(temporaryPassword) => {
          setCreateOpen(false);
          setPassword(temporaryPassword ?? null);
          onChanged();
        }}
      />
      <LinkLoginDialog
        open={linkOpen}
        partnerId={partnerId}
        onOpenChange={setLinkOpen}
        onLinked={() => {
          setLinkOpen(false);
          onChanged();
        }}
      />
      <ConfirmationDialog
        open={confirm === "disable"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={t("companyPartners.login.disableTitle")}
        description={t("companyPartners.login.disableDescription")}
        tone="destructive"
        confirmLabel={t("companyPartners.login.disable")}
        isConfirming={busy}
        onConfirm={() =>
          void run(
            () => companyPartnersService.setLoginActive(partnerId, false),
            "companyPartners.login.toasts.disabled",
          )
        }
      />
      <ConfirmationDialog
        open={confirm === "unlink"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={t("companyPartners.login.unlinkTitle")}
        description={t("companyPartners.login.unlinkDescription")}
        tone="destructive"
        confirmLabel={t("companyPartners.login.unlink")}
        isConfirming={busy}
        onConfirm={() =>
          void run(
            () => companyPartnersService.unlinkLogin(partnerId),
            "companyPartners.login.toasts.unlinked",
          )
        }
      />
      <ConfirmationDialog
        open={confirm === "reset"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={t("companyPartners.login.resetTitle")}
        description={t("companyPartners.login.resetDescription")}
        confirmLabel={t("companyPartners.login.reset")}
        isConfirming={busy}
        onConfirm={() =>
          void run(async () => {
            const result = await companyPartnersService.resetLoginPassword(partnerId);
            setPassword(result.temporaryPassword ?? null);
          }, "companyPartners.login.toasts.reset")
        }
      />
      <GeneratedPasswordDialog
        password={password}
        onOpenChange={(open) => !open && setPassword(null)}
      />
    </InsightSurface>
  );
}

function CreateLoginDialog({
  open,
  partnerId,
  defaultName,
  defaultEmail,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  partnerId: string;
  defaultName: string;
  defaultEmail: string;
  onOpenChange: (open: boolean) => void;
  onCreated: (temporaryPassword: string | undefined) => void;
}) {
  const { t } = useLocale();
  const fieldId = useId();
  const [email, setEmail] = useState(defaultEmail);
  const [fullName, setFullName] = useState(defaultName);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEmail(defaultEmail);
    setFullName(defaultName);
  }, [open, defaultEmail, defaultName]);

  const valid = /^\S+@\S+\.\S+$/.test(email.trim()) && fullName.trim().length > 0;

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      const result = await companyPartnersService.createLogin(partnerId, {
        email: email.trim(),
        fullName: fullName.trim(),
      });
      toast.success(t("companyPartners.login.toasts.created"));
      onCreated(result.temporaryPassword);
    } catch (error) {
      reportApiError(error, "errors.saveFailed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <EnterpriseModal
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      icon={UserPlus}
      title={t("companyPartners.login.createTitle")}
      description={t("companyPartners.login.createDescription")}
      footer={(requestClose) => (
        <CreateOperationFooter
          requestClose={requestClose}
          onSubmit={() => void save()}
          isSubmitting={saving}
          submitDisabled={!valid}
        />
      )}
    >
      <CreateOperationLayout>
        <ModalSection title={t("companyPartners.login.title")} columns={2}>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${fieldId}-email`}>
              {t("companyPartners.login.email")} <span className="text-destructive">*</span>
            </Label>
            <Input
              id={`${fieldId}-email`}
              type="email"
              dir="ltr"
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${fieldId}-name`}>
              {t("companyPartners.login.fullName")} <span className="text-destructive">*</span>
            </Label>
            <Input
              id={`${fieldId}-name`}
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
          </div>
        </ModalSection>
      </CreateOperationLayout>
    </EnterpriseModal>
  );
}

function LinkLoginDialog({
  open,
  partnerId,
  onOpenChange,
  onLinked,
}: {
  open: boolean;
  partnerId: string;
  onOpenChange: (open: boolean) => void;
  onLinked: () => void;
}) {
  const { t } = useLocale();
  const fieldId = useId();
  const [candidate, setCandidate] = useState<PartnerLoginCandidate | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) setCandidate(null);
  }, [open]);

  const save = async () => {
    if (!candidate) return;
    setSaving(true);
    try {
      await companyPartnersService.linkLogin(partnerId, candidate.id);
      toast.success(t("companyPartners.login.toasts.linked"));
      onLinked();
    } catch (error) {
      reportApiError(error, "errors.saveFailed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <EnterpriseModal
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      icon={Link2}
      title={t("companyPartners.login.linkTitle")}
      description={t("companyPartners.login.linkDescription")}
      footer={(requestClose) => (
        <CreateOperationFooter
          requestClose={requestClose}
          onSubmit={() => void save()}
          isSubmitting={saving}
          submitDisabled={!candidate}
        />
      )}
    >
      <CreateOperationLayout>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${fieldId}-login`}>{t("companyPartners.login.title")}</Label>
          <EntityCombobox
            id={`${fieldId}-login`}
            value={candidate}
            onChange={setCandidate}
            onSearch={(search) => companyPartnersService.loginCandidates(search)}
            getId={(row) => row.id}
            getTitle={(row) => row.fullName}
            getSubtitle={(row) => row.email}
            subtitleDir="ltr"
            placeholder={t("companyPartners.login.pick")}
            searchPlaceholder={t("companyPartners.login.search")}
            emptyText={t("companyPartners.login.noCandidates")}
          />
        </div>
      </CreateOperationLayout>
    </EnterpriseModal>
  );
}
