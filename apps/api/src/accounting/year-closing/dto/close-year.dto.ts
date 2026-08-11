import { IsUUID } from 'class-validator';
import { IsOptionalUuid } from '../../../common/decorators/is-optional-uuid.decorator';

export class CloseYearDto {
  @IsUUID()
  fiscalYearId!: string;

  /** Optional — when supplied, also generates that year's Opening Entry carrying forward this year's ending Balance Sheet. */
  @IsOptionalUuid()
  nextFiscalYearId?: string;
}
