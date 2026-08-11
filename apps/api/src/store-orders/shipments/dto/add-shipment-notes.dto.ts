import { IsNotEmpty, IsString } from 'class-validator';

export class AddShipmentNotesDto {
  @IsString()
  @IsNotEmpty()
  notes!: string;
}
