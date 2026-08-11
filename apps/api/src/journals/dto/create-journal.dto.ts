import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { JournalType } from '@prisma/client';
import { IsOptionalUuid } from '../../common/decorators/is-optional-uuid.decorator';

/**
 * Journal (TASK-053) — the book of entry an accounting document belongs to
 * (Sales/Purchase/Cash/Bank/General). Configuration only: no posting or
 * numbering logic lives here — see the `Journal` model comment in schema.prisma.
 */
export class CreateJournalDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsEnum(JournalType)
  type!: JournalType;

  @IsString()
  @IsOptional()
  sequencePrefix?: string;

  @IsOptionalUuid()
  defaultDebitAccountId?: string;

  @IsOptionalUuid()
  defaultCreditAccountId?: string;

  @IsOptionalUuid()
  currencyId?: string;

  @IsOptionalUuid()
  companyId?: string;

  @IsOptionalUuid()
  branchId?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
