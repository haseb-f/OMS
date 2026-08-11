import { ArrayMinSize, IsArray, IsUUID } from 'class-validator';
import { IsOptionalUuid } from '../../common/decorators/is-optional-uuid.decorator';

export class BulkAssignLeadsDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  leadIds!: string[];

  /** Omit to balance-distribute across eligible Customer Service employees instead of assigning everyone to one person. */
  @IsOptionalUuid()
  salesEmployeeId?: string;
}
