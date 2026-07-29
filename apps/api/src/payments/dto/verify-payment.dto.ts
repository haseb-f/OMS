import { IsUUID } from 'class-validator';

export class VerifyPaymentDto {
  @IsUUID()
  verifiedById!: string;
}
