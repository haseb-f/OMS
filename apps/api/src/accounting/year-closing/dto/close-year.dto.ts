import { IsUUID } from 'class-validator';
import { IsOptionalUuid } from '../../../common/decorators/is-optional-uuid.decorator';

export class CloseYearDto {
  @IsUUID()
  fiscalYearId!: string;

  /** Refused when supplied (YEAR_CLOSING_CARRY_FORWARD_DISABLED): a next-year opening entry would double balances in the cumulative ledger. Kept so old clients get a clear error instead of a silent ignore. */
  @IsOptionalUuid()
  nextFiscalYearId?: string;
}
