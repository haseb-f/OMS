import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Accounting Configuration — Account Mapping (TASK-047). The ONLY place a
 * Posting Provider asks "which real Chart of Account id do I post to for
 * X" — every lookup here is a layered fallback chain (most specific
 * override first), never a hardcoded id. Providers must not read
 * `PostingSettings`/`ProductCategory`/`CustomerGroup`/`SupplierGroup`/`Tax`
 * account columns directly; they call this service instead, so the
 * fallback order lives in exactly one place.
 *
 * Every method throws a clear, actionable error when the whole chain comes
 * up empty — "Nothing configured" must never mean "post to nothing."
 */
@Injectable()
export class AccountMappingService {
  constructor(private readonly prisma: PrismaService) {}

  /** Dr Accounts Receivable — Customer's own account always wins; Customer Group, then global default, are the fallbacks. */
  async resolveReceivableAccount(
    customerId: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<string> {
    const customer = await tx.customer.findUniqueOrThrow({
      where: { id: customerId },
      select: {
        defaultReceivableAccountId: true,
        customerGroup: { select: { defaultReceivableAccountId: true } },
      },
    });
    const settings = await this.getSettings(tx);
    const accountId =
      customer.defaultReceivableAccountId ??
      customer.customerGroup?.defaultReceivableAccountId ??
      settings?.accountsReceivableAccountId;
    return this.require(accountId, 'Accounts Receivable', [
      'Customer.defaultReceivableAccountId',
      'CustomerGroup.defaultReceivableAccountId',
      'PostingSettings.accountsReceivableAccountId',
    ]);
  }

  /** Cr Sales Revenue — Product Category override, then Customer Group override, then the global default. */
  async resolveSalesRevenueAccount(
    categoryId: string | null,
    customerGroupId: string | null,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<string> {
    const [category, customerGroup, settings] = await Promise.all([
      categoryId
        ? tx.productCategory.findUnique({
            where: { id: categoryId },
            select: { revenueAccountId: true },
          })
        : null,
      customerGroupId
        ? tx.customerGroup.findUnique({
            where: { id: customerGroupId },
            select: { defaultRevenueAccountId: true },
          })
        : null,
      this.getSettings(tx),
    ]);
    const accountId =
      category?.revenueAccountId ??
      customerGroup?.defaultRevenueAccountId ??
      settings?.salesRevenueAccountId;
    return this.require(accountId, 'Sales Revenue', [
      'ProductCategory.revenueAccountId',
      'CustomerGroup.defaultRevenueAccountId',
      'PostingSettings.salesRevenueAccountId',
    ]);
  }

  /** Dr/Cr Cost Of Goods Sold — Product Category override, then the global default. */
  async resolveCogsAccount(
    categoryId: string | null,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<string> {
    const [category, settings] = await Promise.all([
      categoryId
        ? tx.productCategory.findUnique({
            where: { id: categoryId },
            select: { cogsAccountId: true },
          })
        : null,
      this.getSettings(tx),
    ]);
    const accountId =
      category?.cogsAccountId ?? settings?.costOfGoodsSoldAccountId;
    return this.require(accountId, 'Cost Of Goods Sold', [
      'ProductCategory.cogsAccountId',
      'PostingSettings.costOfGoodsSoldAccountId',
    ]);
  }

  /** Dr/Cr Inventory Asset — Product Category override, then the global default. */
  async resolveInventoryAccount(
    categoryId: string | null,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<string> {
    const [category, settings] = await Promise.all([
      categoryId
        ? tx.productCategory.findUnique({
            where: { id: categoryId },
            select: { inventoryAccountId: true },
          })
        : null,
      this.getSettings(tx),
    ]);
    const accountId =
      category?.inventoryAccountId ?? settings?.inventoryAccountId;
    return this.require(accountId, 'Inventory Asset', [
      'ProductCategory.inventoryAccountId',
      'PostingSettings.inventoryAccountId',
    ]);
  }

  /** Dr/Cr [Inventory Adjustment offset] — global default only (falls back to COGS if not configured, so TASK-046 behavior keeps working unconfigured). */
  async resolveInventoryAdjustmentAccount(
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<string> {
    const settings = await this.getSettings(tx);
    const accountId =
      settings?.inventoryAdjustmentAccountId ??
      settings?.costOfGoodsSoldAccountId;
    return this.require(accountId, 'Inventory Adjustment', [
      'PostingSettings.inventoryAdjustmentAccountId',
      'PostingSettings.costOfGoodsSoldAccountId',
    ]);
  }

  /**
   * Dr [Purchase / non-inventory expense line] — Supplier's own account
   * always wins (TASK-046 behavior preserved), then Supplier Group,
   * then Product Category, then the global Purchase Account, then the
   * legacy global Default Expense Account.
   */
  async resolvePurchaseAccount(
    supplierId: string,
    categoryId: string | null,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<string> {
    const [supplier, category, settings] = await Promise.all([
      tx.supplier.findUniqueOrThrow({
        where: { id: supplierId },
        select: {
          defaultExpenseAccountId: true,
          supplierGroup: { select: { defaultPurchaseAccountId: true } },
        },
      }),
      categoryId
        ? tx.productCategory.findUnique({
            where: { id: categoryId },
            select: { purchaseAccountId: true },
          })
        : null,
      this.getSettings(tx),
    ]);
    const accountId =
      supplier.defaultExpenseAccountId ??
      supplier.supplierGroup?.defaultPurchaseAccountId ??
      category?.purchaseAccountId ??
      settings?.purchaseAccountId ??
      settings?.defaultExpenseAccountId;
    return this.require(accountId, 'Purchase / Expense', [
      'Supplier.defaultExpenseAccountId',
      'SupplierGroup.defaultPurchaseAccountId',
      'ProductCategory.purchaseAccountId',
      'PostingSettings.purchaseAccountId',
      'PostingSettings.defaultExpenseAccountId',
    ]);
  }

  /** Dr Accounts Payable — Supplier's own account always wins, then Supplier Group, then the global default. */
  async resolvePayableAccount(
    supplierId: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<string> {
    const supplier = await tx.supplier.findUniqueOrThrow({
      where: { id: supplierId },
      select: {
        defaultPayableAccountId: true,
        supplierGroup: { select: { defaultPayableAccountId: true } },
      },
    });
    const settings = await this.getSettings(tx);
    const accountId =
      supplier.defaultPayableAccountId ??
      supplier.supplierGroup?.defaultPayableAccountId ??
      settings?.accountsPayableAccountId;
    return this.require(accountId, 'Accounts Payable', [
      'Supplier.defaultPayableAccountId',
      'SupplierGroup.defaultPayableAccountId',
      'PostingSettings.accountsPayableAccountId',
    ]);
  }

  /** Cr VAT Output — the Tax record's own account always wins; the global default only covers a Tax that hasn't been configured yet. Never hardcoded. */
  async resolveVatOutputAccount(
    taxId: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<string> {
    const tax = await tx.tax.findUniqueOrThrow({
      where: { id: taxId },
      select: { outputAccountId: true, name: true },
    });
    const settings = await this.getSettings(tx);
    const accountId = tax.outputAccountId ?? settings?.vatOutputAccountId;
    return this.require(accountId, `VAT Output (${tax.name})`, [
      'Tax.outputAccountId',
      'PostingSettings.vatOutputAccountId',
    ]);
  }

  /** Dr VAT Input — same rule as VAT Output, purchase side. */
  async resolveVatInputAccount(
    taxId: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<string> {
    const tax = await tx.tax.findUniqueOrThrow({
      where: { id: taxId },
      select: { inputAccountId: true, name: true },
    });
    const settings = await this.getSettings(tx);
    const accountId = tax.inputAccountId ?? settings?.vatInputAccountId;
    return this.require(accountId, `VAT Input (${tax.name})`, [
      'Tax.inputAccountId',
      'PostingSettings.vatInputAccountId',
    ]);
  }

  private async getSettings(tx: Prisma.TransactionClient | PrismaService) {
    return tx.postingSettings.findFirst();
  }

  private require(
    accountId: string | null | undefined,
    label: string,
    checkedIn: string[],
  ): string {
    if (!accountId) {
      throw new Error(
        `No ${label} account configured. Checked, in order: ${checkedIn.join(' → ')}.`,
      );
    }
    return accountId;
  }
}
