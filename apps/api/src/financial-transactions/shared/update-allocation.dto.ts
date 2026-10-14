import { IsNumber, IsPositive } from 'class-validator';

/** R22 contract 3 — the new amount of one line of a posted receipt / payment (atomic change). */
export class UpdateAllocationDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  allocatedAmount!: number;
}
