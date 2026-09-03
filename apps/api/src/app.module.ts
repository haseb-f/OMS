import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { JobTitlesModule } from './job-titles/job-titles.module';
import { PermissionsModule } from './permissions/permissions.module';
import { PermissionsCoreModule } from './permissions/permissions-core.module';
import { PhoneModule } from './common/phone/phone.module';
import { ObjectStorageModule } from './common/storage/object-storage.module';
import { CurrenciesModule } from './currencies/currencies.module';
import { CountriesModule } from './countries/countries.module';
import { ProjectsModule } from './projects/projects.module';
import { CostCentersModule } from './cost-centers/cost-centers.module';
import { ExpensesModule } from './expenses/expenses.module';
import { FixedAssetsModule } from './fixed-assets/fixed-assets.module';
import { PaymentMethodsModule } from './payment-methods/payment-methods.module';
import { PaymentTermsModule } from './payment-terms/payment-terms.module';
import { DepartmentsModule } from './departments/departments.module';
import { SalesTeamsModule } from './sales-teams/sales-teams.module';
import { SalesScopeModule } from './sales-scope/sales-scope.module';
import { SalesPerformanceModule } from './sales-performance/sales-performance.module';
import { ShippingMethodsModule } from './shipping-methods/shipping-methods.module';
import { ProductCategoriesModule } from './product-categories/product-categories.module';
import { ProductBrandsModule } from './product-brands/product-brands.module';
import { WarehousesModule } from './warehouses/warehouses.module';
import { WarehouseLocationsModule } from './warehouse-locations/warehouse-locations.module';
import { UnitConversionsModule } from './unit-conversions/unit-conversions.module';
import { LeadsModule } from './leads/leads.module';
import { ShippingCompaniesModule } from './shipping-companies/shipping-companies.module';
import { ShippingStatusesModule } from './shipping-statuses/shipping-statuses.module';
import { StatusDefinitionsModule } from './status-definitions/status-definitions.module';
import { WorkflowModule } from './workflow/workflow.module';
import { TransactionTypesModule } from './transaction-types/transaction-types.module';
import { SalesOrdersModule } from './sales-orders/sales-orders.module';
import { PaymentSourcesModule } from './payment-sources/payment-sources.module';
import { PaymentsModule } from './payments/payments.module';
import { ChartOfAccountsModule } from './chart-of-accounts/chart-of-accounts.module';
import { ReceivingAccountsModule } from './receiving-accounts/receiving-accounts.module';
import { UnitsModule } from './units/units.module';
import { ProductsModule } from './products/products.module';
import { InventoryModule } from './inventory/inventory.module';
import { PhysicalCountModule } from './physical-count/physical-count.module';
import { CostComponentsModule } from './cost-components/cost-components.module';
import { ProductCostModule } from './product-cost/product-cost.module';
import { PartnersModule } from './partners/partners.module';
import { PurchaseOrdersModule } from './purchase-orders/purchase-orders.module';
import { TaxesModule } from './taxes/taxes.module';
import { CustomerGroupsModule } from './customer-groups/customer-groups.module';
import { SupplierGroupsModule } from './supplier-groups/supplier-groups.module';
import { CitiesModule } from './cities/cities.module';
import { LanguagesModule } from './languages/languages.module';
import { NumberingModule } from './numbering/numbering.module';
import { AnalyticPlansModule } from './analytic-plans/analytic-plans.module';
import { AnalyticAccountsModule } from './analytic-accounts/analytic-accounts.module';
import { AnalyticDistributionsModule } from './analytic-distributions/analytic-distributions.module';
import { SalesQuotationsModule } from './sales/quotations/sales-quotations.module';
import { SalesOrdersModule as SalesOrderDocumentsModule } from './sales/orders/sales-orders.module';
import { SalesInvoicesModule } from './sales/invoices/sales-invoices.module';
import { SalesReturnsModule } from './sales/returns/sales-returns.module';
import { PurchaseQuotationsModule } from './purchasing/quotations/purchase-quotations.module';
import { PurchaseInvoicesModule } from './purchasing/invoices/purchase-invoices.module';
import { PurchaseReturnsModule } from './purchasing/returns/purchase-returns.module';
import { FinancialTransactionsModule } from './financial-transactions/financial-transactions.module';
import { JournalEntriesModule } from './journal-entries/journal-entries.module';
import { PostingProvidersModule } from './accounting/posting-providers/posting-providers.module';
import { PostingSettingsModule } from './accounting/posting-settings/posting-settings.module';
import { AccountingReportsModule } from './accounting/reports/accounting-reports.module';
import { FiscalPeriodsModule } from './accounting/fiscal-periods/fiscal-periods.module';
import { JournalsModule } from './journals/journals.module';
import { OpeningBalancesModule } from './accounting/opening-balances/opening-balances.module';
import { YearClosingModule } from './accounting/year-closing/year-closing.module';
import { ImportCenterModule } from './import-center/import-center.module';
import { BankTransactionsModule } from './bank-transactions/bank-transactions.module';
import { StoreOrdersModule } from './store-orders/store-orders.module';

@Module({
  imports: [
    PrismaModule,
    PermissionsCoreModule,
    SalesScopeModule,
    PhoneModule,
    ObjectStorageModule,
    AuthModule,
    UsersModule,
    JobTitlesModule,
    PermissionsModule,
    CurrenciesModule,
    CountriesModule,
    ProjectsModule,
    CostCentersModule,
    ExpensesModule,
    FixedAssetsModule,
    PaymentMethodsModule,
    ShippingMethodsModule,
    ProductCategoriesModule,
    ProductBrandsModule,
    WarehousesModule,
    WarehouseLocationsModule,
    UnitConversionsModule,
    LeadsModule,
    ShippingCompaniesModule,
    ShippingStatusesModule,
    StatusDefinitionsModule,
    WorkflowModule,
    TransactionTypesModule,
    SalesOrdersModule,
    ChartOfAccountsModule,
    ReceivingAccountsModule,
    PaymentSourcesModule,
    PaymentTermsModule,
    DepartmentsModule,
    SalesTeamsModule,
    PaymentsModule,
    UnitsModule,
    ProductsModule,
    InventoryModule,
    PhysicalCountModule,
    CostComponentsModule,
    ProductCostModule,
    PartnersModule,
    PurchaseOrdersModule,
    TaxesModule,
    CustomerGroupsModule,
    SupplierGroupsModule,
    CitiesModule,
    LanguagesModule,
    NumberingModule,
    AnalyticPlansModule,
    AnalyticAccountsModule,
    AnalyticDistributionsModule,
    SalesQuotationsModule,
    SalesOrderDocumentsModule,
    SalesInvoicesModule,
    SalesReturnsModule,
    PurchaseQuotationsModule,
    PurchaseInvoicesModule,
    PurchaseReturnsModule,
    FinancialTransactionsModule,
    JournalEntriesModule,
    PostingProvidersModule,
    PostingSettingsModule,
    AccountingReportsModule,
    FiscalPeriodsModule,
    JournalsModule,
    OpeningBalancesModule,
    YearClosingModule,
    ImportCenterModule,
    BankTransactionsModule,
    StoreOrdersModule,
    SalesPerformanceModule,
  ],
  controllers: [HealthController],
  providers: [],
})
export class AppModule {}
