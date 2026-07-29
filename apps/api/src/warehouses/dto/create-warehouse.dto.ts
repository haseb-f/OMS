import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class CreateWarehouseDto {
  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsBoolean()
  @IsOptional()
  isDefault?: boolean;

  /** No closed set of values specified — free-text classifier. */
  @IsString()
  @IsOptional()
  warehouseType?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  /** Future warehouse hierarchy — prepared only, no depth/cycle validation. */
  @IsUUID()
  @IsOptional()
  parentWarehouseId?: string;
}
