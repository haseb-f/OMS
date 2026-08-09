import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { JournalType } from '@prisma/client';

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

  @IsUUID()
  @IsOptional()
  defaultDebitAccountId?: string;

  @IsUUID()
  @IsOptional()
  defaultCreditAccountId?: string;

  @IsUUID()
  @IsOptional()
  currencyId?: string;

  @IsUUID()
  @IsOptional()
  companyId?: string;

  @IsUUID()
  @IsOptional()
  branchId?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
