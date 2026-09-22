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

  /** Source-document ids (e.g. a Store Order's invoices/returns) — the traceability panel's "view all" link. */
  @IsOptionalUuidList()
  referenceId?: string[];

  @TransformEnumList()
  @IsEnum(InventoryMovementType, { each: true })
  @IsOptional()
  type?: InventoryMovementType[];
}
