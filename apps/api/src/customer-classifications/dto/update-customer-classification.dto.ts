import { PartialType } from '@nestjs/mapped-types';
import { CreateCustomerClassificationDto } from './create-customer-classification.dto';

export class UpdateCustomerClassificationDto extends PartialType(
  CreateCustomerClassificationDto,
) {}
