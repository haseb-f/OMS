import { PartialType } from '@nestjs/mapped-types';
import { CreateUnitConversionDto } from './create-unit-conversion.dto';

export class UpdateUnitConversionDto extends PartialType(
  CreateUnitConversionDto,
) {}
