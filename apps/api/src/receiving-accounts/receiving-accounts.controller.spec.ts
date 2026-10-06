import { PERMISSION_ACTION_KEY } from '../auth/decorators/permission-action.decorator';
import { ReceivingAccountsController } from './receiving-accounts.controller';

/** Restore is the other half of the soft-delete: it needs the same `delete` right as Archive. */
describe('ReceivingAccountsController permissions', () => {
  const actionOf = (method: keyof ReceivingAccountsController) =>
    Reflect.getMetadata(
      PERMISSION_ACTION_KEY,
      Object.getOwnPropertyDescriptor(
        ReceivingAccountsController.prototype,
        method,
      )?.value as object,
    ) as unknown;

  it('archive, legacy delete and restore all require receiving-accounts.delete', () => {
    expect(actionOf('archive')).toBe('delete');
    expect(actionOf('remove')).toBe('delete');
    expect(actionOf('restore')).toBe('delete');
  });
});
