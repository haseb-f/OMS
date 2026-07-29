import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class CreateSalesOrderNoteDto {
  @IsUUID()
  userId!: string;

  @IsString()
  @IsNotEmpty()
  text!: string;
}
