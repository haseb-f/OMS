import { PartialType } from '@nestjs/mapped-types';
import { IsOptional, IsString } from 'class-validator';
import { CreateLeadDto } from './create-lead.dto';

export class UpdateLeadDto extends PartialType(CreateLeadDto) {
  /** Optional archive/lost reason — set via archive workflow, not direct status change. */
  @IsString()
  @IsOptional()
  archivedReason?: string;
}
