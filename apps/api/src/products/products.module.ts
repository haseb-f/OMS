import { Module } from '@nestjs/common';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { ProductInsightsService } from './product-insights.service';
import { ProductActivitiesController } from './activities/product-activities.controller';
import { ProductActivityService } from './activities/product-activity.service';
import { ProductAttachmentsController } from './attachments/product-attachments.controller';
import { ProductAttachmentsService } from './attachments/product-attachments.service';
import { ProductVariantsController } from './variants/product-variants.controller';
import { ProductVariantsService } from './variants/product-variants.service';
import { NumberingModule } from '../numbering/numbering.module';
import { PermissionsCoreModule } from '../permissions/permissions-core.module';
import { AccountMappingModule } from '../accounting/account-mapping/account-mapping.module';
import { AgentCommissionModule } from '../agents/commission/agent-commission.module';

@Module({
  imports: [
    NumberingModule,
    PermissionsCoreModule,
    AccountMappingModule,
    AgentCommissionModule,
  ],
  controllers: [
    ProductsController,
    ProductActivitiesController,
    ProductAttachmentsController,
    ProductVariantsController,
  ],
  providers: [
    ProductsService,
    ProductInsightsService,
    ProductActivityService,
    ProductAttachmentsService,
    ProductVariantsService,
  ],
  exports: [ProductsService, ProductActivityService],
})
export class ProductsModule {}
