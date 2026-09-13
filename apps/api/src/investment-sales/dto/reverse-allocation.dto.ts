import { IsString, MinLength } from 'class-validator';

export class ReverseAllocationDto {
  @IsString()
  @MinLength(3)
  reason!: string;
}
