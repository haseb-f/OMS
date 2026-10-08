import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** R15 (D15-12) — why a VERIFIED payment is reversed as recorded in error (audited, required). */
export class ReversePaymentDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty({ message: 'A reversal reason is required.' })
  @MaxLength(500)
  reason!: string;
}
