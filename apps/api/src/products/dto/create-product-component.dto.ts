import { IsNumber, IsPositive, IsUUID } from 'class-validator';

/** One BOM line — "this many of that component, per one unit of the Kit." */
export class CreateProductComponentDto {
  @IsUUID()
  componentProductId!: string;

  @IsNumber()
  @IsPositive()
  quantity!: number;
}
