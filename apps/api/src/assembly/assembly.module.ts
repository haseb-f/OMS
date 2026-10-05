import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { InventoryValuationModule } from '../accounting/inventory-valuation/inventory-valuation.module';
import { PostingEngineModule } from '../accounting/posting-engine/posting-engine.module';
import { NumberingModule } from '../numbering/numbering.module';
import { ProductsModule } from '../products/products.module';
import { RecipesModule } from '../recipes/recipes.module';
import { AssemblyController } from './assembly.controller';
import { AssemblyService } from './assembly.service';
import { AssemblyCostService } from './assembly-cost.service';

/**
 * Assembly orders (R13). The ASSEMBLY_ORDER posting provider lives with the
 * other providers in `PostingProvidersModule` (imported once from `AppModule`),
 * exactly like every other document type — this module only asks the Posting
 * Engine to post / reverse.
 */
@Module({
  imports: [
    InventoryModule,
    InventoryValuationModule,
    PostingEngineModule,
    NumberingModule,
    ProductsModule,
    RecipesModule,
  ],
  controllers: [AssemblyController],
  providers: [AssemblyService, AssemblyCostService],
})
export class AssemblyModule {}
