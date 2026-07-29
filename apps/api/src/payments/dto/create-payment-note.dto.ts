import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class CreatePaymentNoteDto {
  @IsUUID()
  userId!: string;

  @IsString()
  @IsNotEmpty()
  text!: string;
}
