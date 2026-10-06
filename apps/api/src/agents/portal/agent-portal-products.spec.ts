import { NotFoundException } from '@nestjs/common';
import { AgentPortalService } from './agent-portal.service';
import type { AgentRequestContext } from '../../auth/guards/jwt-auth.guard';

const agent: AgentRequestContext = {
  userId: 'u1',
  agentId: 'ag1',
  agentRole: 'SALES',
};

const product = (
  id: string,
  over: { isInventoryItem: boolean; supplyMethod: string },
) => ({
  id,
  sku: id.toUpperCase(),
  name: id,
  nameEn: null,
  displayName: id,
  type: 'PURCHASE_AND_SALE',
  itemType: 'PRODUCT',
  salesPrice: null,
  unit: null,
  category: null,
  ownerAgentId: 'ag1',
  ...over,
});

/**
 * R13 — the agent portal catalog shows a kit's availability as what its
 * components allow (the shared kit-availability rule), only when stock is
 * visible; a kit without a usable recipe offers 0.
 */
describe('AgentPortalService.products — kit availability', () => {
  const build = (canSeeStock: boolean) => {
    const catalog = {
      items: [
        product('phys', { isInventoryItem: true, supplyMethod: 'PURCHASED' }),
        product('kit', { isInventoryItem: false, supplyMethod: 'KIT' }),
        product('broken', { isInventoryItem: false, supplyMethod: 'KIT' }),
        product('svc', { isInventoryItem: false, supplyMethod: 'PURCHASED' }),
      ],
      total: 4,
      page: 1,
      pageSize: 20,
    };
    const availability = jest.fn((id: string) =>
      id === 'kit'
        ? Promise.resolve({ available: 3 })
        : Promise.reject(new NotFoundException('no active recipe')),
    );
    const service = new AgentPortalService(
      {} as never,
      { hasPermission: jest.fn().mockResolvedValue(canSeeStock) } as never,
      { findSellableCatalog: jest.fn().mockResolvedValue(catalog) } as never,
      {
        getAgentStock: jest.fn().mockResolvedValue({
          items: [
            { productId: 'phys', available: 4 },
            { productId: 'phys', available: 1 },
          ],
        }),
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { availability } as never,
    );
    return { service, availability };
  };

  it('a kit shows what its components allow; a kit without a recipe shows 0', async () => {
    const { service } = build(true);
    const page = await service.products(agent, {});
    const byId = new Map(page.items.map((item) => [item.id, item.available]));
    expect(byId.get('phys')).toBe(5);
    expect(byId.get('kit')).toBe(3);
    expect(byId.get('broken')).toBe(0);
    expect(byId.get('svc')).toBeNull();
    expect(page.stockVisible).toBe(true);
  });

  it('without agent.stock.view no availability is computed or shown', async () => {
    const { service, availability } = build(false);
    const page = await service.products(agent, {});
    expect(page.items.every((item) => item.available === null)).toBe(true);
    expect(availability).not.toHaveBeenCalled();
  });
});
