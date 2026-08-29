import { IsEnum, IsOptional } from 'class-validator';
import { WorkflowType } from '@prisma/client';
import { MasterDataQueryDto } from '../../master-data/dto/master-data-query.dto';

export class FindStatusDefinitionsQueryDto extends MasterDataQueryDto {
  @IsEnum(WorkflowType)
  @IsOptional()
  workflowType?: WorkflowType;
}
