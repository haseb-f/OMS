import { PermissionsResolverService } from './permissions-resolver.service';
import type { PrismaService } from '../prisma/prisma.service';

describe('PermissionsResolverService', () => {
  const prisma = {
    user: { findUnique: jest.fn() },
    userPermission: { findMany: jest.fn(), deleteMany: jest.fn() },
  };
  const resolver = new PermissionsResolverService(
    prisma as unknown as PrismaService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    resolver.invalidate('user-1');
    prisma.user.findUnique.mockResolvedValue({ isSuperAdmin: false });
  });

  it('returns implied sales.view on read when only store-orders.view is stored', async () => {
    prisma.userPermission.findMany.mockResolvedValue([
      { permission: { name: 'store-orders.view' } },
    ]);

    const permissions = await resolver.getPermissions('user-1');

    expect(permissions.has('store-orders.view')).toBe(true);
    expect(permissions.has('sales.view')).toBe(true);
  });

  it('does not treat a hyphen/underscore mismatch as a grant', async () => {
    prisma.userPermission.findMany.mockResolvedValue([
      { permission: { name: 'store_orders.view' } },
    ]);

    const permissions = await resolver.getPermissions('user-1');

    expect(permissions.has('store-orders.view')).toBe(false);
    expect(permissions.has('sales.view')).toBe(false);
  });

  it('applies a permission change immediately after invalidate', async () => {
    prisma.userPermission.findMany
      .mockResolvedValueOnce([{ permission: { name: 'store-orders.view' } }])
      .mockResolvedValueOnce([
        { permission: { name: 'store-orders.view' } },
        { permission: { name: 'sales.customers.view' } },
      ]);

    const first = await resolver.getPermissions('user-1');
    expect(first.has('sales.customers.view')).toBe(false);

    resolver.invalidate('user-1');
    const second = await resolver.getPermissions('user-1');
    expect(second.has('sales.customers.view')).toBe(true);
    expect(second.has('sales.view')).toBe(true);
  });

  it('super-admin bypasses a missing grant without inventing catalog rows', async () => {
    prisma.user.findUnique.mockResolvedValue({ isSuperAdmin: true });
    prisma.userPermission.findMany.mockResolvedValue([]);

    expect(await resolver.hasPermission('user-1', 'store-orders.view')).toBe(
      true,
    );
    expect(await resolver.hasPermission('user-1', 'store-orders.edit')).toBe(
      true,
    );
    expect((await resolver.getPermissions('user-1')).size).toBe(0);
  });
});
