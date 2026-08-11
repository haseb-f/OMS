import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { JournalEntryLineInputDto } from './journal-entry-line-input.dto';
import { IsOptionalUuid } from '../../common/decorators/is-optional-uuid.decorator';

export class CreateJournalEntryDto {
  /** Defaults to "now" in the service when omitted. */
  @IsDateString()
  @IsOptional()
  entryDate?: string;

  @IsString()
  @IsOptional()
  description?: string;

  /** TASK-053 — optional at Draft (a proposal can be staged before deciding), required to Post ("no posting without a Journal"). */
  @IsOptionalUuid()
  journalId?: string;

  /** TASK-058 — document currency, purely a label (no exchange-rate conversion architecture exists yet — see Sales/Purchase documents' own Currency field). */
  @IsOptionalUuid()
  currencyId?: string;

  /** TASK-058 — "Partner (optional)": at most one of Customer/Supplier, validated in the service. */
  @IsOptionalUuid()
  partnerCustomerId?: string;

  @IsOptionalUuid()
  partnerSupplierId?: string;

  @IsString()
  @IsOptional()
  referenceNumber?: string;

  /** At least 2 lines — a journal entry needs a debit side and a credit side. */
  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => JournalEntryLineInputDto)
  lines!: JournalEntryLineInputDto[];
}
