import { PermissionsResolverService } from './permissions-resolver.service';
import type { PrismaService } from '../prisma/prisma.service';

describe('PermissionsResolverService', () => {
  const prisma = {
    user: { findUnique: jest.fn() },
    userPermission: { findMany: jest.fn(), deleteMany: jest.fn() },
    jobTitlePermission: { findMany: jest.fn() },
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
        { permission: { name: 'partners.view' } },
      ]);

    const first = await resolver.getPermissions('user-1');
    expect(first.has('partners.view')).toBe(false);

    resolver.invalidate('user-1');
    const second = await resolver.getPermissions('user-1');
    expect(second.has('partners.view')).toBe(true);
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

  describe('R14 job-title templates + individual overrides', () => {
    const rows = (names: string[], effect: 'GRANT' | 'DENY' = 'GRANT') =>
      names.map((name) => ({ effect, permission: { name } }));

    it('inherits the job title template for an INTERNAL user', async () => {
      prisma.user.findUnique.mockResolvedValue({
        isSuperAdmin: false,
        userType: 'INTERNAL',
        jobTitleId: 'title-1',
      });
      prisma.userPermission.findMany.mockResolvedValue([]);
      prisma.jobTitlePermission.findMany.mockResolvedValue(
        rows(['products.create']),
      );

      const permissions = await resolver.getPermissions('user-1');

      expect(prisma.jobTitlePermission.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { jobTitleId: 'title-1' } }),
      );
      expect(permissions.has('products.create')).toBe(true);
      expect(permissions.has('products.view')).toBe(true);
    });

    it('adds an individual GRANT to the template', async () => {
      prisma.user.findUnique.mockResolvedValue({
        isSuperAdmin: false,
        userType: 'INTERNAL',
        jobTitleId: 'title-1',
      });
      prisma.userPermission.findMany.mockResolvedValue(rows(['shipping.view']));
      prisma.jobTitlePermission.findMany.mockResolvedValue(
        rows(['products.create']),
      );

      const permissions = await resolver.getPermissions('user-1');
      expect(permissions.has('shipping.view')).toBe(true);
      expect(permissions.has('products.create')).toBe(true);
    });

    it('a DENY beats the inherited grant and its implied permission', async () => {
      prisma.user.findUnique.mockResolvedValue({
        isSuperAdmin: false,
        userType: 'INTERNAL',
        jobTitleId: 'title-1',
      });
      prisma.userPermission.findMany.mockResolvedValue(
        rows(['products.create'], 'DENY'),
      );
      prisma.jobTitlePermission.findMany.mockResolvedValue(
        rows(['products.create']),
      );

      expect(await resolver.hasPermission('user-1', 'products.create')).toBe(
        false,
      );
      expect(await resolver.hasPermission('user-1', 'products.view')).toBe(
        false,
      );
    });

    it('agent users ignore job-title templates', async () => {
      prisma.user.findUnique.mockResolvedValue({
        isSuperAdmin: false,
        userType: 'AGENT',
        agentRole: 'SALES',
        jobTitleId: 'title-1',
      });
      prisma.userPermission.findMany.mockResolvedValue(
        rows(['agent.leads.view']),
      );
      prisma.jobTitlePermission.findMany.mockResolvedValue(
        rows(['products.create']),
      );

      const permissions = await resolver.getPermissions('user-1');
      expect(prisma.jobTitlePermission.findMany).not.toHaveBeenCalled();
      expect([...permissions]).toEqual(['agent.leads.view']);
    });
  });
});
