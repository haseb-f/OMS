import * as fs from 'fs';
import * as path from 'path';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PermissionsResolverService } from './permissions-resolver.service';
import type { PrismaService } from '../prisma/prisma.service';
import {
  ALL_PERMISSION_NAMES,
  groupPermissionCatalog,
  PERMISSION_CATALOG,
  SETTINGS_DOMAINS,
  SETTINGS_DOMAIN_MODULES,
  settingsDomainOfPermission,
  withImpliedSectionPermissions,
  withSettingsDomainGrants,
} from './permission-catalog';
import { PaymentMethodsController } from '../payment-methods/payment-methods.controller';
import { ShippingCompaniesController } from '../shipping-companies/shipping-companies.controller';
import { PostingSettingsController } from '../accounting/posting-settings/posting-settings.controller';
import { CostAllocationRunsController } from '../cost-allocation/cost-allocation-rules.controller';
import { NumberingController } from '../numbering/numbering.controller';
import { UsersController } from '../users/users.controller';
import { WorkflowController } from '../workflow/workflow.controller';

/**
 * R6 (spec A.3) — settings permissions by domain: the domain key is an
 * additional way to be allowed, scoped to its own domain only, resolved at
 * request time through the real PermissionsGuard + PermissionsResolverService
 * (Prisma mocked). Agents never gain internal setup.
 */

type Handler = (...args: never[]) => unknown;
type Controller = abstract new (...args: never[]) => unknown;

function handlerOf(controller: { prototype: object }, method: string): Handler {
  return Object.getOwnPropertyDescriptor(controller.prototype, method)!
    .value as Handler;
}

async function guardAllows(
  stored: string[],
  controller: Controller,
  method: string,
  httpMethod: string,
  userType: 'INTERNAL' | 'AGENT' = 'INTERNAL',
): Promise<boolean> {
  const prisma = {
    user: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ isSuperAdmin: false, userType, agentRole: null }),
    },
    userPermission: {
      findMany: jest
        .fn()
        .mockResolvedValue(stored.map((name) => ({ permission: { name } }))),
    },
  };
  const guard = new PermissionsGuard(
    new Reflector(),
    new PermissionsResolverService(prisma as unknown as PrismaService),
  );
  const context = {
    getHandler: () => handlerOf(controller, method),
    getClass: () => controller,
    switchToHttp: () => ({
      getRequest: () => ({ method: httpMethod, user: { sub: 'user-1' } }),
    }),
  } as unknown as ExecutionContext;
  try {
    return await guard.canActivate(context);
  } catch (error) {
    if (error instanceof ForbiddenException) return false;
    throw error;
  }
}

