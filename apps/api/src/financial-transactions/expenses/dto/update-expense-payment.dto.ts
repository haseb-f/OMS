import { OmitType, PartialType } from '@nestjs/mapped-types';
import { IsOptionalUuid } from '../../../common/decorators/is-optional-uuid.decorator';
import { CreateExpensePaymentDto } from './create-expense-payment.dto';

/** Draft edit. `null` clears an optional link (counterparty, cost center, project). */
export class UpdateExpensePaymentDto extends PartialType(
  OmitType(CreateExpensePaymentDto, [
    'idempotencyKey',
    'partnerId',
    'costCenterId',
    'projectId',
  ] as const),
) {
  @IsOptionalUuid()
  partnerId?: string | null;

  @IsOptionalUuid()
  costCenterId?: string | null;

  @IsOptionalUuid()
  projectId?: string | null;
}
