import { IsNotEmpty, IsString } from 'class-validator';

export class CreateImportJobDto {
  @IsString()
  @IsNotEmpty()
  importType!: string;
}
