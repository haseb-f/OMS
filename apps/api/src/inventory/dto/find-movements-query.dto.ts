import { IsEnum, IsOptional } from 'class-validator';
import { InventoryMovementType } from '@prisma/client';
import {
  TransformEnumList,
  IsOptionalUuidList,
} from '../../common/query/enum-list';

export class FindMovementsQueryDto {
  @IsOptionalUuidList()
  productId?: string[];

  @IsOptionalUuidList()
  warehouseId?: string[];

  @TransformEnumList()
  @IsEnum(InventoryMovementType, { each: true })
  @IsOptional()
  type?: InventoryMovementType[];
}
