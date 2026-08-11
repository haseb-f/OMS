import { IsUUID } from 'class-validator';

/** The user picks one candidate (or any other PENDING payment) from the classified list — never auto-applied. */
export class ConfirmMatchDto {
  @IsUUID()
  paymentId!: string;
}