describe('R6 settings domains — catalog', () => {
  it('registers view/manage for every domain under the Settings section', () => {
    for (const domain of SETTINGS_DOMAINS) {
      expect(ALL_PERMISSION_NAMES).toContain(`settings.${domain}.view`);
      expect(ALL_PERMISSION_NAMES).toContain(`settings.${domain}.manage`);
    }
    const settings = groupPermissionCatalog().find(
      (group) => group.sectionKey === 'settings',
    );
    expect(settings?.modules.map((m) => m.key)).toEqual([
      'settings',
      ...SETTINGS_DOMAINS.map((d) => `settings-${d}`),
    ]);
  });

  it('every domain module is a real catalog module, in exactly one domain', () => {
    const seen = new Set<string>();
    for (const domain of SETTINGS_DOMAINS) {
      for (const key of SETTINGS_DOMAIN_MODULES[domain]) {
        expect(PERMISSION_CATALOG.some((m) => m.key === key)).toBe(true);
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    }
    expect(seen.has('settings')).toBe(false);
  });

  it('any domain key implies the settings.view section key', () => {
    expect(withImpliedSectionPermissions(['settings.crm.view'])).toContain(
      'settings.view',
    );
  });
});

describe('R6 settings domains — withSettingsDomainGrants', () => {
  it('finance.manage grants finance setup actions only', () => {
    const granted = withSettingsDomainGrants(['settings.finance.manage']);
    expect(granted).toEqual(
      expect.arrayContaining([
        'settings.view',
        'settings.finance.view',
        'masterdata.payment-methods.create',
        'masterdata.payment-methods.archive',
        'masterdata.taxes.edit',
        'accounting.fiscal-years.manage',
        'masterdata.cost-allocation-rules.edit',
      ]),
    );
    // Other domains, operational actions and user administration: never.
    expect(granted).not.toContain('masterdata.shipping-companies.view');
    expect(granted).not.toContain('masterdata.cost-components.create');
    expect(granted).not.toContain('masterdata.cost-allocation-rules.post');
    expect(granted).not.toContain('masterdata.cost-allocation-rules.run');
    expect(granted).not.toContain('settings.manage');
    expect(granted).not.toContain('settings.shipping.view');
  });

  it('a domain view key grants views only', () => {
    const granted = withSettingsDomainGrants(['settings.shipping.view']);
    expect(granted).toEqual(
      expect.arrayContaining([
        'masterdata.shipping-companies.view',
        'masterdata.shipping-statuses.view',
        'masterdata.fulfillment-cost-rules.view',
      ]),
    );
    expect(granted).not.toContain('masterdata.shipping-companies.create');
    expect(granted).not.toContain('settings.shipping.manage');
  });

  it('leaves a grant list without domain keys untouched', () => {
    expect(withSettingsDomainGrants(['masterdata.taxes.view'])).toEqual([
      'masterdata.taxes.view',
    ]);
  });
});

describe('R6 settings domains — guard enforcement', () => {
  it('settings.finance.manage allows finance setup writes', async () => {
    const grant = ['settings.finance.manage'];
    expect(
      await guardAllows(grant, PaymentMethodsController, 'create', 'POST'),
    ).toBe(true);
    expect(
      await guardAllows(grant, PaymentMethodsController, 'update', 'PATCH'),
    ).toBe(true);
    expect(
      await guardAllows(grant, PostingSettingsController, 'update', 'PATCH'),
    ).toBe(true);
  });

  it('a domain key never reaches another domain, an operational action or user administration', async () => {
    const grant = ['settings.finance.manage'];
    expect(
      await guardAllows(grant, ShippingCompaniesController, 'create', 'POST'),
    ).toBe(false);
    expect(
      await guardAllows(grant, NumberingController, 'create', 'POST'),
    ).toBe(false);
    expect(
      await guardAllows(grant, CostAllocationRunsController, 'postRun', 'POST'),
    ).toBe(false);
    expect(await guardAllows(grant, UsersController, 'create', 'POST')).toBe(
      false,
    );
  });

  it('a domain view key does not allow writes', async () => {
    expect(
      await guardAllows(
        ['settings.crm.view'],
        WorkflowController,
        'createTransition',
        'POST',
      ),
    ).toBe(false);
  });

  it('existing granular keys keep working without any domain key', async () => {
    expect(
      await guardAllows(
        ['masterdata.payment-methods.create'],
        PaymentMethodsController,
        'create',
        'POST',
      ),
    ).toBe(true);
    expect(
      await guardAllows(
        ['accounting.fiscal-years.manage'],
        PostingSettingsController,
        'update',
        'PATCH',
      ),
    ).toBe(true);
  });

  it('an agent user never gains internal setup, even with a stored domain row', async () => {
    const stored = [
      'settings.finance.manage',
      'masterdata.payment-methods.create',
    ];
    expect(
      await guardAllows(
        stored,
        PaymentMethodsController,
        'create',
        'POST',
        'AGENT',
      ),
    ).toBe(false);
  });
});

describe('R6 settings domains — migration mapping', () => {
  const sql = fs.readFileSync(
    path.join(
      __dirname,
      '../../prisma/migrations/20261001130000_r6_settings_domain_permissions/migration.sql',
    ),
    'utf8',
  );

  it('maps every granular setup key to exactly its own domain', () => {
    const block = sql.slice(sql.indexOf('WITH setup_key'));
    const pairs = [...block.matchAll(/\('([a-z.-]+)', '([a-z]+)'\)/g)].map(
      ([, name, domain]) => [name, domain] as const,
    );
    const expected = SETTINGS_DOMAINS.flatMap((domain) =>
      SETTINGS_DOMAIN_MODULES[domain].flatMap(
        (key) =>
          PERMISSION_CATALOG.find((m) => m.key === key)?.actions.map(
            (a) => [a.name, domain] as const,
          ) ?? [],
      ),
    );
    expect(pairs).toEqual([['settings.view', 'general'], ...expected]);
    for (const [name, domain] of expected) {
      expect(settingsDomainOfPermission(name)).toBe(domain);
    }
  });

  it('grants internal users only and never deletes', () => {
    expect(sql).not.toMatch(/\bDELETE\b|\bDROP\b|\bUPDATE\b/i);
    expect(sql.match(/"user_type" = 'INTERNAL'/g)).toHaveLength(2);
  });
});
