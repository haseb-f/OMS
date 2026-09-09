import { IsDateString, IsEnum, IsOptional } from 'class-validator';
import { EmployeeStatus } from '@prisma/client';
import { IsOptionalUuid } from '../../common/decorators/is-optional-uuid.decorator';

/**
 * EMPLOYEE-role configuration — sent alongside CreatePartnerDto/
 * UpdatePartnerDto when `roles` includes EMPLOYEE. HR Milestone 1 extends
 * this with the HR-specific fields (organization placement, manager
 * hierarchy, hire date, employment status); userId/jobTitleId predate it.
 * All fields stay optional here — an Employee Partner used only for
 * advances/expense reimbursement need not have a system login, department,
 * or team.
 */
export class EmployeeProfileInputDto {
  @IsOptionalUuid()
  userId?: string;

  @IsOptionalUuid()
  jobTitleId?: string;

  @IsOptionalUuid()
  departmentId?: string;

  @IsOptionalUuid()
  salesTeamId?: string;

  @IsOptionalUuid()
  managerEmployeeId?: string;

  @IsDateString()
  @IsOptional()
  hireDate?: string;

  @IsEnum(EmployeeStatus)
  @IsOptional()
  employmentStatus?: EmployeeStatus;
}
