import { IsOptional, IsUUID } from 'class-validator';

export class GetStockQueryDto {
  @IsUUID()
  productId!: string;

  @IsUUID()
  @IsOptional()
  warehouseId?: string;
}
