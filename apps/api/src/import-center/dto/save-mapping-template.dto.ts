import { IsNotEmpty, IsObject, IsString } from 'class-validator';

export class SaveMappingTemplateDto {
  @IsString()
  @IsNotEmpty()
  importType!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsObject()
  columnMapping!: Record<string, string>;
}
