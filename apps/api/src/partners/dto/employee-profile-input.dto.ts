import { IsOptionalUuid } from '../../common/decorators/is-optional-uuid.decorator';

/** EMPLOYEE-role configuration only — sent alongside CreatePartnerDto/UpdatePartnerDto when `roles` includes EMPLOYEE. Both fields optional: an Employee Partner used only for advances need not have a system login or job title. */
export class EmployeeProfileInputDto {
  @IsOptionalUuid()
  userId?: string;

  @IsOptionalUuid()
  jobTitleId?: string;
}
