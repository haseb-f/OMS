import { IsNotEmpty, IsString } from 'class-validator';

export class UploadGoogleSheetsDto {
  @IsString()
  @IsNotEmpty()
  url!: string;
}
