import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { InventoryMovementType } from '@prisma/client';

export class FindMovementsQueryDto {
  @IsUUID()
  @IsOptional()
  productId?: string;

  @IsUUID()
  @IsOptional()
  warehouseId?: string;

  @IsEnum(InventoryMovementType)
  @IsOptional()
  type?: InventoryMovementType;
}
