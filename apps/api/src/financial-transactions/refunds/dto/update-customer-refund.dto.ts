import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CreateCustomerRefundDto } from './create-customer-refund.dto';

export class UpdateCustomerRefundDto extends PartialType(
  OmitType(CreateCustomerRefundDto, ['idempotencyKey'] as const),
) {}
