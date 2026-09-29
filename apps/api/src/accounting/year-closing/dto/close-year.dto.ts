import { Transform } from 'class-transformer';
import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { IsOptionalUuid } from '../../../common/decorators/is-optional-uuid.decorator';

export class CloseYearDto {
  @IsUUID()
  fiscalYearId!: string;

  /**
   * Not supported — rejected with OPENING_BALANCES_ARE_DERIVED: the next
   * year's opening balances are derived from the ledger, never re-posted.
   * Kept on the DTO only so an old client gets that explicit error instead
   * of the validation pipe silently stripping the field.
   */
  @IsOptionalUuid()
  nextFiscalYearId?: string;
}

export class ReverseYearClosingDto {
  /** Trimmed BEFORE validation, so "     " fails MinLength instead of being stored empty. */
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason!: string;
}
