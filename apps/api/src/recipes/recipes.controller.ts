import {
  Body,
  Controller,
  Delete,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PermissionModule } from '../auth/decorators/permission-module.decorator';
import { PermissionAction } from '../auth/decorators/permission-action.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UpdateRecipeDto } from './dto/recipe.dto';
import { PermissionsResolverService } from '../permissions/permissions-resolver.service';
import { canViewAssemblyCost } from '../inventory/inventory-cost-access';
import {
  RecipeManagementService,
  withRecipeCostRule,
} from './recipe-management.service';

/** Recipe version lifecycle — every route needs `products.recipes.manage`. */
@Controller('recipes')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('product-recipes')
export class RecipesController {
  constructor(
    private readonly management: RecipeManagementService,
    private readonly permissions: PermissionsResolverService,
  ) {}

  /** The direct-cost estimate is withheld without assembly-cost visibility. */
  private async view<T extends Parameters<typeof withRecipeCostRule>[0]>(
    user: JwtPayload,
    result: Promise<T>,
  ): Promise<T> {
    const [views, includeCosts] = await Promise.all([
      result,
      canViewAssemblyCost(this.permissions, user.sub),
    ]);
    return withRecipeCostRule(views, includeCosts);
  }

  @Patch(':id')
  @PermissionAction('manage')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRecipeDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.view(user, this.management.update(id, dto, user.sub));
  }

  @Delete(':id')
  @PermissionAction('manage')
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.management.remove(id, user.sub);
  }

  @Post(':id/activate')
  @PermissionAction('manage')
  activate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.view(user, this.management.activate(id, user.sub));
  }

  @Post(':id/retire')
  @PermissionAction('manage')
  retire(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.view(user, this.management.retire(id, user.sub));
  }
}
