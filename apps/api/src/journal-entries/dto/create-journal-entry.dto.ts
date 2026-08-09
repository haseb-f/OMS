import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { JournalEntryLineInputDto } from './journal-entry-line-input.dto';

export class CreateJournalEntryDto {
  /** Defaults to "now" in the service when omitted. */
  @IsDateString()
  @IsOptional()
  entryDate?: string;

  @IsString()
  @IsOptional()
  description?: string;

  /** TASK-053 — optional at Draft (a proposal can be staged before deciding), required to Post ("no posting without a Journal"). */
  @IsUUID()
  @IsOptional()
  journalId?: string;

  /** TASK-058 — document currency, purely a label (no exchange-rate conversion architecture exists yet — see Sales/Purchase documents' own Currency field). */
  @IsUUID()
  @IsOptional()
  currencyId?: string;

  /** TASK-058 — "Partner (optional)": at most one of Customer/Supplier, validated in the service. */
  @IsUUID()
  @IsOptional()
  partnerCustomerId?: string;

  @IsUUID()
  @IsOptional()
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
