import { IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';
import { IsOptionalUuid } from '../../common/decorators/is-optional-uuid.decorator';

/** Same per-line shape the editor's grid already works with — stored as-is in `JournalEntryTemplate.lines` (JSON). */
export class JournalEntryTemplateLineDto {
  @IsUUID()
  accountId!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsOptionalUuid()
  costCenterId?: string;

  @IsOptionalUuid()
  projectId?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  debit?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  credit?: number;
}
