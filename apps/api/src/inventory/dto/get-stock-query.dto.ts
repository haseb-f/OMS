import { IsUUID } from 'class-validator';
import { IsOptionalUuid } from '../../common/decorators/is-optional-uuid.decorator';
import { OwnerFilterQueryDto } from './owner-filter';

export class GetStockQueryDto extends OwnerFilterQueryDto {
  @IsUUID()
  productId!: string;

  @IsOptionalUuid()
  warehouseId?: string;
}
