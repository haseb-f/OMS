import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { IsOptionalUuid } from '../../common/decorators/is-optional-uuid.decorator';
import { RecordCompensationDto } from './record-compensation.dto';
import { CreateEmployeeAccountDto } from './create-employee-account.dto';

/**
 * The 4-step Employee creation wizard (Part E), submitted as one request —
 * a compact single Save, not four separate round-trips. Step 1 (البيانات)
 * + Step 2 (العمل) map directly onto Partner + EmployeeProfile fields;
 * Step 3 (التعويضات) and Step 4 (الحساب) are optional nested objects, only
 * acted on when present.
 */
export class CreateEmployeeDto {
  // Step 1 — البيانات
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsOptional()
  mobile?: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsDateString()
  @IsOptional()
  hireDate?: string;

  // Step 2 — العمل
  @IsOptionalUuid()
  departmentId?: string;

  @IsOptionalUuid()
  jobTitleId?: string;

  @IsOptionalUuid()
  salesTeamId?: string;

  @IsOptionalUuid()
  managerEmployeeId?: string;

  // Step 3 — التعويضات (optional at creation — may be added later from the Profile's "الراتب" tab)
  @ValidateNested()
  @Type(() => RecordCompensationDto)
  @IsOptional()
  compensation?: RecordCompensationDto;

  // Step 4 — الحساب
  @IsBoolean()
  @IsOptional()
  createLoginAccount?: boolean;

  @ValidateNested()
  @Type(() => CreateEmployeeAccountDto)
  @IsOptional()
  account?: CreateEmployeeAccountDto;
}
