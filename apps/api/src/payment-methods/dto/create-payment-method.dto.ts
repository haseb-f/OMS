import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

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
}
