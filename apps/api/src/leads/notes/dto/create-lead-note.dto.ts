import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class CreateLeadNoteDto {
  @IsUUID()
  userId!: string;

  @IsString()
  @IsNotEmpty()
  text!: string;
}
