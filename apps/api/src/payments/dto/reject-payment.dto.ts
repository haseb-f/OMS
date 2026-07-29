import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class RejectPaymentDto {
  @IsUUID()
  rejectedById!: string;

  @IsString()
  @IsNotEmpty()
  @IsOptional()
  rejectionReason?: string;
}
