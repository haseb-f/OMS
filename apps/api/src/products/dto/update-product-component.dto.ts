import { IsNumber, IsPositive } from 'class-validator';

/** Only the quantity is editable — swapping the component itself means deleting and re-adding the line. */
export class UpdateProductComponentDto {
  @IsNumber()
  @IsPositive()
  quantity!: number;
}
