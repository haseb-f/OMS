import { Injectable, OnModuleInit } from '@nestjs/common';
import { CustomerStatus, ProductStatus, SupplierStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ReferenceDataRegistryService } from './reference-data-registry.service';
import { ALLOWED_STATUSES as SHIPPING_ALLOWED_STATUSES } from '../handlers/shipping-updates-import.handler';
import type {
  ReferenceDataSource,
  ReferenceRecord,
} from './reference-data.types';

/**
 * Registers one `ReferenceDataSource` per Master Data entity the import
 * layer needs to be aware of (spec: "Do NOT hardcode this list... inspect
 * the actual Prisma models... build a reusable mechanism" — this file IS
 * that inspection's result, kept in one place so adding a new entity is a
 * single small block, never a change scattered across handlers).
 *
 * Deliberately queries `PrismaService` directly rather than reusing each
 * entity's own paginated list-endpoint service (`CountriesService`,
 * `ProductsService`, ...): those exist for a UI list page (joins,
 * relations, a `pageSize` DTO capped at 200-1000) and returning a
 * complete reference list needs neither — a `select` of just
 * id/code/name/active-flag, unpaginated, is both simpler and cheaper.
 * Business RULES (what counts as "active", `deletedAt` scoping) are still
 * copied faithfully from each entity's real Prisma model, never
 * reinvented.
 */
