import { PartialType } from '@nestjs/mapped-types';
import { CreateSupplierGroupDto } from './create-supplier-group.dto';

export class UpdateSupplierGroupDto extends PartialType(
  CreateSupplierGroupDto,
) {}
