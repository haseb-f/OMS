import { PartialType } from '@nestjs/mapped-types';
import { CreateShippingCompanyDto } from './create-shipping-company.dto';

export class UpdateShippingCompanyDto extends PartialType(
  CreateShippingCompanyDto,
) {}
