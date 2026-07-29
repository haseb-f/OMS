import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { UsersModule } from './users/users.module';
import { RolesModule } from './roles/roles.module';
import { PermissionsModule } from './permissions/permissions.module';
import { CurrenciesModule } from './currencies/currencies.module';
import { CountriesModule } from './countries/countries.module';
import { ProjectsModule } from './projects/projects.module';
import { CostCentersModule } from './cost-centers/cost-centers.module';
import { PaymentMethodsModule } from './payment-methods/payment-methods.module';
import { ShippingMethodsModule } from './shipping-methods/shipping-methods.module';
import { ProductCategoriesModule } from './product-categories/product-categories.module';
import { ProductBrandsModule } from './product-brands/product-brands.module';
import { WarehousesModule } from './warehouses/warehouses.module';
import { LeadsModule } from './leads/leads.module';
import { ShippingCompaniesModule } from './shipping-companies/shipping-companies.module';
import { SalesOrdersModule } from './sales-orders/sales-orders.module';
import { PaymentSourcesModule } from './payment-sources/payment-sources.module';
import { PaymentsModule } from './payments/payments.module';
import { ChartOfAccountsModule } from './chart-of-accounts/chart-of-accounts.module';
import { ReceivingAccountsModule } from './receiving-accounts/receiving-accounts.module';

@Module({
  imports: [
    PrismaModule,
    UsersModule,
    RolesModule,
    PermissionsModule,
    CurrenciesModule,
    CountriesModule,
    ProjectsModule,
    CostCentersModule,
    PaymentMethodsModule,
    ShippingMethodsModule,
    ProductCategoriesModule,
    ProductBrandsModule,
    WarehousesModule,
    LeadsModule,
    ShippingCompaniesModule,
    SalesOrdersModule,
    ChartOfAccountsModule,
    ReceivingAccountsModule,
    PaymentSourcesModule,
    PaymentsModule,
  ],
  controllers: [HealthController],
  providers: [],
})
export class AppModule {}
