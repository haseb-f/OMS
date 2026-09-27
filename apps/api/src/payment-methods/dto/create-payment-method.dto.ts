import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class CreatePaymentMethodDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsOptional()
  description?: string;

  /** The Chart of Accounts account this channel posts to — required so every Payment Method always resolves to a real accounting destination (never free text, never auto-created). */
  @IsUUID()
  accountId!: string;

  /**
   * Claims for this method go through the provider statement /
   * reconciliation workspace. Changing it never re-processes existing
   * claims — it only affects how new claims are reviewed.
   */
  @IsBoolean()
  @IsOptional()
  requiresReconciliation?: boolean;

  /** Inactive methods cannot be chosen for new payment declarations. */
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
