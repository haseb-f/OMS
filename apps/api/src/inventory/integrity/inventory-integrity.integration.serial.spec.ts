import { Test, type TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { PartnerRoleType, Prisma } from '@prisma/client';
import { PrismaModule } from '../../prisma/prisma.module';
import { PrismaService } from '../../prisma/prisma.service';
import { PermissionsCoreModule } from '../../permissions/permissions-core.module';
import { PhoneModule } from '../../common/phone/phone.module';
import { AuthModule } from '../../auth/auth.module';
import { FxModule } from '../../accounting/fx/fx.module';
import { PostingProvidersModule } from '../../accounting/posting-providers/posting-providers.module';
import { InventoryModule } from '../inventory.module';
import { InventoryService } from '../inventory.service';
import { RecipesModule } from '../../recipes/recipes.module';
import { RecipeManagementService } from '../../recipes/recipe-management.service';
import { AssemblyModule } from '../../assembly/assembly.module';
import { AssemblyService } from '../../assembly/assembly.service';
import { SalesInvoicesModule } from '../../sales/invoices/sales-invoices.module';
import { SalesInvoicesService } from '../../sales/invoices/sales-invoices.service';
import { PurchaseInvoicesModule } from '../../purchasing/invoices/purchase-invoices.module';
import { PurchaseInvoicesService } from '../../purchasing/invoices/purchase-invoices.service';
import { InventoryIntegrityService } from './inventory-integrity.service';
import type {
  IntegrityReport,
  InvariantId,
  InvariantResult,
} from './integrity.types';

/** Thrown inside an inspection transaction so every injected inconsistency is rolled back. */
class Rollback extends Error {}

/**
 * R13 E1 — the integrity report against the real local Postgres (run with
 * DATABASE_URL pointing at oms_r13, never `oms`): a small tagged scenario
 * (purchase receipt + opening stock, two assemblies one of them reversed, an
 * invoice selling a kit and an assembled item) passes every scoped invariant;
 * then each deliberate inconsistency is written INSIDE a transaction that is
 * always rolled back, the report is run on that transaction, and the relevant
 * invariant must fail. Shared data is never modified; fixtures are removed in
 * afterAll (documents + journals + movements in one transaction, so a failed
 * cleanup never leaves a half-deleted, inconsistent document behind).
 */
describe('Inventory integrity (integration)', () => {
  jest.setTimeout(300_000);
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let inventory: InventoryService;
  let recipes: RecipeManagementService;
  let assembly: AssemblyService;
  let invoices: SalesInvoicesService;
  let purchases: PurchaseInvoicesService;
  let integrity: InventoryIntegrityService;

  const tag = randomUUID().slice(0, 8).toUpperCase();
  let actorId: string;
  let unitId: string;
  let warehouseId: string;
  let customerId: string;
  let supplierId: string;
  const productIds: string[] = [];
  const accountIds: string[] = [];
  const categoryIds: string[] = [];
  const salesInvoiceIds: string[] = [];
  const purchaseInvoiceIds: string[] = [];
  const assemblyIds: string[] = [];
  let skuSeq = 0;

  let a: string;
  let b: string;
  let fg: string;
  let kit: string;
  let keptAssemblyId: string;
  let kitLineId: string;

  const makeCategory = async (suffix: string) => {
    const account = async (kind: string, accountType: 'ASSET' | 'EXPENSE') => {
      const created = await prisma.chartOfAccount.create({
        data: {
          code: `R13E-${tag}-${suffix}-${kind}`,
          name: `R13 E ${suffix} ${kind} ${tag}`,
          accountType,
        },
      });
      accountIds.push(created.id);
      return created.id;
    };
    const category = await prisma.productCategory.create({
      data: {
        name: `r13e-${tag}-${suffix}`,
        inventoryAccountId: await account('INV', 'ASSET'),
        cogsAccountId: await account('COGS', 'EXPENSE'),
      },
    });
    categoryIds.push(category.id);
    return category.id;
  };

  const makeProduct = async (opts: {
    categoryId: string;
    supply?: 'PURCHASED' | 'ASSEMBLED' | 'KIT';
    cost?: number;
  }) => {
    const suffix = `${++skuSeq}`;
    const isKit = opts.supply === 'KIT';
    const product = await prisma.product.create({
      data: {
        sku: `R13E-${tag}-${suffix}`,
        name: `R13 E ${tag} ${suffix}`,
        internalName: `R13 E ${suffix}`,
        displayName: `R13 E ${suffix}`,
        categoryId: opts.categoryId,
        unitId,
        preferredWarehouseId: warehouseId,
        type: isKit ? 'MANUFACTURED' : 'PURCHASE_AND_SALE',
        itemType: 'PRODUCT',
        supplyMethod: opts.supply ?? 'PURCHASED',
        isPurchasable: !isKit,
        isSellable: true,
        isInventoryItem: !isKit,
        currentCost: opts.cost === undefined ? undefined : opts.cost,
      },
    });
    productIds.push(product.id);
    return product.id;
  };

  const makeRecipe = async (productId: string) => {
    const draft = await recipes.create(
      productId,
      {
        lines: [
          { componentProductId: a, quantity: '2', unitId },
          { componentProductId: b, quantity: '1', unitId },
        ],
      },
      actorId,
    );
    return recipes.activate(draft.id, actorId);
  };

  const scope = () => ({ productIds: [a, b, fg, kit], warehouseId });

  const invariant = (report: IntegrityReport, id: InvariantId) => {
    const found = report.invariants.find((inv) => inv.id === id);
    if (!found) throw new Error(`invariant ${id} missing`);
    return found;
  };

  const rules = (result: InvariantResult) =>
    result.violations.map((violation) => violation.rule);

  /** Applies `mutate` and runs the report on the same transaction, then always rolls back. */
  const inspect = async (
    mutate: (tx: Prisma.TransactionClient) => Promise<unknown>,
  ): Promise<IntegrityReport> => {
    let report: IntegrityReport | undefined;
    try {
      await prisma.$transaction(
        async (tx) => {
          await mutate(tx);
          report = await integrity.run(scope(), tx);
          throw new Rollback();
        },
        { timeout: 120_000, maxWait: 30_000 },
      );
    } catch (error: unknown) {
      if (!(error instanceof Rollback)) throw error;
    }
    if (!report) throw new Error('inspection produced no report');
    return report;
  };

  const lastMovement = async (productId: string) =>
    prisma.inventoryMovement.findFirstOrThrow({
      where: { productId, warehouseId },
      orderBy: [{ createdAt: 'desc' }, { movementNumber: 'desc' }],
    });

  beforeAll(async () => {
    const database = new URL(
      process.env.DATABASE_URL ?? 'postgres://unknown/unknown',
    ).pathname.replace(/^\//, '');
    if (database === 'oms') {
      throw new Error(
        'Refusing to run against the main "oms" database — use oms_r13.',
      );
    }
    moduleRef = await Test.createTestingModule({
      imports: [
        PrismaModule,
        PermissionsCoreModule,
        PhoneModule,
        AuthModule,
        FxModule,
        PostingProvidersModule,
        InventoryModule,
        RecipesModule,
        AssemblyModule,
        SalesInvoicesModule,
        PurchaseInvoicesModule,
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    const get = <T>(type: new (...args: never[]) => T) =>
      moduleRef.get(type, { strict: false });
    inventory = get(InventoryService);
    recipes = get(RecipeManagementService);
    assembly = get(AssemblyService);
    invoices = get(SalesInvoicesService);
    purchases = get(PurchaseInvoicesService);
    integrity = get(InventoryIntegrityService);

    const lower = tag.toLowerCase();
    actorId = (
      await prisma.user.create({
        data: {
          email: `r13e-${lower}@test.local`,
          username: `r13e-${lower}`,
          fullName: `R13 E ${tag}`,
          passwordHash: 'x',
          isSuperAdmin: true,
        },
      })
    ).id;
    unitId = (await prisma.unit.create({ data: { name: `r13e-${tag}-pc` } }))
      .id;
    warehouseId = (
      await prisma.warehouse.create({
        data: { code: `R13E-${tag}`, name: `R13 E WH ${tag}` },
      })
    ).id;
    const partner = async (suffix: string, role: PartnerRoleType) =>
      (
        await prisma.partner.create({
          data: {
            partnerNumber: `PT-R13E-${tag}-${suffix}`,
            name: `R13 E ${suffix} ${tag}`,
            roles: { create: { role } },
          },
        })
      ).id;
    customerId = await partner('CUS', PartnerRoleType.CUSTOMER);
    supplierId = await partner('SUP', PartnerRoleType.SUPPLIER);

    // --- scenario -------------------------------------------------------
    a = await makeProduct({ categoryId: await makeCategory('A') });
    b = await makeProduct({ categoryId: await makeCategory('B'), cost: 15 });
    fg = await makeProduct({
      categoryId: await makeCategory('FG'),
      supply: 'ASSEMBLED',
    });
    kit = await makeProduct({
      categoryId: await makeCategory('KIT'),
      supply: 'KIT',
    });

    // Receipt: A bought (purchase invoice → receipt + moving average), B opening stock.
    const receipt = await purchases.create({
      partnerId: supplierId,
      items: [
        { productId: a, warehouseId, unitId, quantity: 30, unitPrice: 10 },
      ],
    });
    purchaseInvoiceIds.push(receipt.id);
    await purchases.confirm(receipt.id, actorId);
    await inventory.openingBalance({ productId: b, warehouseId, quantity: 20 });

    await makeRecipe(fg);
    await makeRecipe(kit);

    // Assembly: 3 FG kept, 1 FG assembled and reversed.
    const kept = await assembly.create(
      { productId: fg, warehouseId, quantity: 3 },
      actorId,
      { includeCosts: true },
    );
    keptAssemblyId = kept.order.id;
    assemblyIds.push(kept.order.id);
    const reversed = await assembly.create(
      { productId: fg, warehouseId, quantity: 1 },
      actorId,
      { includeCosts: true },
    );
    assemblyIds.push(reversed.order.id);
    await assembly.reverse(
      reversed.order.id,
      { reason: `R13 E integrity fixture ${tag}` },
      actorId,
      true,
    );

    // Kit sale: one invoice with a kit line (×2) and an assembled item (×1).
    const sale = await invoices.create({
      partnerId: customerId,
      items: [
        { productId: kit, warehouseId, unitId, quantity: 2, unitPrice: 200 },
        { productId: fg, warehouseId, unitId, quantity: 1, unitPrice: 150 },
      ],
    });
    salesInvoiceIds.push(sale.id);
    await invoices.confirm(sale.id, actorId);
    kitLineId = (
      await prisma.salesInvoiceItem.findFirstOrThrow({
        where: { salesInvoiceId: sale.id, productId: kit },
        select: { id: true },
      })
    ).id;
  });

  afterAll(async () => {
    const attempt = async (step: () => Promise<unknown>) => {
      try {
        await step();
      } catch {
        /* left tagged */
      }
    };
    if (prisma) {
      // Documents, their journals and stock in ONE transaction: all or nothing.
      await attempt(() =>
        prisma.$transaction(
          async (tx) => {
            const sourceIds = [
              ...salesInvoiceIds,
              ...purchaseInvoiceIds,
              ...assemblyIds,
            ];
            const entries = await tx.journalEntry.findMany({
              where: { sourceId: { in: sourceIds } },
              select: { id: true, reversalOfEntryId: true },
            });
            const ids = entries.map((entry) => entry.id);
            await tx.journalEntryActivity.deleteMany({
              where: { journalEntryId: { in: ids } },
            });
            await tx.journalEntryLine.deleteMany({
              where: { journalEntryId: { in: ids } },
            });
            await tx.journalEntry.deleteMany({
              where: { id: { in: ids }, reversalOfEntryId: { not: null } },
            });
            await tx.journalEntry.deleteMany({ where: { id: { in: ids } } });
            await tx.salesInvoiceItem.deleteMany({
              where: { salesInvoiceId: { in: salesInvoiceIds } },
            });
            await tx.salesInvoiceActivity.deleteMany({
              where: { salesInvoiceId: { in: salesInvoiceIds } },
            });
            await tx.salesInvoice.deleteMany({
              where: { id: { in: salesInvoiceIds } },
            });
            await tx.purchaseInvoiceItem.deleteMany({
              where: { purchaseInvoiceId: { in: purchaseInvoiceIds } },
            });
            await tx.purchaseInvoiceActivity.deleteMany({
              where: { purchaseInvoiceId: { in: purchaseInvoiceIds } },
            });
            await tx.purchaseInvoice.deleteMany({
              where: { id: { in: purchaseInvoiceIds } },
            });
            await tx.assemblyOrder.deleteMany({
              where: { id: { in: assemblyIds } },
            });
            const movements = await tx.inventoryMovement.findMany({
              where: { productId: { in: productIds } },
              select: { id: true },
            });
            await tx.inventoryMovementActivity.deleteMany({
              where: {
                inventoryMovementId: { in: movements.map((m) => m.id) },
              },
            });
            await tx.inventoryMovement.deleteMany({
              where: { productId: { in: productIds } },
            });
          },
          { timeout: 120_000, maxWait: 30_000 },
        ),
      );
      for (const step of [
        () =>
          prisma.productCostHistory.deleteMany({
            where: { productId: { in: productIds } },
          }),
        () =>
          prisma.productCostSnapshot.deleteMany({
            where: { productId: { in: productIds } },
          }),
        () =>
          prisma.productRecipe.deleteMany({
            where: { productId: { in: productIds } },
          }),
        () =>
          prisma.productActivity.deleteMany({
            where: { productId: { in: productIds } },
          }),
        () => prisma.product.deleteMany({ where: { id: { in: productIds } } }),
        () =>
          prisma.productCategory.deleteMany({
            where: { id: { in: categoryIds } },
          }),
        () =>
          prisma.chartOfAccount.deleteMany({
            where: { id: { in: accountIds } },
          }),
        () =>
          prisma.partnerRoleAssignment.deleteMany({
            where: { partnerId: { in: [customerId, supplierId] } },
          }),
        () =>
          prisma.partner.deleteMany({
            where: { id: { in: [customerId, supplierId] } },
          }),
        () => prisma.warehouse.delete({ where: { id: warehouseId } }),
        () => prisma.unit.delete({ where: { id: unitId } }),
        () => prisma.user.delete({ where: { id: actorId } }),
      ]) {
        await attempt(step);
      }
    }
    await moduleRef?.close();
  });

  it('a consistent scenario (receipt, assembly + reversal, kit sale) passes every scoped invariant', async () => {
    const report = await integrity.run(scope());
    for (const id of ['I1', 'I2', 'I3', 'I4', 'I5', 'I7', 'I8'] as const) {
      const result = invariant(report, id);
      expect({ id, rules: rules(result), status: result.status }).toEqual({
        id,
        rules: [],
        status: 'PASS',
      });
    }
    expect(invariant(report, 'I4').checked).toBe(2);
    expect(invariant(report, 'I4').metrics.reversed).toBe(1);
    expect(invariant(report, 'I5').checked).toBe(1);
    // I6 is company-wide (the GL has no product dimension): reported, never a FAIL.
    expect(invariant(report, 'I6').status).not.toBe('FAIL');
    expect(invariant(report, 'I6').notes[0]).toContain('Company-wide');
  });

  it('I1 fails when a movement snapshot breaks the chain (rolled back)', async () => {
    const first = await prisma.inventoryMovement.findFirstOrThrow({
      where: { productId: b, warehouseId },
      orderBy: [{ createdAt: 'asc' }, { movementNumber: 'asc' }],
    });
    const report = await inspect(
      (tx) =>
        tx.$executeRaw`UPDATE inventory_movements SET quantity_before = quantity_before + 1, quantity_after = quantity_after + 1 WHERE id = ${first.id}::uuid`,
    );
    const i1 = invariant(report, 'I1');
    expect(i1.status).toBe('FAIL');
    expect(rules(i1)).toEqual(
      expect.arrayContaining([
        'FIRST_BEFORE_NOT_ZERO',
        'BEFORE_NOT_PREVIOUS_AFTER',
      ]),
    );
    expect(invariant(report, 'I2').status).toBe('PASS');
  });

  it('I2 fails when reservations exceed on-hand (rolled back)', async () => {
    const last = await lastMovement(a);
    const report = await inspect(
      (tx) => tx.$executeRaw`
        INSERT INTO inventory_movements (id, movement_number, type, warehouse_id, product_id, quantity,
                                         quantity_before, quantity_after, created_at)
        VALUES (gen_random_uuid(), ${`R13E-${tag}-RES`}, 'RESERVATION', ${warehouseId}::uuid, ${a}::uuid, 1000,
                ${last.quantityAfter}, ${last.quantityAfter}, now() + interval '1 minute')`,
    );
    const i2 = invariant(report, 'I2');
    expect(i2.status).toBe('FAIL');
    expect(rules(i2)).toEqual(['RESERVED_EXCEEDS_ON_HAND']);
    expect(invariant(report, 'I1').status).toBe('PASS');
  });

  it('I3 warns about a repeated un-keyed document movement (rolled back)', async () => {
    const receipt = await prisma.inventoryMovement.findFirstOrThrow({
      where: { productId: a, type: 'PURCHASE_RECEIPT' },
    });
    const last = await lastMovement(a);
    const report = await inspect(async (tx) => {
      await tx.$executeRaw`UPDATE inventory_movements SET idempotency_key = NULL WHERE id = ${receipt.id}::uuid`;
      await tx.$executeRaw`
        INSERT INTO inventory_movements (id, movement_number, type, warehouse_id, product_id, quantity,
                                         quantity_before, quantity_after, reference_type, reference_id, created_at)
        VALUES (gen_random_uuid(), ${`R13E-${tag}-DUP`}, 'PURCHASE_RECEIPT', ${warehouseId}::uuid, ${a}::uuid,
                ${receipt.quantity}, ${last.quantityAfter}, ${last.quantityAfter + receipt.quantity},
                ${receipt.referenceType}, ${receipt.referenceId}::uuid, now() + interval '1 minute')`;
    });
    const i3 = invariant(report, 'I3');
    expect(i3.status).toBe('WARN');
    expect(rules(i3)).toEqual(['POSSIBLE_DUPLICATE_LEGACY_MOVEMENT']);
  });

  it('I4 fails when an assembly total no longer matches its lines and journal (rolled back)', async () => {
    const report = await inspect(
      (tx) =>
        tx.$executeRaw`UPDATE assembly_orders SET total_cost = total_cost + 1 WHERE id = ${keptAssemblyId}::uuid`,
    );
    const i4 = invariant(report, 'I4');
    expect(i4.status).toBe('FAIL');
    expect(rules(i4)).toEqual(
      expect.arrayContaining(['TOTAL_COST_MISMATCH', 'JOURNAL_TOTAL_MISMATCH']),
    );
  });

  it('I4 fails when a consumption movement disappears (rolled back)', async () => {
    const line = await prisma.assemblyOrderLine.findFirstOrThrow({
      where: { assemblyOrderId: keptAssemblyId },
    });
    const report = await inspect(async (tx) => {
      await tx.$executeRaw`DELETE FROM inventory_movement_activities WHERE inventory_movement_id = ${line.consumptionMovementId}::uuid`;
      await tx.$executeRaw`DELETE FROM inventory_movements WHERE id = ${line.consumptionMovementId}::uuid`;
    });
    expect(rules(invariant(report, 'I4'))).toEqual(
      expect.arrayContaining([
        'CONSUMPTION_MOVEMENT_MISMATCH',
        'ASSEMBLY_MOVEMENTS_MISMATCH',
      ]),
    );
  });

  it('I5 fails when the kit snapshot disagrees with the delivered components and the COGS (rolled back)', async () => {
    const report = await inspect(
      (tx) =>
        tx.$executeRaw`UPDATE sales_invoice_items SET fulfillment_snapshot = jsonb_set(fulfillment_snapshot, '{components,0,qtyPerKit}', '3') WHERE id = ${kitLineId}::uuid`,
    );
    const i5 = invariant(report, 'I5');
    expect(i5.status).toBe('FAIL');
    expect(rules(i5)).toEqual(
      expect.arrayContaining([
        'KIT_DELIVERY_QUANTITY_MISMATCH',
        'KIT_COGS_MISMATCH',
      ]),
    );
  });

  it('I7 fails when a movement owner differs from the product owner (rolled back)', async () => {
    const agent = await prisma.agent.findFirst({ select: { id: true } });
    if (!agent) return; // no agent in this database — nothing to attribute
    const movement = await lastMovement(b);
    const report = await inspect(
      (tx) =>
        tx.$executeRaw`UPDATE inventory_movements SET owner_agent_id = ${agent.id}::uuid WHERE id = ${movement.id}::uuid`,
    );
    const i7 = invariant(report, 'I7');
    expect(i7.status).toBe('FAIL');
    expect(rules(i7)).toContain('MOVEMENT_OWNER_NOT_PRODUCT_OWNER');
  });

  it('every injected inconsistency was rolled back — the scoped report passes again', async () => {
    const report = await integrity.run(scope());
    expect(
      report.invariants
        .filter((inv) => inv.id !== 'I6')
        .map((inv) => `${inv.id}:${inv.status}`),
    ).toEqual([
      'I1:PASS',
      'I2:PASS',
      'I3:PASS',
      'I4:PASS',
      'I5:PASS',
      'I7:PASS',
      'I8:PASS',
    ]);
  });
});
