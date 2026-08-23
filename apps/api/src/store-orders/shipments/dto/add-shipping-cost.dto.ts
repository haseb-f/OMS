import { Transform } from 'class-transformer';
import { IsEnum, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { ShippingCostPayer } from '@prisma/client';
import { emptyToUndefined } from '../../../common/transforms/empty-to-undefined';

export class AddShippingCostDto {
  @IsNumber()
  @Min(0)
  @IsOptional()
  baseShippingCost?: number;

  /** Legacy alias used by some clients. */
  @IsNumber()
  @Min(0)
  @IsOptional()
  shippingCost?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  additionalShippingCost?: number;

  @IsEnum(ShippingCostPayer)
  @IsOptional()
  costPaidBy?: ShippingCostPayer;

  @Transform(emptyToUndefined)
  @IsString()
  @IsOptional()
  notes?: string;
}
