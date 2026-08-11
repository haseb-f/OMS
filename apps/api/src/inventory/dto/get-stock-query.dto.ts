import { IsUUID } from 'class-validator';
import { IsOptionalUuid } from '../../common/decorators/is-optional-uuid.decorator';

export class GetStockQueryDto {
  @IsUUID()
  productId!: string;

  @IsOptionalUuid()
  warehouseId?: string;
}
