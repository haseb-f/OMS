import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { PASSWORD_POLICY } from '../../auth/password-policy';
import { IsOptionalUuid } from '../../common/decorators/is-optional-uuid.decorator';
import {
  toNormalizedEmail,
  toNormalizedUsername,
} from '../../auth/password.util';

export class CreateUserDto {
  @Transform(({ value }: { value: unknown }) => toNormalizedEmail(value))
  @IsEmail()
  email!: string;

  @Transform(({ value }: { value: unknown }) => toNormalizedUsername(value))
  @IsString()
  @IsNotEmpty()
  username!: string;

  @IsString()
  @IsNotEmpty()
  fullName!: string;

  /** When true, the server generates a temporary password and returns it once. */
  @IsBoolean()
  @IsOptional()
  generatePassword?: boolean;

  /**
   * R13 A2 — the admin set a generated (temporary) password in the form: the
   * user must change it at first sign-in, exactly as with `generatePassword`.
   * Can only make the account stricter, never relax a server-generated one.
   */
  @IsBoolean()
  @IsOptional()
  mustChangePassword?: boolean;

  @ValidateIf((dto: CreateUserDto) => dto.generatePassword !== true)
  @IsString()
  @MinLength(PASSWORD_POLICY.minLength)
  @MaxLength(PASSWORD_POLICY.maxLength)
  password?: string;

  @IsString()
  @IsOptional()
  mobile?: string;

  @IsUUID()
  departmentId!: string;

  @IsOptionalUuid()
  jobTitleId?: string;

  @IsOptionalUuid()
  branchId?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  /**
   * R7 — designate the user as a sales employee for lead distribution
   * (default false). Still requires `crm.leads.edit` to receive leads.
   */
  @IsBoolean()
  @IsOptional()
  salesDistributionEligible?: boolean;
}
