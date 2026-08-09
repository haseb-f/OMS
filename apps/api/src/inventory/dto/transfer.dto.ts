import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';

export class TransferLineDto {
  @IsUUID()
  productId!: string;

  @IsInt()
  @IsPositive()
  quantity!: number;
}

/** One Stock Transfer document can move several products at once (TASK-029) — one shared document number, one OUT/IN movement pair per line. */
export class TransferDto {
  @IsUUID()
  sourceWarehouseId!: string;

  @IsUUID()
  destinationWarehouseId!: string;

  @ValidateNested({ each: true })
  @Type(() => TransferLineDto)
  @ArrayMinSize(1)
  lines!: TransferLineDto[];

  @IsString()
  @IsOptional()
  notes?: string;
}
