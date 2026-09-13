import { IsInt, IsNumber, IsUUID, Min } from 'class-validator';

/** Funded Product terms within an Opportunity (Phase 6) — `fundedUnitCost` is the Opportunity's own agreed cost, never read from Product.salesPrice/purchasePrice. */
export class OpportunityProductInputDto {
  @IsUUID()
  productId!: string;

  @IsInt()
  @Min(1)
  fundedUnits!: number;

  @IsNumber()
  @Min(0.01)
  fundedUnitCost!: number;
}
