import { IsOptionalUuid } from '../../common/decorators/is-optional-uuid.decorator';

/** All fields optional — defaults to the row's own import-time classification hints (`expenseAccountId`/`costCenterId`/`projectId`) when omitted, overridable per spec section 16 ("manually classify an outgoing transaction"). */
export class ConfirmExpenseVoucherDto {
  @IsOptionalUuid()
  expenseAccountId?: string;

  @IsOptionalUuid()
  costCenterId?: string;

  @IsOptionalUuid()
  projectId?: string;

  @IsOptionalUuid()
  paymentSourceId?: string;
}
