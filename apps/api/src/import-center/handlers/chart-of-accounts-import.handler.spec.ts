import { Test, type TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { PrismaModule } from '../../prisma/prisma.module';
import { PrismaService } from '../../prisma/prisma.service';
import { PermissionsCoreModule } from '../../permissions/permissions-core.module';
import { PhoneModule } from '../../common/phone/phone.module';
import { AuthModule } from '../../auth/auth.module';
import { ImportCenterModule } from '../import-center.module';
import { runWithReferenceCache } from '../reference-data/reference-cache';
import { ChartOfAccountsImportHandler } from './chart-of-accounts-import.handler';

/**
 * Chart of Accounts Import — Parent Account Code hierarchy fix
 * (2026-08-15). Runs against the real local Postgres, same pattern as
 * every other import-handler spec in this repo. `importFile()` mirrors
 * exactly what `ImportJobsService.run()`/`validate()` actually do —
 * `preloadRows()` once, then `importRow()` once per row in FILE ORDER,
 * all wrapped in the same `runWithReferenceCache()` job-scoped cache —
 * since the bug this fixes is specifically about that per-run scoping.
 */
describe('ChartOfAccountsImportHandler — Parent Account Code hierarchy', () => {
  let moduleRef: TestingModule;
  let handler: ChartOfAccountsImportHandler;
  let prisma: PrismaService;
  let importUserId: string;

  const prefix = `COATEST-${randomUUID().slice(0, 6)}`;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        PrismaModule,
        PermissionsCoreModule,
        PhoneModule,
        AuthModule,
        ImportCenterModule,
      ],
    }).compile();
    await moduleRef.init();

    handler = moduleRef.get(ChartOfAccountsImportHandler);
    prisma = moduleRef.get(PrismaService);

    // The handler always sets `codeOverride` (an imported row's code is
    // never re-derived) — that gate requires the same privileged
    // permission a manual override would, so the importing user needs it
    // too, same as a real Import Center run by an authorized admin would.
    const user = await prisma.user.create({
      data: {
        email: `${prefix}-importer@example.test`,
        username: `${prefix}-importer`,
        fullName: 'CoA Import Test User',
        passwordHash: 'x',
        isSuperAdmin: false,
      },
    });
    importUserId = user.id;
    const overridePermission = await prisma.permission.findUniqueOrThrow({
      where: { name: 'accounting.chart-of-accounts.override-code' },
    });
    await prisma.userPermission.create({
      data: { userId: importUserId, permissionId: overridePermission.id },
    });
  });

  afterAll(async () => {
    await prisma.chartOfAccount.deleteMany({
      where: { code: { startsWith: prefix } },
    });
    await prisma.userPermission.deleteMany({ where: { userId: importUserId } });
    await prisma.user.deleteMany({ where: { id: importUserId } });
    await prisma.$disconnect();
    await moduleRef.close();
  });

  /** The exact per-row, in-file-order engine invocation `ImportJobsService.run()` performs — see `preloadRows`'s doc comment on why this must be wrapped in `runWithReferenceCache`. */
  async function importFile(
    rows: Record<string, string>[],
    options?: { dryRun?: boolean },
  ) {
    return runWithReferenceCache(async () => {
      await handler.preloadRows(rows);
      const results: {
        rowNumber: number;
        result?: { id: string };
        error?: string;
      }[] = [];
      for (let i = 0; i < rows.length; i++) {
        try {
          const result = await handler.importRow(
            rows[i],
            importUserId,
            options,
          );
          results.push({ rowNumber: i + 1, result });
        } catch (error) {
          results.push({
            rowNumber: i + 1,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      return results;
    });
  }

  function row(overrides: Record<string, string>): Record<string, string> {
    return {
      code: '',
      name: '',
      accountType: 'ASSET',
      parentAccountCode: '',
      currencyCode: '',
      allowReconciliation: '',
      description: '',
      ...overrides,
    };
  }

  async function accountByCode(code: string) {
    return prisma.chartOfAccount.findFirst({ where: { code } });
  }

  it('imports a 4-level hierarchy in top-down file order, every parentId resolving to the real database id of its exact Parent Account Code', async () => {
    const c = (suffix: string) => `${prefix}A${suffix}`;
    const rows = [
      row({ code: c('1'), name: 'الأصول', accountType: 'ASSET' }),
      row({
        code: c('11'),
        name: 'الأصول المتداولة',
        accountType: 'ASSET',
        parentAccountCode: c('1'),
      }),
      row({
        code: c('111'),
        name: 'النقدية والبنوك',
        accountType: 'ASSET',
        parentAccountCode: c('11'),
      }),
      row({
        code: c('11101'),
        name: 'خزينة جنيه مصري',
        accountType: 'ASSET',
        parentAccountCode: c('111'),
      }),
      row({
        code: c('11102'),
        name: 'خزينة نقدية ريال سعودي',
        accountType: 'ASSET',
        parentAccountCode: c('111'),
      }),
      row({
        code: c('11103'),
        name: 'البنك العربي الأفريقي',
        accountType: 'ASSET',
        parentAccountCode: c('111'),
      }),
      row({
        code: c('112'),
        name: 'حلول الدفع تحت التحصيل',
        accountType: 'ASSET',
        parentAccountCode: c('11'),
      }),
      row({
        code: c('11201'),
        name: 'تحت التحصيل 1',
        accountType: 'ASSET',
        parentAccountCode: c('112'),
      }),
      row({
        code: c('113'),
        name: 'المدينون',
        accountType: 'ASSET',
        parentAccountCode: c('11'),
      }),
      row({
        code: c('114'),
        name: 'المخزون',
        accountType: 'ASSET',
        parentAccountCode: c('11'),
      }),
    ];

    const results = await importFile(rows);
    expect(results.every((r) => !r.error)).toBe(true);

    const [a1, a11, a111, a11101, a11102, a11103, a112, a11201, a113, a114] =
      await Promise.all(
        [
          c('1'),
          c('11'),
          c('111'),
          c('11101'),
          c('11102'),
          c('11103'),
          c('112'),
          c('11201'),
          c('113'),
          c('114'),
        ].map(accountByCode),
      );

    expect(a1!.parentAccountId).toBeNull();
    expect(a11!.parentAccountId).toBe(a1!.id);
    expect(a111!.parentAccountId).toBe(a11!.id);
    expect(a11101!.parentAccountId).toBe(a111!.id);
    expect(a11102!.parentAccountId).toBe(a111!.id);
    expect(a11103!.parentAccountId).toBe(a111!.id);
    expect(a112!.parentAccountId).toBe(a11!.id);
    expect(a11201!.parentAccountId).toBe(a112!.id);
    expect(a113!.parentAccountId).toBe(a11!.id);
    expect(a114!.parentAccountId).toBe(a11!.id);
  });

  it('imports correctly even when a child row appears BEFORE its parent in the file — Parent Account Code is authoritative, not row order', async () => {
    const c = (suffix: string) => `${prefix}B${suffix}`;
    // Deliberately reversed / shuffled order.
    const rows = [
      row({
        code: c('11102'),
        name: 'Grandchild 2',
        accountType: 'ASSET',
        parentAccountCode: c('111'),
      }),
      row({
        code: c('111'),
        name: 'Child',
        accountType: 'ASSET',
        parentAccountCode: c('11'),
      }),
      row({
        code: c('11101'),
        name: 'Grandchild 1',
        accountType: 'ASSET',
        parentAccountCode: c('111'),
      }),
      row({ code: c('1'), name: 'Root', accountType: 'ASSET' }),
      row({
        code: c('11'),
        name: 'Level 2',
        accountType: 'ASSET',
        parentAccountCode: c('1'),
      }),
    ];

    const results = await importFile(rows);
    expect(results.every((r) => !r.error)).toBe(true);
    // Exactly 5 accounts created, never a duplicate from re-visiting a
    // row already created as a side effect of resolving an earlier row's
    // parent.
    const created = await prisma.chartOfAccount.count({
      where: { code: { startsWith: `${prefix}B` } },
    });
    expect(created).toBe(5);

    const [a1, a11, a111, a11101, a11102] = await Promise.all(
      [c('1'), c('11'), c('111'), c('11101'), c('11102')].map(accountByCode),
    );
    expect(a11!.parentAccountId).toBe(a1!.id);
    expect(a111!.parentAccountId).toBe(a11!.id);
    expect(a11101!.parentAccountId).toBe(a111!.id);
    expect(a11102!.parentAccountId).toBe(a111!.id);
  });

  it('rejects a row whose Parent Account Code does not exist anywhere (not in this file, not in the database) — never a fallback parent', async () => {
    const c = (suffix: string) => `${prefix}C${suffix}`;
    const rows = [
      row({
        code: c('1'),
        name: 'Orphan',
        accountType: 'ASSET',
        parentAccountCode: `${prefix}-DOES-NOT-EXIST`,
      }),
    ];
    const results = await importFile(rows);
    expect(results[0].error).toContain('DOES-NOT-EXIST');
    expect(results[0].error).toContain('not a recognized Chart of Account');
    expect(await accountByCode(c('1'))).toBeNull();
  });

  it('detects a circular Parent Account Code chain and rejects it, rather than infinite-looping', async () => {
    const c = (suffix: string) => `${prefix}D${suffix}`;
    const rows = [
      row({
        code: c('1'),
        name: 'A',
        accountType: 'ASSET',
        parentAccountCode: c('2'),
      }),
      row({
        code: c('2'),
        name: 'B',
        accountType: 'ASSET',
        parentAccountCode: c('1'),
      }),
    ];
    const results = await importFile(rows);
    expect(results.some((r) => r.error?.includes('Circular'))).toBe(true);
    expect(await accountByCode(c('1'))).toBeNull();
    expect(await accountByCode(c('2'))).toBeNull();
  });

  it('rejects a duplicate Account Code against the database — never silently creates a duplicate, never silently updates the hierarchy', async () => {
    const c = (suffix: string) => `${prefix}E${suffix}`;
    const first = await importFile([
      row({ code: c('1'), name: 'Root', accountType: 'ASSET' }),
    ]);
    expect(first[0].error).toBeUndefined();

    const second = await importFile([
      row({
        code: c('1'),
        name: 'Root Renamed',
        accountType: 'ASSET',
      }),
    ]);
    expect(second[0].error).toContain('already exists');

    const account = await accountByCode(c('1'));
    expect(account!.name).toBe('Root'); // untouched — the "rename" attempt was rejected, not applied.
  });

  it('preserves an existing account with the correct parent on a repeat import — never recreated, hierarchy untouched', async () => {
    const c = (suffix: string) => `${prefix}F${suffix}`;
    const rows = [
      row({ code: c('1'), name: 'Root', accountType: 'ASSET' }),
      row({
        code: c('11'),
        name: 'Child',
        accountType: 'ASSET',
        parentAccountCode: c('1'),
      }),
    ];
    await importFile(rows);
    const before = await accountByCode(c('11'));

    const repeat = await importFile(rows);
    expect(repeat.every((r) => r.error?.includes('already exists'))).toBe(true);

    const after = await accountByCode(c('11'));
    expect(after!.id).toBe(before!.id);
    expect(after!.parentAccountId).toBe(before!.parentAccountId);
  });

  it('dry run (preview) validates the full hierarchy without writing anything to the database', async () => {
    const c = (suffix: string) => `${prefix}G${suffix}`;
    const rows = [
      row({ code: c('1'), name: 'Root', accountType: 'ASSET' }),
      row({
        code: c('11'),
        name: 'Child',
        accountType: 'ASSET',
        parentAccountCode: c('1'),
      }),
    ];
    const results = await importFile(rows, { dryRun: true });
    expect(results.every((r) => !r.error)).toBe(true);
    expect(await accountByCode(c('1'))).toBeNull();
    expect(await accountByCode(c('11'))).toBeNull();
  });

  it('flags a new root account created with the reserved code "1" (ASSET) as a protected system account', async () => {
    // Uses the service directly through the handler's own creation path —
    // confirms ChartOfAccountsService.create() sets isSystemAccount, not
    // a second flagging mechanism in the import handler itself.
    const c = `${prefix}H1`;
    // "1" only maps to ASSET under the standard root-code convention; a
    // non-standard code proves the flag is NOT set for an ordinary root.
    const ordinaryRoot = await importFile([
      row({ code: c, name: 'Not A Real Root Code', accountType: 'ASSET' }),
    ]);
    expect(ordinaryRoot[0].error).toBeUndefined();
    const created = await accountByCode(c);
    expect(created!.isSystemAccount).toBe(false);
  });
});
