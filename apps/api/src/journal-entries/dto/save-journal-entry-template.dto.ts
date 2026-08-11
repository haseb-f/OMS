import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { JournalEntryTemplateLineDto } from './journal-entry-template-line.dto';
import { IsOptionalUuid } from '../../common/decorators/is-optional-uuid.decorator';

export class SaveJournalEntryTemplateDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsOptionalUuid()
  journalId?: string;

  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => JournalEntryTemplateLineDto)
  lines!: JournalEntryTemplateLineDto[];
}
