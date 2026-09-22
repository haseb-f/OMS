import { Transform } from 'class-transformer';
import { IsArray, IsBoolean, IsOptional, IsUUID } from 'class-validator';
import { ReportQueryBaseDto } from './report-query-base.dto';
import { IsOptionalUuid } from '../../../common/decorators/is-optional-uuid.decorator';

/**
 * General Ledger — `accountId` (single, legacy) and/or `accountIds`
 * (comma-separated or repeated) narrow the ledger to the selected accounts;
 * omitted returns every account. `page`/`pageSize` page over accounts.
 */
export class GeneralLedgerQueryDto extends ReportQueryBaseDto {
  @IsOptionalUuid()
  accountId?: string;

  @Transform(({ value }: { value: unknown }): unknown => {
    if (value === undefined || value === null || value === '') return undefined;
    const list: unknown[] = Array.isArray(value)
      ? value
      : typeof value === 'string'
        ? value.split(',')
        : [value];
    const ids = list
      .map((v) => (typeof v === 'string' ? v.trim() : v))
      .filter((v) => v !== '');
    return ids.length > 0 ? ids : undefined;
  })
  @IsArray()
  @IsUUID('all', { each: true })
  @IsOptional()
  accountIds?: string[];

  /**
   * Default false — only accounts carrying an opening balance or a movement
   * in scope are listed (the same account set the Trial Balance shows).
   */
  @Transform(({ value }) =>
    value === undefined || value === null || value === ''
      ? undefined
      : value === true || value === 'true',
  )
  @IsBoolean()
  @IsOptional()
  includeEmpty?: boolean = false;
}
