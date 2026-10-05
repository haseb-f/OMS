import { Module } from '@nestjs/common';
import { UnitsModule } from '../units/units.module';
import { ProductsModule } from '../products/products.module';
import { ProductRecipesController } from './product-recipes.controller';
import { RecipesController } from './recipes.controller';
import { RecipeService } from './recipe.service';
import { RecipeManagementService } from './recipe-management.service';
import { RecipeInsightsService } from './recipe-insights.service';

/**
 * Versioned recipes (bill of materials) for ASSEMBLED and KIT products (R13).
 * `RecipeService` is the API the stock-facing modules use (assembly, kit-line
 * resolution): the ACTIVE recipe and a recipe's lines in the components' stock
 * units. Permissions come from the global `PermissionsCoreModule`.
 */
@Module({
  imports: [UnitsModule, ProductsModule],
  controllers: [ProductRecipesController, RecipesController],
  providers: [RecipeService, RecipeManagementService, RecipeInsightsService],
  exports: [RecipeService],
})
export class RecipesModule {}
