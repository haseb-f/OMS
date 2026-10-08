import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { ShippingMethodType } from '@prisma/client';

export class CreateShippingCompanyDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsEnum(ShippingMethodType)
  @IsOptional()
  type?: ShippingMethodType;

  @IsString()
  @IsOptional()
  description?: string;

  /**
   * R15 (D15-9) — the payment method (its clearing account = "receivable
   * from this carrier") for cash the carrier collects on delivery. The form's
   * empty choice ("") clears it to `null`: COD collections of this carrier
   * are then not tracked. Omitted = unchanged.
   */
  @Transform(({ value }: { value: unknown }): unknown =>
    value === '' ? null : value,
  )
  @IsOptional()
  @IsUUID()
  codPaymentMethodId?: string | null;
}
