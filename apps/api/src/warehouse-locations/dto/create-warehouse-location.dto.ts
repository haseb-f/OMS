import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { IsOptionalUuid } from '../../common/decorators/is-optional-uuid.decorator';

export class CreateWarehouseLocationDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsUUID()
  @IsNotEmpty()
  warehouseId!: string;

  @IsOptionalUuid()
  parentLocationId?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
