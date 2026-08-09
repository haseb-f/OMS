import { PartialType } from '@nestjs/mapped-types';
import { CreateCustomerReceiptDto } from './create-customer-receipt.dto';

export class UpdateCustomerReceiptDto extends PartialType(
  CreateCustomerReceiptDto,
) {}
