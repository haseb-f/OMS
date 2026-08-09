import { PartialType } from '@nestjs/mapped-types';
import { CreateWarehouseLocationDto } from './create-warehouse-location.dto';

export class UpdateWarehouseLocationDto extends PartialType(
  CreateWarehouseLocationDto,
) {}
