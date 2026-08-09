import { IsEnum } from 'class-validator';
import { InventoryValuationMethod } from '@prisma/client';

export class UpdateValuationMethodDto {
  @IsEnum(InventoryValuationMethod)
  valuationMethod!: InventoryValuationMethod;
}
