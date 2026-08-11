import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

/** No real file-upload pipeline exists anywhere in this app — a label is a pasted URL string, same convention as every other attachment. */
export class SetLabelDto {
  @IsString()
  @IsNotEmpty()
  fileUrl!: string;

  @IsString()
  @IsOptional()
  fileName?: string;
}
