import { IsObject } from 'class-validator';

/** `{ [fieldKey]: sourceColumnHeader }` — one entry per Import Type field the user mapped to a column in the uploaded file. */
export class SetMappingDto {
  @IsObject()
  columnMapping!: Record<string, string>;
}
