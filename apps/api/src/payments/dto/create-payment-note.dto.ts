import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';
import { trimString } from '../../common/transforms/empty-to-undefined';

export class CreatePaymentNoteDto {
  /** Optional when the controller fills it from the authenticated user. */
  @IsUUID()
  @IsOptional()
  userId?: string;

  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  text!: string;
}
