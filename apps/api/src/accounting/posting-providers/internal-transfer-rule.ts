import type { PostingLine } from '../posting-engine/posting-provider.interface';

/**
 * The one accounting rule of an internal transfer (Reconciliation Part H,
 * R22 D4): a movement between two of the company's own cash / bank ledger
 * accounts is a two-line Dr destination / Cr source entry — never revenue or
 * expense, no partner. Shared by the paired bank-line transfer
 * (`InternalTransferPostingProvider`) and the transfer voucher
 * (`OtherVoucherPostingProvider`), so both paths post identically.
 */
export function internalTransferLines(input: {
  destinationAccountId: string;
  sourceAccountId: string;
  amount: number;
  description: string;
}): PostingLine[] {
  return [
    {
      accountId: input.destinationAccountId,
      debit: input.amount,
      description: input.description,
    },
    {
      accountId: input.sourceAccountId,
      credit: input.amount,
      description: input.description,
    },
  ];
}
