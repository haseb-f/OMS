import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CreateExpensePaymentDto } from './create-expense-payment.dto';

export class UpdateExpensePaymentDto extends PartialType(
  OmitType(CreateExpensePaymentDto, ['idempotencyKey'] as const),
) {}
