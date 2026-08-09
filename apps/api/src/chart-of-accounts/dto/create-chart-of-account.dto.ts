import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { AccountType } from '@prisma/client';

/**
 * A real Chart of Accounts reference list — code/name/type/hierarchy — but
 * still NOT an accounting engine: no posting, balances, or auto-mappings
 * live here (TASK-044 Part 6 explicitly defers those). Also the FK target
 * PaymentSource/ReceivingAccount and JournalEntryLine point at.
 */
export class CreateChartOfAccountDto {
  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsEnum(AccountType)
  accountType!: AccountType;

  @IsUUID()
  @IsOptional()
  parentAccountId?: string;

  @IsUUID()
  @IsOptional()
  currencyId?: string;

  @IsBoolean()
  @IsOptional()
  allowReconciliation?: boolean;
}
