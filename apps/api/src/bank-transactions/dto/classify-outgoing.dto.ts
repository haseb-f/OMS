import { IsEnum } from 'class-validator';
import { CashFlowOutgoingType } from '@prisma/client';
import { IsOptionalUuid } from '../../common/decorators/is-optional-uuid.decorator';

export class ClassifyOutgoingDto {
  @IsEnum(CashFlowOutgoingType)
  outgoingType!: CashFlowOutgoingType;

  /** Required when `outgoingType = EXPENSE`. */
  @IsOptionalUuid()
  expenseAccountId?: string;

  /** Required when `outgoingType = SUPPLIER_PAYMENT`. */
  @IsOptionalUuid()
  partnerId?: string;

  @IsOptionalUuid()
  costCenterId?: string;

  @IsOptionalUuid()
  projectId?: string;
}
