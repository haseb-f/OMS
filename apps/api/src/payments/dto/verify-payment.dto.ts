import { IsOptional, IsUUID } from 'class-validator';

export class VerifyPaymentDto {
  /** Defaults to the authenticated user. */
  @IsUUID()
  @IsOptional()
  verifiedById?: string;
}
