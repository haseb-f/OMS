import { StoreOrdersController } from './store-orders.controller';

/**
 * ADR-0018 (Order Economics M2 gap closure, Part 22) — "Users without
 * orders.profitability.view must not receive profitability fields from the
 * Orders list API." The permission decision happens in the controller,
 * before `StoreOrdersService.findAll` ever runs, never trusted from the
 * raw `includeProfitability` query param.
 */
describe('StoreOrdersController.findAll — profitability authorization', () => {
  function makeController(hasPermission: boolean) {
    const storeOrdersService = {
      findAll: jest.fn().mockResolvedValue({ items: [] }),
    };
    const permissionsResolver = {
      hasPermission: jest.fn().mockResolvedValue(hasPermission),
    };
    const controller = new StoreOrdersController(
      storeOrdersService as never,
      permissionsResolver as never,
    );
    return { controller, storeOrdersService, permissionsResolver };
  }

  it('passes includeProfitability=false to the service when the caller requests it but lacks the permission', async () => {
    const { controller, storeOrdersService, permissionsResolver } =
      makeController(false);

    await controller.findAll(
      { includeProfitability: true },
      {
        sub: 'user-1',
        email: 'a@b.com',
      },
    );

    expect(permissionsResolver.hasPermission).toHaveBeenCalledWith(
      'user-1',
      'orders.profitability.view',
    );
    expect(storeOrdersService.findAll).toHaveBeenCalledWith(
      expect.anything(),
      'user-1',
      false,
    );
  });

  it('passes includeProfitability=true only when both requested AND authorized', async () => {
    const { controller, storeOrdersService } = makeController(true);

    await controller.findAll(
      { includeProfitability: true },
      {
        sub: 'user-1',
        email: 'a@b.com',
      },
    );

    expect(storeOrdersService.findAll).toHaveBeenCalledWith(
      expect.anything(),
      'user-1',
      true,
    );
  });

  it('never checks the permission, and never requests profitability, when the caller did not ask for it', async () => {
    const { controller, storeOrdersService, permissionsResolver } =
      makeController(true);

    await controller.findAll(
      { includeProfitability: false },
      {
        sub: 'user-1',
        email: 'a@b.com',
      },
    );

    expect(permissionsResolver.hasPermission).not.toHaveBeenCalled();
    expect(storeOrdersService.findAll).toHaveBeenCalledWith(
      expect.anything(),
      'user-1',
      false,
    );
  });
});
