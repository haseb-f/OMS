import { computeEffectivePermissions } from './effective-permissions';
import { AGENT_ROLE_PRESETS } from './permission-catalog';

/** R14 W2 (spec-2 §A) — effective = expand((template ∪ GRANT) − DENY) − DENY. */
describe('computeEffectivePermissions', () => {
  const internal = (
    template: string[],
    grants: string[] = [],
    denies: string[] = [],
  ) =>
    computeEffectivePermissions({
      isAgentUser: false,
      template,
      grants,
      denies,
    });

  it('inherits the job-title template, implications included', () => {
    const effective = internal(['products.create']);
    expect(effective.has('products.create')).toBe(true);
    expect(effective.has('products.view')).toBe(true);
  });

  it('adds individual GRANTs to the template', () => {
    const effective = internal(['products.create'], ['shipping.view']);
    expect(effective.has('products.create')).toBe(true);
    expect(effective.has('shipping.view')).toBe(true);
  });

  it('a DENY beats an inherited grant AND the permissions implied by it', () => {
    const effective = internal(['products.create'], [], ['products.create']);
    expect(effective.has('products.create')).toBe(false);
    expect(effective.has('products.view')).toBe(false);
  });

  it('R16 — creating store orders implies importing them; a DENY still revokes the import', () => {
    expect(internal(['store-orders.create']).has('store-orders.import')).toBe(
      true,
    );
    expect(internal(['store-orders.view']).has('store-orders.import')).toBe(
      false,
    );
    const denied = internal(
      ['store-orders.create'],
      [],
      ['store-orders.import'],
    );
    expect(denied.has('store-orders.create')).toBe(true);
    expect(denied.has('store-orders.import')).toBe(false);
  });

  it('R16 — an agent SALES preset carries order import', () => {
    const effective = computeEffectivePermissions({
      isAgentUser: true,
      agentRole: 'SALES',
      template: [],
      grants: AGENT_ROLE_PRESETS.SALES,
      denies: [],
    });
    expect(effective.has('agent.orders.import')).toBe(true);
    expect(effective.has('agent.leads.import')).toBe(false);
  });

  it('a DENY on an implied key wins while its source stays granted', () => {
    const effective = internal(['products.create'], [], ['products.view']);
    expect(effective.has('products.create')).toBe(true);
    expect(effective.has('products.view')).toBe(false);
  });

  it('a DENY also beats an individual GRANT of the same key', () => {
    const effective = internal([], ['shipping.edit'], ['shipping.edit']);
    expect(effective.has('shipping.edit')).toBe(false);
  });

  it('a DENY removes a settings-domain expansion', () => {
    const effective = internal(
      ['settings.general.manage'],
      [],
      ['masterdata.job-titles.create'],
    );
    expect(effective.has('settings.general.manage')).toBe(true);
    expect(effective.has('masterdata.job-titles.edit')).toBe(true);
    expect(effective.has('masterdata.job-titles.create')).toBe(false);
  });

  it('agent users ignore templates and DENY rows (agent presets only)', () => {
    const effective = computeEffectivePermissions({
      isAgentUser: true,
      agentRole: 'SALES',
      template: ['products.create'],
      grants: ['agent.leads.view', 'agent.team.manage', 'products.view'],
      denies: ['agent.leads.view'],
    });
    expect([...effective]).toEqual(['agent.leads.view']);
  });

  it('internal users never hold agent portal permissions, even from a template', () => {
    const effective = internal(['agent.leads.view', 'products.view']);
    expect(effective.has('agent.leads.view')).toBe(false);
    expect(effective.has('products.view')).toBe(true);
  });

  it('with an empty template and no DENY rows it equals the pre-R14 formula input', () => {
    const effective = internal([], ['store-orders.view']);
    expect(effective.has('store-orders.view')).toBe(true);
    expect(effective.has('sales.view')).toBe(true);
  });
});
