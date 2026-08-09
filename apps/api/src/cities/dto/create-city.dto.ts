import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class CreateCityDto {
  @IsUUID()
  @IsNotEmpty()
  countryId!: string;

  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;
}
