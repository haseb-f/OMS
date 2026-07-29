import {
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
} from 'class-validator';

export class TransferDto {
  @IsUUID()
  productId!: string;

  @IsUUID()
  sourceWarehouseId!: string;

  @IsUUID()
  destinationWarehouseId!: string;

  @IsInt()
  @IsPositive()
  quantity!: number;

  @IsString()
  @IsOptional()
  notes?: string;
}
