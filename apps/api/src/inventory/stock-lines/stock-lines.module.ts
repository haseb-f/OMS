import { Module } from '@nestjs/common';
import { RecipesModule } from '../../recipes/recipes.module';
import { InventoryValuationModule } from '../../accounting/inventory-valuation/inventory-valuation.module';
import { StockLineResolver } from './stock-line-resolver';

/**
 * Stock-line resolution for documents that sell / return goods (kit expansion,
 * non-stock lines dropped). Import this module and inject `StockLineResolver`;
 * it depends only on recipes and valuation, never on a sales / agents module.
 */
@Module({
  imports: [RecipesModule, InventoryValuationModule],
  providers: [StockLineResolver],
  exports: [StockLineResolver],
})
export class StockLinesModule {}
