import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

/**
 * Minimal ledger-account reference list only — NOT an accounting engine.
 * No posting, journal entries, or balances — those are explicitly out of
 * scope. This exists purely so PaymentSource/ReceivingAccount have a real
 * FK target to point at.
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
}
