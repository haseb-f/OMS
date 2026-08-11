import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { AccountType } from '@prisma/client';
import { IsOptionalUuid } from '../../common/decorators/is-optional-uuid.decorator';

/**
 * A real Chart of Accounts reference list — code/name/type/hierarchy — but
 * still NOT an accounting engine: no posting, balances, or auto-mappings
 * live here (TASK-044 Part 6 explicitly defers those). Also the FK target
 * PaymentSource/ReceivingAccount and JournalEntryLine point at.
 *
 * `code` is never client-supplied for a normal create anymore (Part 12) —
 * `ChartOfAccountsService.create()` always computes it: proposed from the
 * parent + existing siblings for a child account, or refuses outright for a
 * root account with no parent (there's nothing to derive a root code from).
 * `codeOverride` is the one escape hatch, gated behind the
 * `accounting.chart-of-accounts.override-code` permission — a normal
 * employee's request with `codeOverride` set is rejected, never silently
 * downgraded to the proposed code, so an unauthorized attempt is visible
 * rather than swallowed.
 */
export class CreateChartOfAccountDto {
  @IsString()
  @IsOptional()
  codeOverride?: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsEnum(AccountType)
  accountType!: AccountType;

  @IsOptionalUuid()
  parentAccountId?: string;

  @IsOptionalUuid()
  currencyId?: string;

  @IsBoolean()
  @IsOptional()
  allowReconciliation?: boolean;
}
