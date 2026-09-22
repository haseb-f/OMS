import { PartialType } from '@nestjs/mapped-types';
import { CreateCustomerRefundDto } from './create-customer-refund.dto';

export class UpdateCustomerRefundDto extends PartialType(
  CreateCustomerRefundDto,
) {}
