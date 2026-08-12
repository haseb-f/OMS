import {
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

export class PushReferenceDataDto {
  /** Any Google Sheets share/edit URL — same format the sync sources and manual "Upload from Google Sheets" already accept. */
  @IsString()
  @IsNotEmpty()
  spreadsheetUrl!: string;

  /** Defaults to "Reference Data" — override only if a spreadsheet already uses that tab name for something else. */
  @IsOptional()
  @IsString()
  worksheetName?: string;

  /** Reference type codes to push (e.g. `["COUNTRY","CURRENCY","PRODUCT"]`) — see `GET /import-center/reference-data` for the full registered list. */
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  types!: string[];
}
