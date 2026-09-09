import { IsEnum } from 'class-validator';
import { KpiAssignmentScope } from '@prisma/client';
import { IsOptionalUuid } from '../../common/decorators/is-optional-uuid.decorator';

/** Part J — assign by Job Title, Department, or a specific Employee override. Exactly one of jobTitleId/departmentId/employeeProfileId must match `scope` — enforced in the service. */
export class AssignKpiTemplateDto {
  @IsEnum(KpiAssignmentScope)
  scope!: KpiAssignmentScope;

  @IsOptionalUuid()
  jobTitleId?: string;

  @IsOptionalUuid()
  departmentId?: string;

  @IsOptionalUuid()
  employeeProfileId?: string;
}
