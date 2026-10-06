import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CreateCustomerReceiptDto } from './create-customer-receipt.dto';

export class UpdateCustomerReceiptDto extends PartialType(
  OmitType(CreateCustomerReceiptDto, ['idempotencyKey'] as const),
) {}
