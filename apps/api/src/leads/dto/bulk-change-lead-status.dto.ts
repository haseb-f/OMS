import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class BulkChangeLeadStatusDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5000)
  @IsUUID('4', { each: true })
  leadIds!: string[];

  @IsString()
  statusCode!: string;

  @IsString()
  @IsOptional()
  reason?: string;
}
