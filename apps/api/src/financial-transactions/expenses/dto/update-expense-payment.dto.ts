import { PartialType } from '@nestjs/mapped-types';
import { CreateExpensePaymentDto } from './create-expense-payment.dto';

export class UpdateExpensePaymentDto extends PartialType(
  CreateExpensePaymentDto,
) {}
