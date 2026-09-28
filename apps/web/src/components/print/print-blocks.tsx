"use client";

import type { ReactNode } from "react";
import { QRCodeSVG } from "qrcode.react";
import { useLocale } from "@/providers/locale-provider";
import type { PrintCompanyInfo, PrintInfoItem } from "@/types/print-engine";

/**
 * Numbers inside block-level lines use an inline `<bdi className="num">`, not
 * `num` on the block itself: an LTR block would align to the left edge of an
 * RTL sheet, while an inline isolate keeps the line's own start alignment.
 */

/**
 * Shared print blocks (spec §2) — the visual vocabulary every template is
 * built from. Styling lives in `theme/print.css` (`.pr-*`), never in the
 * templates, so one change restyles every printed document.
 */

/** Company identity (start) and document identity (end), over the accent rule. */
export function PrintDocumentHeader({
  company,
  title,
  number,
  lines = [],
}: {
  company: PrintCompanyInfo;
  title: string;
  /** Document number / reference, printed large. */
  number?: string;
  /** Short identity lines under the number (date, status…). */
  lines?: ReactNode[];
}) {
  const { t } = useLocale();
  const contact = [company.phone, company.email, company.website].filter(Boolean);
  return (
    <header className="pr-header" data-print-avoid-break>
      <div className="pr-company">
        {company.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={company.logoUrl} alt="" className="pr-logo" />
        ) : (
          <div aria-hidden className="pr-logo-fallback">
            {company.name.slice(0, 2).toUpperCase()}
          </div>
        )}
        <div className="pr-company-lines">
          <span className="pr-company-name">{company.name}</span>
          {company.vatNumber && (
            <span>
              {t("printDocument.vatNumber")}: <span className="num">{company.vatNumber}</span>
            </span>
          )}
          {company.crNumber && (
            <span>
              {t("printDocument.crNumber")}: <span className="num">{company.crNumber}</span>
            </span>
          )}
          {company.addressLines?.map((line) => (
            <span key={line}>
              <bdi dir="auto">{line}</bdi>
            </span>
          ))}
          {contact.length > 0 && (
            <span>
              <bdi className="num">{contact.join("  ·  ")}</bdi>
            </span>
          )}
        </div>
      </div>
      <div className="pr-doc-id">
        <h1 className="pr-title">{title}</h1>
        {number ? <span className="pr-number num">{number}</span> : null}
        {lines.map((line, index) => (
          <span key={index} className="pr-doc-sub">
            {line}
          </span>
        ))}
      </div>
    </header>
  );
}

/** Label / value pairs (document info, report scope). Empty values are skipped. */
export function PrintInfo({ items }: { items: PrintInfoItem[] }) {
  const shown = items.filter((item) => item.value !== "" && item.value != null);
  if (shown.length === 0) return null;
  return (
    <dl className="pr-info">
      {shown.map((item) => (
        <div key={item.label} style={{ display: "contents" }}>
          <dt>{item.label}</dt>
          <dd>{item.ltr ? <bdi className="num">{item.value}</bdi> : item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The party (customer / supplier / account) block. */
export function PrintParty({
  role,
  name,
  lines = [],
  phone,
  taxNumber,
}: {
  role: string;
  name: string;
  lines?: string[];
  phone?: string;
  taxNumber?: string;
}) {
  const { t } = useLocale();
  return (
    <div>
      <div className="pr-panel-title">{role}</div>
      <div className="pr-party-name">{name || "—"}</div>
      <div className="pr-lines">
        {taxNumber && (
          <span>
            {t("printDocument.vatNumber")}: <span className="num">{taxNumber}</span>
          </span>
        )}
        {lines.map((line) => (
          <span key={line}>
            <bdi dir="auto">{line}</bdi>
          </span>
        ))}
        {phone && (
          <span>
            <bdi className="num">{phone}</bdi>
          </span>
        )}
      </div>
    </div>
  );
}

/** Two side-by-side panels under the header (party | document info). */
export function PrintPanels({ start, end }: { start: ReactNode; end: ReactNode }) {
  return (
    <section className="pr-panels" data-print-avoid-break>
      <div>{start}</div>
      <div>{end}</div>
    </section>
  );
}

/** A single wrapped line of "label: value" pairs (report scope, filters). */
export function PrintMetaStrip({ items }: { items: PrintInfoItem[] }) {
  const shown = items.filter((item) => item.value !== "" && item.value != null);
  if (shown.length === 0) return null;
  return (
    <div className="pr-meta-strip" data-print-avoid-break>
      {shown.map((item) => (
        <span key={item.label}>
          {item.label}: <b className={item.ltr ? "num" : undefined}>{item.value}</b>
        </span>
      ))}
    </div>
  );
}

export interface PrintTotalRow {
  label: string;
  value: string;
  emphasis?: boolean;
}

/** The totals column at the logical end, grand total ruled and bold. */
export function PrintTotals({ rows }: { rows: PrintTotalRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="pr-totals" data-print-avoid-break>
      {rows.map((row) => (
        <div key={row.label} className="pr-total-row" data-emphasis={row.emphasis || undefined}>
          <span>{row.label}</span>
          <span className="num">{row.value}</span>
        </div>
      ))}
    </div>
  );
}

/** Titled free-text section (notes & terms). */
export function PrintSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="pr-section" data-print-avoid-break>
      <div className="pr-section-title">{title}</div>
      {children}
    </section>
  );
}

/** QR that opens a real record in OMS (a working identifier, never decorative). */
export function PrintQr({ url, label, size = 64 }: { url: string; label: string; size?: number }) {
  return (
    <div className="pr-qr" data-print-avoid-break>
      <QRCodeSVG value={url} size={size} level="M" marginSize={0} title={label} />
      <span style={{ maxWidth: "32mm" }}>{label}</span>
    </div>
  );
}

/** Signature lines (vouchers). */
export function PrintSignatures({ labels }: { labels: { label: string; name?: string }[] }) {
  if (labels.length === 0) return null;
  return (
    <div className="pr-signatures" data-print-avoid-break>
      {labels.map((signature) => (
        <div key={signature.label}>
          <div>{signature.label}</div>
          <div className="pr-signature-line">{signature.name ?? ""}</div>
        </div>
      ))}
    </div>
  );
}

/** Absolute URL of an in-app record for its QR; null outside the browser. */
export function recordUrl(recordPath: string | undefined): string | null {
  if (!recordPath || typeof window === "undefined") return null;
  return new URL(recordPath, window.location.origin).toString();
}
