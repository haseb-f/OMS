import { IsEnum } from 'class-validator';
import { CommissionAssignmentScope } from '@prisma/client';
import { IsOptionalUuid } from '../../common/decorators/is-optional-uuid.decorator';

/** Part U — Employee-specific > Team-specific > Department-specific > Company default. Exactly one target field must match `scope` (COMPANY needs none). */
export class AssignCommissionPlanDto {
  @IsEnum(CommissionAssignmentScope)
  scope!: CommissionAssignmentScope;

  @IsOptionalUuid()
  employeeProfileId?: string;

  @IsOptionalUuid()
  salesTeamId?: string;

  @IsOptionalUuid()
  departmentId?: string;
}