@Injectable()
export class ReferenceDataSourcesService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ReferenceDataRegistryService,
  ) {}

  onModuleInit() {
    for (const source of this.buildSources()) {
      this.registry.register(source);
    }
  }

  private buildSources(): ReferenceDataSource[] {
    const prisma = this.prisma;
    return [
      {
        type: 'COUNTRY',
        label: 'Country',
        defaultMatchField: 'name',
        list: async () =>
          (
            await prisma.country.findMany({
              where: { deletedAt: null },
              select: { id: true, code: true, name: true, isActive: true },
            })
          ).map((r) => ({
            id: r.id,
            code: r.code,
            name: r.name,
            active: r.isActive,
          })),
      },
      {
        type: 'CURRENCY',
        label: 'Currency',
        defaultMatchField: 'code',
        list: async () =>
          (
            await prisma.currency.findMany({
              where: { deletedAt: null },
              select: { id: true, code: true, name: true },
            })
          ).map((r) => ({
            id: r.id,
            code: r.code,
            name: r.name,
            active: true,
          })),
      },
      {
        type: 'PRODUCT',
        label: 'Product',
        defaultMatchField: 'code',
        list: async () =>
          (
            await prisma.product.findMany({
              where: { deletedAt: null },
              select: { id: true, sku: true, displayName: true, status: true },
            })
          ).map((r) => ({
            id: r.id,
            code: r.sku,
            name: r.displayName,
            active: r.status === ProductStatus.ACTIVE,
          })),
      },
      {
        type: 'CUSTOMER',
        label: 'Customer',
        defaultMatchField: 'name',
        list: async () =>
          (
            await prisma.customer.findMany({
              where: { deletedAt: null },
              select: {
                id: true,
                customerNumber: true,
                name: true,
                status: true,
              },
            })
          ).map((r) => ({
            id: r.id,
            code: r.customerNumber,
            name: r.name,
            active: r.status === CustomerStatus.ACTIVE,
          })),
      },
      {
        type: 'SUPPLIER',
        label: 'Supplier',
        defaultMatchField: 'name',
        list: async () =>
          (
            await prisma.supplier.findMany({
              where: { deletedAt: null },
              select: {
                id: true,
                supplierNumber: true,
                name: true,
                status: true,
              },
            })
          ).map((r) => ({
            id: r.id,
            code: r.supplierNumber,
            name: r.name,
            active: r.status === SupplierStatus.ACTIVE,
          })),
      },
      {
        type: 'PAYMENT_METHOD',
        label: 'Payment Method',
        defaultMatchField: 'name',
        list: async () =>
          (
            await prisma.paymentMethod.findMany({
              where: { deletedAt: null },
              select: { id: true, name: true },
            })
          ).map((r) => ({ id: r.id, code: null, name: r.name, active: true })),
      },
      {
        type: 'WAREHOUSE',
        label: 'Warehouse',
        defaultMatchField: 'code',
        list: async () =>
          (
            await prisma.warehouse.findMany({
              where: { deletedAt: null },
              select: { id: true, code: true, name: true, isActive: true },
            })
          ).map((r) => ({
            id: r.id,
            code: r.code,
            name: r.name,
            active: r.isActive,
          })),
      },
      {
        type: 'EMPLOYEE',
        label: 'Employee',
        defaultMatchField: 'name',
        list: async () =>
          (
            await prisma.user.findMany({
              where: { deletedAt: null },
              select: { id: true, email: true, fullName: true, isActive: true },
            })
          ).map((r) => ({
            id: r.id,
            code: r.email,
            name: r.fullName,
            active: r.isActive,
          })),
      },
      {
        type: 'SHIPPING_COMPANY',
        label: 'Shipping Company',
        defaultMatchField: 'name',
        list: async () =>
          (
            await prisma.shippingCompany.findMany({
              where: { deletedAt: null },
              select: { id: true, name: true },
            })
          ).map((r) => ({ id: r.id, code: null, name: r.name, active: true })),
      },
      {
        type: 'SHIPPING_METHOD',
        label: 'Shipping Method',
        defaultMatchField: 'name',
        list: async () =>
          (
            await prisma.shippingMethod.findMany({
              where: { deletedAt: null },
              select: { id: true, name: true },
            })
          ).map((r) => ({ id: r.id, code: null, name: r.name, active: true })),
      },
      {
        type: 'COST_CENTER',
        label: 'Cost Center',
        defaultMatchField: 'code',
        list: async () =>
          (
            await prisma.costCenter.findMany({
              where: { deletedAt: null },
              select: { id: true, code: true, name: true },
            })
          ).map((r) => ({
            id: r.id,
            code: r.code,
            name: r.name,
            active: true,
          })),
      },
      {
        type: 'CHART_OF_ACCOUNT',
        label: 'Chart of Account',
        defaultMatchField: 'code',
        list: async () =>
          (
            await prisma.chartOfAccount.findMany({
              where: { deletedAt: null },
              select: { id: true, code: true, name: true },
            })
          ).map((r) => ({
            id: r.id,
            code: r.code,
            name: r.name,
            active: true,
          })),
      },
      {
        type: 'BRAND',
        label: 'Brand',
        defaultMatchField: 'name',
        list: async () =>
          (
            await prisma.productBrand.findMany({
              where: { deletedAt: null },
              select: { id: true, name: true },
            })
          ).map((r) => ({ id: r.id, code: null, name: r.name, active: true })),
      },
      {
        type: 'UNIT',
        label: 'Unit',
        defaultMatchField: 'name',
        list: async () =>
          (
            await prisma.unit.findMany({
              where: { deletedAt: null },
              select: { id: true, name: true },
            })
          ).map((r) => ({ id: r.id, code: null, name: r.name, active: true })),
      },
      {
        type: 'SHIPPING_STATUS',
        label: 'Shipping Status',
        defaultMatchField: 'code',
        // Never a second status list — literally the same array
        // `ShippingUpdatesImportHandler`'s own `options` dropdown and
        // status validation already use.
        list: () =>
          Promise.resolve(
            SHIPPING_ALLOWED_STATUSES.map((status) => ({
              id: status,
              code: status,
              name: status,
              active: true,
            })),
          ),
      },
      {
        type: 'CATEGORY',
        label: 'Category',
        defaultMatchField: 'name',
        list: async () =>
          (
            await prisma.productCategory.findMany({
              where: { deletedAt: null },
              select: { id: true, name: true },
            })
          ).map((r) => ({ id: r.id, code: null, name: r.name, active: true })),
      },
      {
        type: 'TAX',
        label: 'Tax',
        defaultMatchField: 'name',
        list: async () =>
          (
            await prisma.tax.findMany({
              where: { deletedAt: null },
              select: { id: true, code: true, name: true },
            })
          ).map((r) => ({
            id: r.id,
            code: r.code,
            name: r.name,
            active: true,
          })),
      },
      {
        type: 'JOURNAL',
        label: 'Journal',
        defaultMatchField: 'code',
        list: async () =>
          (
            await prisma.journal.findMany({
              where: { deletedAt: null },
              select: { id: true, code: true, name: true },
            })
          ).map((r) => ({
            id: r.id,
            code: r.code,
            name: r.name,
            active: true,
          })),
      },
      {
        type: 'PROJECT',
        label: 'Project',
        defaultMatchField: 'code',
        list: async () =>
          (
            await prisma.project.findMany({
              where: { deletedAt: null },
              select: { id: true, code: true, name: true },
            })
          ).map((r) => ({
            id: r.id,
            code: r.code,
            name: r.name,
            active: true,
          })),
      },
      {
        // Cash Flow module (spec section 3) — "every cash source must be
        // linked to an existing account in the Chart of Accounts... never a
        // free-text account name." Reuses `ReceivingAccount`, already "the
        // real accounting destination" master-data entity, never a second
        // CashSource table.
        type: 'CASH_SOURCE',
        label: 'Cash Source',
        defaultMatchField: 'name',
        list: async () =>
          (
            await prisma.receivingAccount.findMany({
              where: { deletedAt: null },
              select: { id: true, code: true, name: true, isActive: true },
            })
          ).map((r) => ({
            id: r.id,
            code: r.code,
            name: r.name,
            active: r.isActive,
          })),
      },
    ];
  }
}

export type { ReferenceRecord };
