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
 * Chart of Accounts Import — five-root merge-by-code + Account Kind.
 * Runs against the real local Postgres.
 */
describe('ChartOfAccountsImportHandler — Parent Account Code hierarchy', () => {
  let moduleRef: TestingModule;
  let handler: ChartOfAccountsImportHandler;
  let prisma: PrismaService;
  let importUserId: string;
  let assetRootId: string;

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

    const assetRoot = await prisma.chartOfAccount.upsert({
      where: { code: '1' },
      update: {
        isSystemAccount: true,
        allowsPosting: false,
        parentAccountId: null,
        level: 1,
        accountType: 'ASSET',
      },
      create: {
        code: '1',
        name: 'الأصول',
        accountType: 'ASSET',
        parentAccountId: null,
        level: 1,
        allowsPosting: false,
        isSystemAccount: true,
      },
    });
    assetRootId = assetRoot.id;
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

  async function importFile(
    rows: Record<string, string>[],
    options?: { dryRun?: boolean },
  ) {
    return runWithReferenceCache(async () => {
      try {
        await handler.preloadRows(rows);
      } catch (error) {
        return [
          {
            rowNumber: 0,
            error: error instanceof Error ? error.message : String(error),
          },
        ];
      }
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
      parentAccountCode: '1',
      accountKind: 'POSTING',
      currencyCode: '',
      allowReconciliation: '',
      description: '',
      ...overrides,
    };
  }

  async function accountByCode(code: string) {
    return prisma.chartOfAccount.findFirst({ where: { code } });
  }

  it('imports a max-depth hierarchy under system root 1', async () => {
    const c = (suffix: string) => `${prefix}A${suffix}`;
    const rows = [
      row({
        code: c('11'),
        name: `${c('11')} Current Assets`,
        accountKind: 'AGGREGATION',
        parentAccountCode: '1',
      }),
      row({
        code: c('111'),
        name: `${c('111')} Cash Group`,
        accountKind: 'AGGREGATION',
        parentAccountCode: c('11'),
      }),
      row({
        code: c('11101'),
        name: `${c('11101')} Cash EGP`,
        accountKind: 'POSTING',
        parentAccountCode: c('111'),
      }),
      row({
        code: c('11102'),
        name: `${c('11102')} Cash SAR`,
        accountKind: 'POSTING',
        parentAccountCode: c('111'),
      }),
      row({
        code: c('112'),
        name: `${c('112')} Receivables`,
        accountKind: 'POSTING',
        parentAccountCode: c('11'),
      }),
    ];

    const results = await importFile(rows);
    expect(results.every((r) => !r.error)).toBe(true);

    const [a11, a111, a11101, a11102, a112] = await Promise.all(
      [c('11'), c('111'), c('11101'), c('11102'), c('112')].map(accountByCode),
    );

    expect(a11!.parentAccountId).toBe(assetRootId);
    expect(a111!.parentAccountId).toBe(a11!.id);
    expect(a11101!.parentAccountId).toBe(a111!.id);
    expect(a11102!.parentAccountId).toBe(a111!.id);
    expect(a112!.parentAccountId).toBe(a11!.id);
    expect(a11!.allowsPosting).toBe(false);
    expect(a11101!.allowsPosting).toBe(true);
  });

  it('imports correctly even when a child row appears BEFORE its parent', async () => {
    const c = (suffix: string) => `${prefix}B${suffix}`;
    const rows = [
      row({
        code: c('11102'),
        name: 'Grandchild 2',
        accountKind: 'POSTING',
        parentAccountCode: c('111'),
      }),
      row({
        code: c('111'),
        name: 'Child',
        accountKind: 'AGGREGATION',
        parentAccountCode: c('11'),
      }),
      row({
        code: c('11101'),
        name: 'Grandchild 1',
        accountKind: 'POSTING',
        parentAccountCode: c('111'),
      }),
      row({
        code: c('11'),
        name: 'Level 2',
        accountKind: 'AGGREGATION',
        parentAccountCode: '1',
      }),
    ];

    const results = await importFile(rows);
    expect(results.every((r) => !r.error)).toBe(true);
    const created = await prisma.chartOfAccount.count({
      where: { code: { startsWith: `${prefix}B` } },
    });
    expect(created).toBe(4);

    const [a11, a111, a11101, a11102] = await Promise.all(
      [c('11'), c('111'), c('11101'), c('11102')].map(accountByCode),
    );
    expect(a11!.parentAccountId).toBe(assetRootId);
    expect(a111!.parentAccountId).toBe(a11!.id);
    expect(a11101!.parentAccountId).toBe(a111!.id);
    expect(a11102!.parentAccountId).toBe(a111!.id);
  });

  it('rejects a row whose Parent Account Code does not exist', async () => {
    const c = (suffix: string) => `${prefix}C${suffix}`;
    const rows = [
      row({
        code: c('1'),
        name: 'Orphan',
        parentAccountCode: `${prefix}-DOES-NOT-EXIST`,
      }),
    ];
    const results = await importFile(rows);
    expect(results[0].error).toContain('DOES-NOT-EXIST');
    expect(await accountByCode(c('1'))).toBeNull();
  });

  it('detects a circular Parent Account Code chain', async () => {
    const c = (suffix: string) => `${prefix}D${suffix}`;
    const rows = [
      row({
        code: c('1'),
        name: 'A',
        accountKind: 'AGGREGATION',
        parentAccountCode: c('2'),
      }),
      row({
        code: c('2'),
        name: 'B',
        accountKind: 'AGGREGATION',
        parentAccountCode: c('1'),
      }),
    ];
    const results = await importFile(rows);
    expect(results.some((r) => r.error?.includes('Circular'))).toBe(true);
    expect(await accountByCode(c('1'))).toBeNull();
    expect(await accountByCode(c('2'))).toBeNull();
  });

  it('merges an existing account by code on repeat import (preserves id)', async () => {
    const c = (suffix: string) => `${prefix}E${suffix}`;
    const first = await importFile([
      row({
        code: c('1'),
        name: 'Cash',
        accountKind: 'POSTING',
        parentAccountCode: '1',
      }),
    ]);
    expect(first[0].error).toBeUndefined();
    const before = await accountByCode(c('1'));

    const second = await importFile([
      row({
        code: c('1'),
        name: 'Cash Renamed',
        accountKind: 'POSTING',
        parentAccountCode: '1',
      }),
    ]);
    expect(second[0].error).toBeUndefined();
    const after = await accountByCode(c('1'));
    expect(after!.id).toBe(before!.id);
    expect(after!.name).toBe('Cash Renamed');
  });

  it('dry run validates the hierarchy without writing', async () => {
    const c = (suffix: string) => `${prefix}G${suffix}`;
    const rows = [
      row({
        code: c('11'),
        name: 'Group',
        accountKind: 'AGGREGATION',
        parentAccountCode: '1',
      }),
      row({
        code: c('111'),
        name: 'Child',
        accountKind: 'POSTING',
        parentAccountCode: c('11'),
      }),
    ];
    const results = await importFile(rows, { dryRun: true });
    expect(results.every((r) => !r.error)).toBe(true);
    expect(await accountByCode(c('11'))).toBeNull();
    expect(await accountByCode(c('111'))).toBeNull();
  });

  it('flags system root code 1 as a protected system account', async () => {
    const root = await accountByCode('1');
    expect(root!.isSystemAccount).toBe(true);
    expect(root!.allowsPosting).toBe(false);
  });
});
