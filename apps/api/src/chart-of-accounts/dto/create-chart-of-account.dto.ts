import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { AccountType } from '@prisma/client';
import { IsOptionalUuid } from '../../common/decorators/is-optional-uuid.decorator';
import { CHART_ACCOUNT_KINDS, type ChartAccountKind } from '../coa.constants';

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
  nameEn?: string;

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

  /**
   * R13 B1 — the explicit account kind. GROUP aggregates children and never
   * receives a journal line; POSTING is a leaf that receives lines and may
   * never have children. Default POSTING. Never flipped implicitly.
   */
  @IsIn(CHART_ACCOUNT_KINDS)
  @IsOptional()
  accountKind?: ChartAccountKind;

  /**
   * Legacy boolean form of `accountKind` (false = GROUP), still accepted from
   * older callers; `accountKind` wins when both are sent.
   */
  @IsBoolean()
  @IsOptional()
  allowsPosting?: boolean;
}
