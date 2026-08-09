import { Module } from '@nestjs/common';
import { ImportTypeRegistryService } from './import-type-registry.service';
import { ImportJobsService } from './import-jobs.service';
import { ImportJobsController } from './import-jobs.controller';
import { ImportTypesController } from './import-types.controller';
import { ImportMappingTemplatesService } from './import-mapping-templates.service';
import { ImportTemplateService } from './import-template.service';
import { CustomersImportHandler } from './handlers/customers-import.handler';
import { SuppliersImportHandler } from './handlers/suppliers-import.handler';
import { ProductsImportHandler } from './handlers/products-import.handler';
import { InventoryAdjustmentsImportHandler } from './handlers/inventory-adjustments-import.handler';
import { WarehousesImportHandler } from './handlers/warehouses-import.handler';
import { ChartOfAccountsImportHandler } from './handlers/chart-of-accounts-import.handler';
import { TaxRatesImportHandler } from './handlers/tax-rates-import.handler';
import { CostCentersImportHandler } from './handlers/cost-centers-import.handler';
import { ProjectsImportHandler } from './handlers/projects-import.handler';
import { LeadsImportHandler } from './handlers/leads-import.handler';
import { OpeningStockImportHandler } from './handlers/opening-stock-import.handler';
import { SalesQuotationsImportHandler } from './handlers/sales-quotations-import.handler';
import { SalesOrdersImportHandler } from './handlers/sales-orders-import.handler';
import { SalesInvoicesImportHandler } from './handlers/sales-invoices-import.handler';
import { SalesReturnsImportHandler } from './handlers/sales-returns-import.handler';
import { PurchaseQuotationsImportHandler } from './handlers/purchase-quotations-import.handler';
import { PurchaseOrdersImportHandler } from './handlers/purchase-orders-import.handler';
import { PurchaseInvoicesImportHandler } from './handlers/purchase-invoices-import.handler';
import { PurchaseReturnsImportHandler } from './handlers/purchase-returns-import.handler';
import {
  CustomerReceiptsImportHandler,
  SupplierPaymentsImportHandler,
} from './handlers/financial-transactions-import.handler';
import { JournalEntriesImportHandler } from './handlers/journal-entries-import.handler';
import { OpeningBalancesImportHandler } from './handlers/opening-balances-import.handler';
import { CustomersModule } from '../customers/customers.module';
import { SuppliersModule } from '../suppliers/suppliers.module';
import { ProductsModule } from '../products/products.module';
import { ProductCategoriesModule } from '../product-categories/product-categories.module';
import { UnitsModule } from '../units/units.module';
import { InventoryModule } from '../inventory/inventory.module';
import { WarehousesModule } from '../warehouses/warehouses.module';
import { ChartOfAccountsModule } from '../chart-of-accounts/chart-of-accounts.module';
import { CurrenciesModule } from '../currencies/currencies.module';
import { TaxesModule } from '../taxes/taxes.module';
import { CostCentersModule } from '../cost-centers/cost-centers.module';
import { ProjectsModule } from '../projects/projects.module';
import { LeadsModule } from '../leads/leads.module';
import { CountriesModule } from '../countries/countries.module';
import { UsersModule } from '../users/users.module';
import { JournalsModule } from '../journals/journals.module';
import { SalesQuotationsModule } from '../sales/quotations/sales-quotations.module';
import { SalesOrdersModule as SalesOrderDocumentsModule } from '../sales/orders/sales-orders.module';
import { SalesInvoicesModule } from '../sales/invoices/sales-invoices.module';
import { SalesReturnsModule } from '../sales/returns/sales-returns.module';
import { PurchaseQuotationsModule } from '../purchasing/quotations/purchase-quotations.module';
import { PurchaseOrdersModule } from '../purchase-orders/purchase-orders.module';
import { PurchaseInvoicesModule } from '../purchasing/invoices/purchase-invoices.module';
import { PurchaseReturnsModule } from '../purchasing/returns/purchase-returns.module';
import { FinancialTransactionsModule } from '../financial-transactions/financial-transactions.module';
import { JournalEntriesModule } from '../journal-entries/journal-entries.module';
import { OpeningBalancesModule } from '../accounting/opening-balances/opening-balances.module';

/**
 * Import Center (TASK-056/TASK-059 "Universal Import Center") — deliberately
 * imports the same business modules a manual UI action would use (Customers,
 * Suppliers, Products, Inventory, Warehouses, Chart of Accounts, Taxes, Cost
 * Centers, Projects, Leads, and — as of TASK-059 — every Sales/Purchase
 * document, Financial Transactions, Journal Entries, and Opening Balances)
 * so every Import Type Handler calls the real `*Service.create()`/
 * `.adjustment()` method, never a parallel write path. See
 * `import-type.interface.ts` for the plug-in contract; document-shaped
 * handlers additionally implement `importGroup()` (grouped-rows execution
 * mode, see `ImportTypeHandler.groupKey`).
 */
@Module({
  imports: [
    CustomersModule,
    SuppliersModule,
    ProductsModule,
    ProductCategoriesModule,
    UnitsModule,
    InventoryModule,
    WarehousesModule,
    ChartOfAccountsModule,
    CurrenciesModule,
    TaxesModule,
    CostCentersModule,
    ProjectsModule,
    LeadsModule,
    CountriesModule,
    UsersModule,
    JournalsModule,
    SalesQuotationsModule,
    SalesOrderDocumentsModule,
    SalesInvoicesModule,
    SalesReturnsModule,
    PurchaseQuotationsModule,
    PurchaseOrdersModule,
    PurchaseInvoicesModule,
    PurchaseReturnsModule,
    FinancialTransactionsModule,
    JournalEntriesModule,
    OpeningBalancesModule,
  ],
  controllers: [ImportJobsController, ImportTypesController],
  providers: [
    ImportTypeRegistryService,
    ImportJobsService,
    ImportMappingTemplatesService,
    ImportTemplateService,
    CustomersImportHandler,
    SuppliersImportHandler,
    ProductsImportHandler,
    InventoryAdjustmentsImportHandler,
    WarehousesImportHandler,
    ChartOfAccountsImportHandler,
    TaxRatesImportHandler,
    CostCentersImportHandler,
    ProjectsImportHandler,
    LeadsImportHandler,
    OpeningStockImportHandler,
    SalesQuotationsImportHandler,
    SalesOrdersImportHandler,
    SalesInvoicesImportHandler,
    SalesReturnsImportHandler,
    PurchaseQuotationsImportHandler,
    PurchaseOrdersImportHandler,
    PurchaseInvoicesImportHandler,
    PurchaseReturnsImportHandler,
    CustomerReceiptsImportHandler,
    SupplierPaymentsImportHandler,
    JournalEntriesImportHandler,
    OpeningBalancesImportHandler,
  ],
})
export class ImportCenterModule {}
