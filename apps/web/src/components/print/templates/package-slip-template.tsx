"use client";

import type { ReactNode } from "react";
import { PrintPage } from "../print-page";
import { PrintTable } from "../print-table";
import { PrintQr, recordUrl } from "../print-blocks";
import { usePrintIdentity } from "../print-brand";
import { formatBusinessDateTime } from "@/lib/business-date";
import { isolateLtr } from "@/lib/date";
import { formatMoney } from "@/lib/money";
import { messages } from "@/i18n/messages";
import { translate, type MessageKey } from "@/i18n/translate";
import { useLocale } from "@/providers/locale-provider";
import type { PackageSlipPayload, PrintCell, PrintColumn } from "@/types/print-engine";

/** The operational lines of a slip print in both languages: UI language first. */
function useBilingual() {
  const { t, locale } = useLocale();
  const other = messages[locale === "ar" ? "en" : "ar"];
  return (key: MessageKey, params?: Record<string, string | number>) => ({
    main: t(key, params),
    alt: translate(other, key, params),
    altDir: (locale === "ar" ? "ltr" : "rtl") as "ltr" | "rtl",
  });
}

function Bilingual({
  text,
  altClass,
}: {
  text: { main: string; alt: string; altDir?: "ltr" | "rtl" };
  altClass?: string;
}) {
  return (
    <>
      <span>{text.main}</span>
      {text.alt !== text.main ? (
        // The other language keeps its own reading order (an isolated run,
        // so numbers and currency stay in place) on a line that still starts
        // at the sheet's start edge.
        <span
          className={altClass}
          style={{ display: "block", fontSize: "0.72em", fontWeight: 600 }}
        >
          <bdi dir={text.altDir}>{text.alt}</bdi>
        </span>
      ) : null}
    </>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="pr-panel-title">{label}</div>
      <div style={{ fontSize: "11pt", fontWeight: 700, lineHeight: 1.25 }}>{children}</div>
    </div>
  );
}

/**
 * Store-order package slip — A5 portrait at actual size (spec §4). An
 * INTERNAL slip attached to the package, never a carrier label: it prints a
 * tracking number only when the carrier already issued one.
 *
 * Reading order for the packing desk and the courier: order number → who it
 * belongs to → how it is fulfilled (PICKUP band) → what to collect → items.
 * The collection box is decided by the builder from the server's
 * fulfillment gate and declared amount (never the accounting balance); the
 * template only words it, in both languages, in black-and-white-safe styles.
 * Long orders flow onto further A5 sheets: the order number repeats in the
 * top margin, the item header repeats, rows never split.
 */
