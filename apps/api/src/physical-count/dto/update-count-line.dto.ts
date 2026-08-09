import { IsInt, Min } from 'class-validator';

export class UpdateCountLineDto {
  @IsInt()
  @Min(0)
  countedQuantity!: number;
}
