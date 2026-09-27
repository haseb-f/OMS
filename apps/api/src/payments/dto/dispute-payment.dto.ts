import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** Finance disputes a Sales payment declaration — the reason is required and shown to Sales. */
export class DisputePaymentDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty({ message: 'A dispute reason is required.' })
  @MaxLength(500)
  reason!: string;
}