export function PackageSlipTemplate({ payload }: { payload: PackageSlipPayload }) {
  const { t } = useLocale();
  const b = useBilingual();
  // Cairo wall clock, isolated so it keeps its order on an Arabic sheet.
  const printedAt = isolateLtr(formatBusinessDateTime(new Date()));
  const identity = usePrintIdentity(payload.company);
  const qrUrl = recordUrl(payload.recordPath);
  const pickup = payload.method === "PICKUP";
  const amount = (value: number) => `${formatMoney(value)} ${payload.currency}`;
  const units = payload.items.reduce((sum, item) => sum + item.quantity, 0);

  const collection = payload.collection;
  let tone: "collect" | "none" | "hold";
  let title: ReturnType<ReturnType<typeof useBilingual>>;
  let detail: ReturnType<ReturnType<typeof useBilingual>> | null = null;
  if (collection.kind === "collect") {
    tone = "collect";
    title = b(pickup ? "printDocument.collectAtPickup" : "printDocument.collect", {
      amount: amount(collection.amount),
    });
    detail =
      collection.declaredPaid > 0
        ? b("printDocument.codDetail", {
            total: amount(collection.orderTotal),
            paid: amount(collection.declaredPaid),
          })
        : b("printDocument.codDetailFull", { total: amount(collection.orderTotal) });
  } else if (collection.kind === "none") {
    tone = "none";
    title = b("printDocument.noCollection");
    detail =
      collection.basis === "VERIFIED_PAID"
        ? b("printDocument.basisVerified")
        : collection.basis === "COD_SETTLED"
          ? b("printDocument.basisCodSettled")
          : b("printDocument.basisDeclared");
  } else {
    tone = "hold";
    title = b("printDocument.hold");
    detail = b("printDocument.holdDetail");
  }

  const columns: PrintColumn[] = [
    { key: "index", label: "#", align: "center", width: "8mm", nowrap: true },
    { key: "item", label: t("printDocument.item") },
    { key: "qty", label: t("printDocument.qty"), align: "end", width: "14mm" },
  ];
  const rows: Record<string, PrintCell>[] = payload.items.map((item, index) => ({
    index: String(index + 1),
    item: { text: item.name, sub: item.sku },
    qty: String(item.quantity),
  }));

  return (
    <PrintPage
      paper="A5"
      orientation="portrait"
      printedAt={printedAt}
      accentColor={identity.accentColor}
      runningHeader={`${t("printDocument.orderNumber")} ${payload.orderNumber}`}
    >
      <div data-slip style={{ display: "flex", flexDirection: "column", gap: "2.6mm" }}>
        <header className="pr-header" data-print-avoid-break style={{ alignItems: "center" }}>
          <div className="pr-company">
            {identity.company.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={identity.company.logoUrl}
                alt=""
                className="pr-logo"
                style={{ height: "10mm" }}
              />
            ) : null}
            <div className="pr-company-lines">
              <span className="pr-company-name">{identity.company.name}</span>
              <span>{t("printDocument.slipTitle")}</span>
            </div>
          </div>
          <div className="pr-doc-id">
            <span className="pr-doc-sub">{t("printDocument.orderNumber")}</span>
            <span className="num" style={{ fontSize: "19pt", fontWeight: 800, lineHeight: 1.1 }}>
              {payload.orderNumber}
            </span>
            <span className="pr-doc-sub">
              {t("printDocument.orderDate")}: <span className="num">{payload.orderDate}</span>
              {payload.externalOrderId ? (
                <>
                  {" · "}
                  <span className="num">{payload.externalOrderId}</span>
                </>
              ) : null}
            </span>
          </div>
        </header>

        {pickup ? (
          <div className="pr-band" data-print-avoid-break data-testid="slip-pickup-band">
            <Bilingual text={b("printDocument.pickupBand")} />
          </div>
        ) : null}

        <section data-print-avoid-break>
          <div className="pr-panel-title">
            {t(pickup ? "printDocument.pickupFor" : "printDocument.shipTo")}
          </div>
          <div
            style={{
              fontSize: "14pt",
              fontWeight: 700,
              lineHeight: 1.25,
              overflowWrap: "anywhere",
            }}
          >
            {payload.customer.name}
          </div>
          {payload.customer.phone ? (
            <div style={{ fontSize: "13pt", fontWeight: 600 }}>
              <bdi className="num">{payload.customer.phone}</bdi>
            </div>
          ) : null}
          {!pickup && payload.customer.addressLines.length > 0 ? (
            <div style={{ marginTop: "1mm", fontSize: "10pt", overflowWrap: "anywhere" }}>
              {payload.customer.addressLines.join(" · ")}
            </div>
          ) : null}
        </section>

        <section
          data-print-avoid-break
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "3mm",
            paddingBlock: "2mm",
            borderBlock: "0.5pt solid var(--pr-rule)",
          }}
        >
          <Field label={t("printDocument.fulfillment")}>
            <Bilingual
              text={b(pickup ? "printDocument.methodPickup" : "printDocument.methodShipping")}
            />
          </Field>
          <Field label={t("printDocument.paymentType")}>
            <Bilingual
              text={b(
                payload.paymentType === "CASH_ON_DELIVERY"
                  ? "printDocument.cod"
                  : "printDocument.prepaid",
              )}
            />
          </Field>
        </section>

        <div
          className="pr-instruction"
          data-tone={tone}
          data-print-avoid-break
          data-testid="slip-collection"
        >
          <div className={tone === "collect" ? "pr-instruction-amount" : "pr-instruction-title"}>
            <Bilingual text={title} />
          </div>
          {detail ? (
            <div className="pr-instruction-detail">
              <Bilingual text={detail} />
            </div>
          ) : null}
        </div>

        {!pickup && (payload.carrier?.name || payload.carrier?.trackingNumber) ? (
          <div className="pr-meta-strip" style={{ borderBottom: "none", paddingBlock: 0 }}>
            {payload.carrier?.name ? (
              <span>
                {t("printDocument.carrier")}: <b>{payload.carrier.name}</b>
              </span>
            ) : null}
            {payload.carrier?.trackingNumber ? (
              <span>
                {t("printDocument.trackingNumber")}:{" "}
                <b className="num">{payload.carrier.trackingNumber}</b>
              </span>
            ) : null}
          </div>
        ) : null}

        <section>
          <div className="pr-panel-title" data-print-keep-with-next>
            {t("printDocument.items")} ·{" "}
            {t("printDocument.itemsCount", { count: payload.items.length, units })}
          </div>
          <PrintTable
            columns={columns}
            rows={rows}
            density={payload.items.length > 6 ? "compact" : "normal"}
          />
        </section>

        <footer
          data-print-avoid-break
          style={{
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
            gap: "3mm",
          }}
        >
          {qrUrl ? (
            <PrintQr url={qrUrl} label={t("printDocument.scanOrder")} size={56} />
          ) : (
            <span />
          )}
          <span className="pr-footnote" style={{ maxWidth: "60mm", textAlign: "end" }}>
            {t("printDocument.slipInternal")}
          </span>
        </footer>
      </div>
    </PrintPage>
  );
}
