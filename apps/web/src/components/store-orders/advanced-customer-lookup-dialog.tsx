"use client";

import { useState } from "react";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { SearchInput } from "@/components/shared/search-input";
import { FieldLabel } from "@/components/ui/form";
import { StatusBadge } from "@/components/business/status-badge";
import type { StatusTone } from "@/components/business/status-tone";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ApiError } from "@/services/api-client";
import {
  customerLookupService,
  type AdvancedLookupMatch,
  type AdvancedLookupResult,
} from "@/services/customer-lookup-service";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { toast } from "@/lib/toast";

type LookupState = "idle" | "loading" | "done" | "rate-limited" | "error";

const MIN_PHONE_DIGITS = 7;
const MIN_NAME_CHARS = 3;

/** Same classification the server applies — only to avoid a pointless round trip. */
export function isMeaningfulLookupQuery(raw: string): boolean {
  const value = raw.trim();
  if (!value) return false;
  if (/^[+\d\s().-]+$/.test(value)) return value.replace(/\D/g, "").length >= MIN_PHONE_DIGITS;
  return [...value.replace(/\s/g, "")].length >= MIN_NAME_CHARS;
}

const STATUS_TONE: Record<string, StatusTone> = {
  IN_PROGRESS: "info",
  COMPLETED: "success",
  CANCELLED: "neutral",
  RETURNED: "warning",
  OPEN: "info",
  CONVERTED: "success",
  CLOSED: "neutral",
};

/**
 * R7 — "Advanced customer lookup" (AR: بحث متقدم عن عميل). A separate,
 * permission-gated tool (`customers.lookup_advanced`) that tells a salesperson
 * whether a customer already exists and that it is not theirs — nothing more.
 * Everything shown is what the server chose to disclose (masked phone, partial
 * name, order/lead reference, coarse status, assignment flag). A record link
 * appears only when the caller already has scope over it.
 */
export function AdvancedCustomerLookupDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useLocale();
  const [query, setQuery] = useState("");
  const [state, setState] = useState<LookupState>("idle");
  const [result, setResult] = useState<AdvancedLookupResult | null>(null);

  const reset = () => {
    setQuery("");
    setState("idle");
    setResult(null);
  };

  const meaningful = isMeaningfulLookupQuery(query);

  const search = async () => {
    if (state === "loading") return;
    if (!meaningful) {
      toast.error(t("customerLookup.hintMinimum"));
      return;
    }
    setState("loading");
    try {
      const next = await customerLookupService.advanced(query.trim());
      setResult(next);
      setState("done");
    } catch (error) {
      setResult(null);
      if (error instanceof ApiError && error.status === 429) {
        setState("rate-limited");
        return;
      }
      setState("error");
    }
  };

  return (
    <EnterpriseModal
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
      size="lg"
      icon={ShieldCheck}
      title={t("customerLookup.title")}
      description={t("customerLookup.description")}
      footer={(requestClose) => (
        <EnterpriseButton type="button" variant="outline" onClick={requestClose}>
          {t("common.close")}
        </EnterpriseButton>
      )}
    >
      <div className="flex flex-col gap-4" data-testid="advanced-customer-lookup">
        <div className="flex flex-col gap-1.5">
          <FieldLabel>{t("customerLookup.queryLabel")}</FieldLabel>
          <div className="flex items-center gap-2">
            <SearchInput
              value={query}
              onValueChange={(value) => {
                setQuery(value);
                if (state !== "loading") setState("idle");
              }}
              onSubmit={() => void search()}
              onClear={reset}
              isLoading={state === "loading"}
              placeholder={t("customerLookup.placeholder")}
              className="max-w-none flex-1"
            />
            <EnterpriseButton
              type="button"
              disabled={state === "loading" || !meaningful}
              onClick={() => void search()}
            >
              {t("customerLookup.search")}
            </EnterpriseButton>
          </div>
          <p className="text-caption text-muted-foreground">{t("customerLookup.notice")}</p>
        </div>

        {state === "idle" ? (
          <p className="text-body text-muted-foreground">
            {query && !meaningful ? t("customerLookup.hintMinimum") : t("customerLookup.idle")}
          </p>
        ) : null}
        {state === "loading" ? (
          <p className="text-body text-muted-foreground" role="status">
            {t("customerLookup.loading")}
          </p>
        ) : null}
        {state === "error" ? (
          <p className="text-body text-destructive" role="alert">
            {t("customerLookup.error")}
          </p>
        ) : null}
        {state === "rate-limited" ? (
          <p className="text-body text-destructive" role="alert">
            {t("customerLookup.rateLimited")}
          </p>
        ) : null}
        {state === "done" && result && !result.exists ? (
          <p className="text-body text-muted-foreground" data-testid="advanced-lookup-empty">
            {t("customerLookup.empty")}
          </p>
        ) : null}

        {state === "done" && result?.exists ? (
          <div className="flex flex-col gap-2">
            <p className="text-caption text-muted-foreground">
              {t("customerLookup.found", { count: result.matches.length })}
              {" · "}
              {t("customerLookup.remaining", { count: result.remainingInWindow })}
            </p>
            <div className="overflow-x-auto rounded-sm border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("customerLookup.columns.customer")}</TableHead>
                    <TableHead>{t("customerLookup.columns.reference")}</TableHead>
                    <TableHead>{t("customerLookup.columns.status")}</TableHead>
                    <TableHead>{t("customerLookup.columns.assignment")}</TableHead>
                    <TableHead>
                      <span className="sr-only">{t("customerLookup.open")}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.matches.map((match, index) => (
                    <MatchRow key={`${match.reference?.number ?? "none"}-${index}`} match={match} />
                  ))}
                </TableBody>
              </Table>
            </div>
            {result.capped ? (
              <p className="text-caption text-muted-foreground">{t("customerLookup.capped")}</p>
            ) : null}
          </div>
        ) : null}
      </div>
    </EnterpriseModal>
  );
}

