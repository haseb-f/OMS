import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';
import { EmployeeStatus } from '@prisma/client';
import { IsOptionalUuid } from '../../common/decorators/is-optional-uuid.decorator';

/** Update path covers identity (Partner) + organization placement (EmployeeProfile) — never Compensation (its own effective-dated endpoint) or employeeCode (never editable). */
export class UpdateEmployeeDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  mobile?: string;

  @IsString()
  @IsOptional()
  email?: string;

  @IsDateString()
  @IsOptional()
  hireDate?: string;

  @IsEnum(EmployeeStatus)
  @IsOptional()
  employmentStatus?: EmployeeStatus;

  @IsOptionalUuid()
  departmentId?: string;

  @IsOptionalUuid()
  jobTitleId?: string;

  @IsOptionalUuid()
  salesTeamId?: string;

  @IsOptionalUuid()
  managerEmployeeId?: string;
}
