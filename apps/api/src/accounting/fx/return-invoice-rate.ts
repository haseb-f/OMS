import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ExchangeRatesService } from './exchange-rates.service';
import { snapshotDocumentExchangeRate } from './snapshot-document-rate';

/**
 * R22 F1 / F10 — a return (credit / debit note) linked to an invoice
 * reverses THAT invoice: it is in the invoice's currency and posts at the
 * invoice's frozen exchange rate, so the credit it applies to the invoice
 * (R22 D2) clears exactly the receivable / payable the invoice booked and no
 * FX residue is left on the partner's AR / AP. A return without an invoice
 * keeps the rate of its own date.
 */
export type ReturnSide = 'sales' | 'purchase';

type CurrencyClient = Pick<
  Prisma.TransactionClient,
  'salesInvoice' | 'purchaseInvoice' | 'postingSettings'
>;

/** The invoice's currency + rate; refuses a return in another currency (RETURN_CURRENCY_MISMATCH). */
export async function assertReturnCurrency(
  client: CurrencyClient,
  side: ReturnSide,
  invoiceId: string,
  returnCurrencyId: string | null | undefined,
): Promise<{ currencyId: string | null; exchangeRate: number | null }> {
  const select = {
    invoiceNumber: true,
    currencyId: true,
    exchangeRate: true,
    currency: { select: { code: true } },
  } as const;
  const invoice =
    side === 'sales'
      ? await client.salesInvoice.findUnique({
          where: { id: invoiceId },
          select,
        })
      : await client.purchaseInvoice.findUnique({
          where: { id: invoiceId },
          select,
        });
  if (!invoice) {
    return { currencyId: returnCurrencyId ?? null, exchangeRate: null };
  }
  const settings = await client.postingSettings.findFirst({
    select: {
      functionalCurrencyId: true,
      functionalCurrency: { select: { code: true } },
    },
  });
  const functionalId = settings?.functionalCurrencyId ?? null;
  const normalize = (id: string | null | undefined) => id ?? functionalId;
  if (
    returnCurrencyId !== undefined &&
    normalize(returnCurrencyId) !== normalize(invoice.currencyId)
  ) {
    const invoiceCode =
      invoice.currency?.code ??
      settings?.functionalCurrency?.code ??
      'the functional currency';
    throw new BadRequestException({
      code: 'RETURN_CURRENCY_MISMATCH',
      message: `عملة المرتجع يجب أن تطابق عملة الفاتورة ${invoice.invoiceNumber} (${invoiceCode}) — A return reverses its invoice: it must be in the currency of ${invoice.invoiceNumber} (${invoiceCode}).`,
      fields: [
        { field: 'currencyId', constraints: ['return_currency_mismatch'] },
      ],
    });
  }
  return {
    currencyId: invoice.currencyId,
    exchangeRate:
      invoice.exchangeRate != null ? Number(invoice.exchangeRate) : null,
  };
}

/**
 * The rate a return posts at: its linked invoice's frozen rate (stored on the
 * return when it differs), otherwise the snapshot of its own date.
 */
export async function returnPostingRate(
  exchangeRates: ExchangeRatesService,
  tx: Prisma.TransactionClient,
  side: ReturnSide,
  document: {
    invoiceId: string | null;
    currencyId: string | null;
    exchangeRate: unknown;
    postedAt: Date;
  },
  write: (rate: number) => Promise<unknown>,
): Promise<number> {
  if (document.invoiceId) {
    const invoice = await assertReturnCurrency(
      tx,
      side,
      document.invoiceId,
      document.currencyId,
    );
    if (invoice.exchangeRate != null) {
      if (
        document.exchangeRate == null ||
        Math.abs(Number(document.exchangeRate) - invoice.exchangeRate) > 1e-12
      ) {
        await write(invoice.exchangeRate);
      }
      return invoice.exchangeRate;
    }
  }
  return snapshotDocumentExchangeRate(
    exchangeRates,
    tx,
    write,
    document.currencyId,
    document.exchangeRate,
    document.postedAt,
  );
}
