import { ArrayMaxSize, ArrayMinSize, IsArray, IsString } from 'class-validator';
import { IntersectionType } from '@nestjs/mapped-types';
import { RejectImportRowDto } from './reject-import-row.dto';

class RowIdsPart {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @IsString({ each: true })
  rowIds!: string[];
}

/** Bulk reject — the same single reason (required) applies to every selected row. */
export class BulkRejectImportRowsDto extends IntersectionType(
  RowIdsPart,
  RejectImportRowDto,
) {}
