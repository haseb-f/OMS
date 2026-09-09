import { IsEnum, IsOptional } from 'class-validator';
import { EmployeeStatus } from '@prisma/client';
import { MasterDataQueryDto } from '../../master-data/dto/master-data-query.dto';
import { IsOptionalUuid } from '../../common/decorators/is-optional-uuid.decorator';

export class EmployeesQueryDto extends MasterDataQueryDto {
  @IsOptionalUuid()
  departmentId?: string;

  @IsEnum(EmployeeStatus)
  @IsOptional()
  employmentStatus?: EmployeeStatus;
}
