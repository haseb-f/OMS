import { IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateLeadAssignmentDto {
  @IsUUID()
  salesEmployeeId!: string;

  @IsString()
  @IsOptional()
  reason?: string;
}
