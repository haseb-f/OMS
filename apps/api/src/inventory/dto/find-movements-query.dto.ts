import { IsEnum, IsOptional } from 'class-validator';
import { InventoryMovementType } from '@prisma/client';
import { IsOptionalUuid } from '../../common/decorators/is-optional-uuid.decorator';

export class FindMovementsQueryDto {
  @IsOptionalUuid()
  productId?: string;

  @IsOptionalUuid()
  warehouseId?: string;

  @IsEnum(InventoryMovementType)
  @IsOptional()
  type?: InventoryMovementType;
}
