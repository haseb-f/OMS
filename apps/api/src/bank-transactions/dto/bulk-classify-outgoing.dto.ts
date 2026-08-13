import { ArrayMinSize, IsArray, IsUUID } from 'class-validator';
import { ClassifyOutgoingDto } from './classify-outgoing.dto';

export class BulkClassifyOutgoingDto extends ClassifyOutgoingDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  ids!: string[];
}
