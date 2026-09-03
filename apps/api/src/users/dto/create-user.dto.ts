import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
  ValidateIf,
} from 'class-validator';
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

  @ValidateIf((dto: CreateUserDto) => dto.generatePassword !== true)
  @IsString()
  @MinLength(8)
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
}
