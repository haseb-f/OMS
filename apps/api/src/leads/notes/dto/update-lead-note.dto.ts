import { IsNotEmpty, IsString } from 'class-validator';

export class UpdateLeadNoteDto {
  @IsString()
  @IsNotEmpty()
  text!: string;
}
