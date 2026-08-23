import { IsNotEmpty, IsString, ValidateIf } from 'class-validator';
import { Transform } from 'class-transformer';
import { trimString } from '../../common/transforms/empty-to-undefined';

/** There is no dedicated StoreOrderNote table — a note is an activity entry. */
export class CreateStoreOrderNoteDto {
  @Transform(trimString)
  @ValidateIf((dto: CreateStoreOrderNoteDto) => dto.note === undefined)
  @IsString()
  @IsNotEmpty()
  text?: string;

  /** Legacy alias — older clients posted `{ note }` instead of `{ text }`. */
  @Transform(trimString)
  @ValidateIf((dto: CreateStoreOrderNoteDto) => dto.text === undefined)
  @IsString()
  @IsNotEmpty()
  note?: string;
}

export function resolveStoreOrderNoteText(
  dto: CreateStoreOrderNoteDto,
): string {
  return (dto.text ?? dto.note ?? '').trim();
}
