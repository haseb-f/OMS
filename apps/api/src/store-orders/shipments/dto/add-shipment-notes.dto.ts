import { IsNotEmpty, IsString, ValidateIf } from 'class-validator';
import { Transform } from 'class-transformer';
import { trimString } from '../../../common/transforms/empty-to-undefined';

export class AddShipmentNotesDto {
  @Transform(trimString)
  @ValidateIf((dto: AddShipmentNotesDto) => dto.note === undefined)
  @IsString()
  @IsNotEmpty()
  notes?: string;

  @Transform(trimString)
  @ValidateIf((dto: AddShipmentNotesDto) => dto.notes === undefined)
  @IsString()
  @IsNotEmpty()
  note?: string;
}

export function resolveShipmentNotes(dto: AddShipmentNotesDto): string {
  return (dto.notes ?? dto.note ?? '').trim();
}
