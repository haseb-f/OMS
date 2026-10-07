"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { SearchInput } from "@/components/shared/search-input";
import { ListPager } from "@/components/shared/list-pager";
import { FieldLabel } from "@/components/ui/form";
import { StatusBadge } from "@/components/business/status-badge";
import type { StatusTone } from "@/components/business/status-tone";
import { CustomerMatchCard } from "@/components/business/customer-match-card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ApiError } from "@/services/api-client";
import { normalizePhoneDigits } from "@/services/phone-service";
import {
  customerLookupService,
  type AdvancedLookupMatch,
  type AdvancedLookupResult,
} from "@/services/customer-lookup-service";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { toast } from "@/lib/toast";
import { formatDate } from "@/lib/date";

/** Matches shown per page of the result table. */
const RESULT_PAGE_SIZE = 5;
/** Previous orders listed under a customer before "+N more". */
const PREVIOUS_ORDERS_SHOWN = 3;

type LookupState = "idle" | "loading" | "done" | "rate-limited" | "forbidden" | "error";

const MIN_PHONE_DIGITS = 7;
const MIN_NAME_CHARS = 3;

/** Same classification the server applies — only to avoid a pointless round trip. */
export function isMeaningfulLookupQuery(raw: string): boolean {
  // Arabic-Indic digits are digits (a phone typed on an Arabic keyboard).
  const value = normalizePhoneDigits(raw).trim();
  if (!value) return false;
  // An OMS document number (order STO-2026-000123, lead LD-2026-000123).
  if (/^[A-Za-z]{2,5}-\d{4}-\d{3,}$/.test(value)) return true;
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
 * whether a customer already exists and whether it is theirs. Everything shown
 * is what the server chose to disclose — since R14 (owner decision D4-1) the
 * full name and phone, the latest order and the repeat-customer count
 * (`CustomerMatchCard`), plus the matched reference and assignment flag. A
 * record link appears only when the caller already has scope over it.
 */
export function AdvancedCustomerLookupDialog({
  open,
  onOpenChange,
  initialQuery,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The text the user had typed in a list search that found nothing — runs once on opening. */
  initialQuery?: string;
}) {
  const { t } = useLocale();
  const [query, setQuery] = useState(initialQuery ?? "");
  const [state, setState] = useState<LookupState>("idle");
  const [result, setResult] = useState<AdvancedLookupResult | null>(null);
  const [page, setPage] = useState(0);

  const reset = () => {
    setQuery("");
    setState("idle");
    setResult(null);
    setPage(0);
  };

  const meaningful = isMeaningfulLookupQuery(query);
  const search = async (text: string = query) => {
    if (state === "loading") return;
    if (!isMeaningfulLookupQuery(text)) {
      toast.error(t("customerLookup.hintMinimum"));
      return;
    }
    setState("loading");
    try {
      const next = await customerLookupService.advanced(normalizePhoneDigits(text).trim());
      setResult(next);
      setPage(0);
      setState("done");
    } catch (error) {
      setResult(null);
      // Never an empty "no results": every failure says what it is.
      if (error instanceof ApiError && error.status === 429) {
        setState("rate-limited");
        return;
      }
      if (error instanceof ApiError && error.status === 403) {
        setState("forbidden");
        return;
      }
      setState("error");
    }
  };

  const autoRan = useRef(false);
  useEffect(() => {
    if (!open) {
      autoRan.current = false;
      return;
    }
    if (initialQuery && !autoRan.current && isMeaningfulLookupQuery(initialQuery)) {
      autoRan.current = true;
      setQuery(initialQuery);
      void search(initialQuery);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialQuery]);

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
              onSubmit={() => void search(query)}
              onClear={reset}
              isLoading={state === "loading"}
              placeholder={t("customerLookup.placeholder")}
              className="max-w-none flex-1"
            />
            <EnterpriseButton
              type="button"
              disabled={state === "loading" || !meaningful}
              onClick={() => void search(query)}
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
        {state === "forbidden" ? (
          <p
            className="text-body text-destructive"
            role="alert"
            data-testid="advanced-lookup-forbidden"
          >
            {t("customerLookup.forbidden")}
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
            {/* One DOM for every width: a table on sm+, each row a stacked card on phones. */}
            <div className="rounded-sm sm:border sm:border-border">
              <Table
                data-testid="advanced-lookup-table"
                className="max-sm:block"
                containerClassName="max-sm:overflow-visible"
              >
                <TableHeader className="max-sm:hidden">
                  <TableRow>
                    <TableHead>{t("customerLookup.columns.customer")}</TableHead>
                    <TableHead>{t("customerLookup.columns.reference")}</TableHead>
                    <TableHead>{t("customerLookup.columns.assignment")}</TableHead>
                    <TableHead>
                      <span className="sr-only">{t("customerLookup.open")}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="max-sm:flex max-sm:flex-col max-sm:gap-2">
                  {result.matches
                    .slice(page * RESULT_PAGE_SIZE, (page + 1) * RESULT_PAGE_SIZE)
                    .map((match, index) => (
                      <TableRow
                        key={`${match.reference?.number ?? "none"}-${index}`}
                        className="max-sm:flex max-sm:flex-col max-sm:gap-2 max-sm:rounded-sm max-sm:border max-sm:border-border max-sm:p-3"
                      >
                        <TableCell className="align-top max-sm:p-0">
                          <MatchCustomer match={match} />
                        </TableCell>
                        <TableCell className="align-top max-sm:p-0">
                          <MatchRecords match={match} />
                        </TableCell>
                        <TableCell className="align-top max-sm:p-0">
                          <MatchAssignment match={match} />
                        </TableCell>
                        <TableCell className="text-end align-top max-sm:p-0 max-sm:text-start">
                          <MatchAction match={match} />
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </div>
            <ListPager
              page={page}
              pageSize={RESULT_PAGE_SIZE}
              total={result.matches.length}
              onPageChange={setPage}
            />
            {result.capped ? (
              <p className="text-caption text-muted-foreground">{t("customerLookup.capped")}</p>
            ) : null}
          </div>
        ) : null}
      </div>
    </EnterpriseModal>
  );
}

/** The shared full-disclosure card (R14) and the record kind. */
function MatchCustomer({ match }: { match: AdvancedLookupMatch }) {
  const { t } = useLocale();
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <CustomerMatchCard disclosure={match.disclosure} />
      <span className="text-caption text-muted-foreground">
        {t(`customerLookup.kind.${match.kind}`)}
      </span>
    </div>
  );
}

/** The record the search matched, then (own customers only) earlier orders the caller may open. */
function MatchRecords({ match }: { match: AdvancedLookupMatch }) {
  const { t } = useLocale();
  const earlier = (match.previousOrders ?? []).filter(
    (order) => order.number !== match.reference?.number,
  );
  const shown = earlier.slice(0, PREVIOUS_ORDERS_SHOWN);
  // The card already shows the latest order; repeat the reference only when it is another record.
  const reference =
    match.reference?.type === "ORDER" &&
    match.reference.number === match.disclosure.latestOrder?.number
      ? null
      : match.reference;
  if (!reference && shown.length === 0 && match.reference) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {reference ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span dir="ltr" className="font-medium">
            {reference.number}
          </span>
          <StatusBadge
            tone={STATUS_TONE[reference.status] ?? "neutral"}
            label={t(`customerLookup.status.${reference.status}`)}
          />
          <span className="text-caption text-muted-foreground">
            {t(`customerLookup.referenceType.${reference.type}`)}
          </span>
        </div>
      ) : match.reference ? null : (
        <span className="text-muted-foreground">{t("customerLookup.noReference")}</span>
      )}
      {shown.length > 0 ? (
        <ul
          className="flex flex-col gap-0.5 border-s-2 border-border ps-2"
          aria-label={t("customerLookup.previousOrders")}
          data-testid="advanced-lookup-previous"
        >
          {shown.map((order) => (
            <li key={order.id} className="flex flex-wrap items-center gap-x-2 text-caption">
              <EnterpriseButton asChild variant="link" size="inline">
                <Link href={`/store-orders/${order.id}`} dir="ltr">
                  {order.number}
                </Link>
              </EnterpriseButton>
              <span className="text-muted-foreground">{formatDate(order.orderDate)}</span>
              <span className="text-muted-foreground">
                {t(`customerLookup.status.${order.status}`)}
              </span>
            </li>
          ))}
          {earlier.length > shown.length ? (
            <li className="text-caption text-muted-foreground">
              {t("customerLookup.moreOrders", { count: earlier.length - shown.length })}
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}

function MatchAssignment({ match }: { match: AdvancedLookupMatch }) {
  const { t } = useLocale();
  return (
    <StatusBadge
      tone={match.notAssignedToYou ? "warning" : "success"}
      label={
        match.notAssignedToYou
          ? t("customerLookup.notAssignedToYou")
          : t("customerLookup.assignedToYou")
      }
    />
  );
}

/** A link only where the caller already has scope over the record; otherwise read-only. */
function MatchAction({ match }: { match: AdvancedLookupMatch }) {
  const { t } = useLocale();
  const href = match.openable
    ? match.openable.type === "ORDER"
      ? `/store-orders/${match.openable.id}`
      : `/crm/leads/${match.openable.id}`
    : null;
  return href ? (
    <EnterpriseButton asChild variant="link" size="inline">
      <Link href={href}>{t("customerLookup.open")}</Link>
    </EnterpriseButton>
  ) : (
    <span className="text-caption text-muted-foreground">{t("customerLookup.noAccess")}</span>
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

/**
 * Shown under an empty LIST search: the list only searches records inside the
 * employee's own scope, so "nothing found" may still be an existing customer
 * owned by someone else. Offers the audited advanced lookup (masked, read-only)
 * for the same text — only to users who hold `customers.lookup_advanced`, and
 * only for a text the lookup accepts.
 */
export function AdvancedLookupFallback({ term }: { term: string }) {
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const [open, setOpen] = useState(false);
  if (!hasPermission("customers.lookup_advanced") || !isMeaningfulLookupQuery(term)) return null;
  return (
    <>
      <EnterpriseButton
        type="button"
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={() => setOpen(true)}
        data-testid="advanced-lookup-fallback"
      >
        <ShieldCheck className="size-4" />
        {t("customerLookup.trigger")}
      </EnterpriseButton>
      <AdvancedCustomerLookupDialog open={open} onOpenChange={setOpen} initialQuery={term} />
    </>
  );
}
