import { IsEnum, IsOptional, Matches } from 'class-validator';
import { CommissionStatus } from '@prisma/client';
import { IsOptionalUuid } from '../../common/decorators/is-optional-uuid.decorator';
import { MasterDataQueryDto } from '../../master-data/dto/master-data-query.dto';

/** Adds page/pageSize/sortBy/sortOrder — this list was previously unbounded. */
export class CommissionsQueryDto extends MasterDataQueryDto {
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'period must be YYYY-MM' })
  @IsOptional()
  period?: string;

  @IsEnum(CommissionStatus)
  @IsOptional()
  status?: CommissionStatus;

  @IsOptionalUuid()
  employeeProfileId?: string;

  @IsOptionalUuid()
  departmentId?: string;
}
