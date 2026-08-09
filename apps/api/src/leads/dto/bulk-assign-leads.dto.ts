import { ArrayMinSize, IsArray, IsOptional, IsUUID } from 'class-validator';

export class BulkAssignLeadsDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  leadIds!: string[];

  /** Omit to balance-distribute across eligible Customer Service employees instead of assigning everyone to one person. */
  @IsUUID()
  @IsOptional()
  salesEmployeeId?: string;
}
