import { IsEnum, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { ShippingCostPayer } from '@prisma/client';

export class AddShippingCostDto {
  @IsNumber()
  @Min(0)
  @IsOptional()
  baseShippingCost?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  additionalShippingCost?: number;

  @IsEnum(ShippingCostPayer)
  costPaidBy!: ShippingCostPayer;

  /** Decision #2: Shipment stores Notes. Bundled here since no dedicated operation was requested for it. */
  @IsString()
  @IsOptional()
  notes?: string;
}