function MatchRow({ match }: { match: AdvancedLookupMatch }) {
  const { t } = useLocale();
  const href = match.openable
    ? match.openable.type === "ORDER"
      ? `/store-orders/${match.openable.id}`
      : `/crm/leads/${match.openable.id}`
    : null;
  return (
    <TableRow>
      <TableCell>
        <div className="flex flex-col">
          <span className="font-medium" dir="auto">
            {match.partialName}
          </span>
          <span dir="ltr" className="text-caption text-muted-foreground">
            {match.maskedPhone ?? "—"}
          </span>
          <span className="text-caption text-muted-foreground">
            {t(`customerLookup.kind.${match.kind}`)}
          </span>
        </div>
      </TableCell>
      <TableCell>
        {match.reference ? (
          <div className="flex flex-col">
            <span dir="ltr" className="font-medium">
              {match.reference.number}
            </span>
            <span className="text-caption text-muted-foreground">
              {t(`customerLookup.referenceType.${match.reference.type}`)}
            </span>
          </div>
        ) : (
          <span className="text-muted-foreground">{t("customerLookup.noReference")}</span>
        )}
      </TableCell>
      <TableCell>
        {match.reference ? (
          <StatusBadge
            tone={STATUS_TONE[match.reference.status] ?? "neutral"}
            label={t(`customerLookup.status.${match.reference.status}`)}
          />
        ) : (
          "—"
        )}
      </TableCell>
      <TableCell>
        <StatusBadge
          tone={match.notAssignedToYou ? "warning" : "success"}
          label={
            match.notAssignedToYou
              ? t("customerLookup.notAssignedToYou")
              : t("customerLookup.assignedToYou")
          }
        />
      </TableCell>
      <TableCell className="text-end">
        {href ? (
          <EnterpriseButton asChild variant="link" size="inline">
            <Link href={href}>{t("customerLookup.open")}</Link>
          </EnterpriseButton>
        ) : (
          <span className="text-caption text-muted-foreground">{t("customerLookup.noAccess")}</span>
        )}
      </TableCell>
    </TableRow>
  );
}

/**
 * The trigger + dialog as one self-contained unit: renders nothing without
 * `customers.lookup_advanced`, so a page only has to mount it (one line).
 */
export function AdvancedCustomerLookupButton() {
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const [open, setOpen] = useState(false);
  if (!hasPermission("customers.lookup_advanced")) return null;
  return (
    <>
      <EnterpriseButton
        type="button"
        variant="ghost"
        size="sm"
        className="gap-1.5 text-muted-foreground"
        onClick={() => setOpen(true)}
        data-testid="advanced-customer-lookup-trigger"
      >
        <ShieldCheck className="size-4" />
        {t("customerLookup.trigger")}
      </EnterpriseButton>
      <AdvancedCustomerLookupDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
