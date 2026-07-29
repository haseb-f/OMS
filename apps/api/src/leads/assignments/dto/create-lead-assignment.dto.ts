import { IsUUID } from 'class-validator';

export class CreateLeadAssignmentDto {
  @IsUUID()
  salesEmployeeId!: string;
}
