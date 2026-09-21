import { Transform } from 'class-transformer';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class RejectPaymentDto {
  /** Defaults to the authenticated user. */
  @IsUUID()
  @IsOptional()
  rejectedById?: string;

  /** Required — a rejection must always explain itself to the sales agent. */
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty({ message: 'A rejection reason is required.' })
  @MaxLength(500)
  rejectionReason!: string;
}
