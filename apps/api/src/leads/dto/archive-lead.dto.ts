import { IsOptional, IsString } from 'class-validator';

export class ArchiveLeadDto {
  /** Optional, per the business rule — no restriction on its content. */
  @IsString()
  @IsOptional()
  archiveReason?: string;
}
