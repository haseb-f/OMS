import { IsUUID } from 'class-validator';

/** Confirms a pair of BankTransaction rows as one Internal Transfer (Reconciliation Part H). */
export class ConfirmInternalTransferDto {
  @IsUUID()
  pairedId!: string;
}
