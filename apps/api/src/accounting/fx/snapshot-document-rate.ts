import { Prisma } from '@prisma/client';
import { ExchangeRatesService } from './exchange-rates.service';

type RateWriter = (rate: number) => Promise<unknown>;

export async function snapshotDocumentExchangeRate(
  exchangeRates: ExchangeRatesService,
  tx: Prisma.TransactionClient,
  write: RateWriter,
  currencyId: string | null | undefined,
  existing: unknown,
  asOf: Date,
): Promise<number> {
  if (existing != null && existing !== '') return Number(existing);
  const rate = await exchangeRates.snapshotRate(currencyId, asOf, tx);
  await write(rate);
  return rate;
}
