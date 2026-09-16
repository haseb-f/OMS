import { IsNumber, Min } from 'class-validator';

/** ADR-0018 (Order Economics M2.2) — the actual provider transaction fee for this Payment, once known. Always supersedes the PaymentSource's fee estimate for this specific payment. */
export class SetActualFeeDto {
  @IsNumber()
  @Min(0)
  actualFeeAmount!: number;
}
