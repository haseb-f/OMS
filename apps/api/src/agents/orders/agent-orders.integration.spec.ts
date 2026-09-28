import { Test, type TestingModule } from '@nestjs/testing';
import {
  HttpException,
  ValidationPipe,
  type INestApplication,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Server } from 'http';
import request from 'supertest';
import { randomUUID } from 'crypto';
import {
  LeadSource,
  PartnerRoleType,
  StoreOrderFulfillmentMethod,
} from '@prisma/client';
import { PrismaModule } from '../../prisma/prisma.module';
import { PrismaService } from '../../prisma/prisma.service';
import { PermissionsCoreModule } from '../../permissions/permissions-core.module';
import { PermissionsResolverService } from '../../permissions/permissions-resolver.service';
import { PhoneModule } from '../../common/phone/phone.module';
import { AuthModule } from '../../auth/auth.module';
import { PostingProvidersModule } from '../../accounting/posting-providers/posting-providers.module';
import { FxModule } from '../../accounting/fx/fx.module';
import { StoreOrdersService } from '../../store-orders/store-orders.service';
import { computeStoreOrderSettlement } from '../../store-orders/store-order-payment-settlement.util';
import { ProductsService } from '../../products/products.service';
import { InventoryService } from '../../inventory/inventory.service';
import { WorkflowEngineService } from '../../workflow/workflow-engine.service';
import { LeadAssignmentsService } from '../../leads/assignments/lead-assignments.service';
import { LeadAutoDistributionService } from '../../leads/distribution/lead-auto-distribution.service';
import { evaluateFulfillmentGate } from '../../store-orders/store-order-fulfillment-gate';
import type { AgentRequestContext } from '../../auth/guards/jwt-auth.guard';
import { AgentsAdminModule } from '../admin/agents-admin.module';
import { AgentsService } from '../admin/agents.service';
import {
  AgentAgreementsService,
  resolveActiveAgreement,
} from '../admin/agent-agreements.service';
import { AgentDestinationsService } from '../admin/agent-destinations.service';
import {
  AgentTeamService,
  AgentUsersService,
} from '../admin/agent-users.service';
import { AgentOrdersModule } from './agent-orders.module';
import { AgentOrdersService } from './agent-orders.service';
import { AgentLeadsService } from './agent-leads.service';
import type { CreateAgreementDto } from '../admin/dto/agreement.dto';
import type { CreateAgentOrderDto } from './dto/agent-order.dto';
import { LeadsService } from '../../leads/leads.service';
import { OrderEconomicsService } from '../../store-orders/order-economics/order-economics.service';
import { assertActiveProduct } from '../../products/assert-active-product.util';
import { eligibleStoreOrderWhere } from '../../investment-sales/shared/allocation-eligibility.util';
import { AllExceptionsFilter } from '../../common/errors/all-exceptions.filter';

async function expectCode(promise: Promise<unknown>, code: string) {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(HttpException);
  expect((caught as HttpException).getResponse()).toMatchObject({ code });
}

/**
 * Agents milestone B1 — agreements, product ownership, agent orders
 * (pricing/shipping/owner rules), declarations with destinations, lead
 * separation and internal list filters. Real local Postgres, tagged
 * fixtures (left tagged like the other integration specs).
 */
describe('Agents B1 — admin + orders (integration)', () => {
  jest.setTimeout(300_000);
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let resolver: PermissionsResolverService;
  let agents: AgentsService;
  let agreements: AgentAgreementsService;
  let destinations: AgentDestinationsService;
  let agentUsers: AgentUsersService;
  let team: AgentTeamService;
  let orders: AgentOrdersService;
  let agentLeads: AgentLeadsService;
  let storeOrders: StoreOrdersService;
  let products: ProductsService;
  let inventory: InventoryService;
  let workflow: WorkflowEngineService;
  let leadAssignments: LeadAssignmentsService;
  let distribution: LeadAutoDistributionService;

  const tag = randomUUID().slice(0, 6).toUpperCase();
  const lower = tag.toLowerCase();
  let adminId: string; // internal super admin
  let clerkId: string; // internal: store-orders.create + agents.view only
  let currencyId: string;
  let otherCurrencyId: string;
  let egId: string;
  let noRateCountryId: string;
  let categoryId: string;
  let unitId: string;
  let warehouseId: string;
  let agentId: string;
  let agentBId: string;
  let agreementId: string;
  let physicalId: string; // agent-owned inventory product
  let serviceId: string; // agent-owned digital/service product
  let companyProductId: string;
  let agentBProductId: string;
  let companyDestinationId: string;
  let paymentMethodId: string;
  let salesCtx: AgentRequestContext;
  let adminCtx: AgentRequestContext;
  let phoneSeq = 0;

  const phone = () =>
    `+2010${String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0')}${String(++phoneSeq % 100).padStart(2, '0')}`;

  const terms = (
    over: Partial<CreateAgreementDto> = {},
  ): CreateAgreementDto => ({
    effectiveFrom: '2020-01-01',
    commissionRatePercent: 10,
    commissionEarningEvent: 'DELIVERED',
    returnCommissionTreatment: 'REVERSE',
    customerShippingChargeOwner: 'COMPANY',
    providerFeesBorneBy: 'AGENT',
    shippingFeePerShipment: 15,
    returnFeePerShipment: 20,
    serviceFeePerOrder: 0,
    allowAgentDestinations: false,
    payoutHoldDays: 7,
    ...over,
  });

  const makeProduct = async (
    suffix: string,
    opts: { owner?: string | null; inventory?: boolean } = {},
  ) =>
    (
      await prisma.product.create({
        data: {
          sku: `AGT-${tag}-${suffix}`,
          name: `Agent Test ${suffix} ${tag}`,
          internalName: `Agent Test ${suffix}`,
          displayName: `Agent Test ${suffix}`,
          categoryId,
          unitId,
          type: opts.inventory === false ? 'SERVICE' : 'PURCHASE_AND_SALE',
          isPurchasable: opts.inventory !== false,
          isSellable: true,
          isInventoryItem: opts.inventory !== false,
          salesPrice: 600,
          ownerAgentId: opts.owner ?? null,
        },
      })
    ).id;

  const orderInput = (
    over: Partial<CreateAgentOrderDto> = {},
  ): CreateAgentOrderDto => ({
    pricingMode: 'SHIPPING_ADDED',
    lines: [{ productId: physicalId, quantity: 2, lineAmount: 1000 }],
    fulfillmentMethod: 'SHIPPING',
    paymentType: 'PREPAID',
    countryId: egId,
    customer: {
      name: `Agent Customer ${tag}`,
      mobile: phone(),
      countryId: egId,
    },
    ...over,
  });

  const grant = async (userId: string, names: string[]) => {
    for (const name of names) {
      const permission = await prisma.permission.upsert({
        where: { name },
        create: { name },
        update: {},
      });
      await prisma.userPermission.upsert({
        where: {
          userId_permissionId: { userId, permissionId: permission.id },
        },
        create: { userId, permissionId: permission.id },
        update: {},
      });
    }
    resolver.invalidate(userId);
  };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        PrismaModule,
        PermissionsCoreModule,
        PhoneModule,
        AuthModule,
        PostingProvidersModule,
        FxModule,
        AgentsAdminModule,
        AgentOrdersModule,
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    resolver = moduleRef.get(PermissionsResolverService);
    agents = moduleRef.get(AgentsService);
    agreements = moduleRef.get(AgentAgreementsService);
    destinations = moduleRef.get(AgentDestinationsService);
    agentUsers = moduleRef.get(AgentUsersService);
    team = moduleRef.get(AgentTeamService);
    orders = moduleRef.get(AgentOrdersService);
    agentLeads = moduleRef.get(AgentLeadsService);
    storeOrders = moduleRef.get(StoreOrdersService, { strict: false });
    products = moduleRef.get(ProductsService, { strict: false });
    inventory = moduleRef.get(InventoryService, { strict: false });
    workflow = moduleRef.get(WorkflowEngineService, { strict: false });
    leadAssignments = moduleRef.get(LeadAssignmentsService, { strict: false });
    distribution = moduleRef.get(LeadAutoDistributionService, {
      strict: false,
    });

    adminId = (
      await prisma.user.create({
        data: {
          email: `agt-admin-${lower}@test.local`,
          username: `agt-admin-${lower}`,
          fullName: `Agents Admin ${tag}`,
          passwordHash: 'x',
          isSuperAdmin: true,
        },
      })
    ).id;
    clerkId = (
      await prisma.user.create({
        data: {
          email: `agt-clerk-${lower}@test.local`,
          username: `agt-clerk-${lower}`,
          fullName: `Agents Clerk ${tag}`,
          passwordHash: 'x',
        },
      })
    ).id;
    await grant(clerkId, ['store-orders.create', 'agents.view']);

    currencyId = (
      await prisma.currency.create({
        data: { code: `A${tag}`, name: `Agent Test ${tag}` },
      })
    ).id;
    otherCurrencyId = (
      await prisma.currency.create({
        data: { code: `B${tag}`, name: `Agent Test Other ${tag}` },
      })
    ).id;
    const eg = await prisma.country.findFirst({ where: { code: 'EG' } });
    if (!eg) throw new Error('Expected country EG in the local database.');
    egId = eg.id;
    const other = await prisma.country.findFirst({
      where: { code: { not: 'EG' }, deletedAt: null },
    });
    noRateCountryId = other!.id;
    categoryId = (
      await prisma.productCategory.create({
        data: { name: `agt-${tag}-category` },
      })
    ).id;
    unitId = (await prisma.unit.create({ data: { name: `agt-${tag}-unit` } }))
      .id;
    warehouseId = (
      await prisma.warehouse.create({
        data: { code: `AGT-${tag}`, name: `Agent WH ${tag}` },
      })
    ).id;
    paymentMethodId = (
      await prisma.paymentMethod.create({
        data: { name: `Agent Method ${tag}`, requiresReconciliation: false },
      })
    ).id;

    agentId = (
      await agents.create(
        {
          name: `Agent A ${tag}`,
          email: `agent-a-${lower}@test.local`,
          currencyId,
        },
        adminId,
      )
    ).id;
    agentBId = (
      await agents.create(
        {
          name: `Agent B ${tag}`,
          email: `agent-b-${lower}@test.local`,
          currencyId,
        },
        adminId,
      )
    ).id;

    agreementId = (await agreements.create(agentId, terms(), adminId)).id;
    await agreements.upsertShippingRate(agentId, agreementId, {
      countryId: egId,
      amount: 100,
    });
    await agreements.upsertShippingRate(agentId, agreementId, {
      countryId: egId,
      city: 'Cairo',
      amount: 60,
    });
    await agreements.activate(agentId, agreementId, adminId);
    const agreementB = await agreements.create(agentBId, terms(), adminId);
    await agreements.activate(agentBId, agreementB.id, adminId);

    physicalId = await makeProduct('PHY', { owner: agentId });
    serviceId = await makeProduct('SVC', { owner: agentId, inventory: false });
    companyProductId = await makeProduct('CO');
    agentBProductId = await makeProduct('BPHY', { owner: agentBId });

    companyDestinationId = (
      await destinations.create(
        agentId,
        { paymentMethodId, ownership: 'COMPANY', label: 'Company account' },
        adminId,
      )
    ).id;

    const sales = await agentUsers.create(
      agentId,
      {
        email: `agent-sales-${lower}@test.local`,
        username: `agent-sales-${lower}`,
        fullName: `Agent Sales ${tag}`,
        agentRole: 'SALES',
      },
      adminId,
    );
    salesCtx = { userId: sales.id, agentId, agentRole: 'SALES' };
    const admin = await agentUsers.create(
      agentId,
      {
        email: `agent-admin-${lower}@test.local`,
        username: `agent-admin-${lower}`,
        fullName: `Agent Admin ${tag}`,
        agentRole: 'ADMIN',
        extraPermissions: ['agent.team.manage'],
      },
      adminId,
    );
    adminCtx = { userId: admin.id, agentId, agentRole: 'ADMIN' };
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  describe('agent + users', () => {
    it('creates the agent with an AGENT-role partner and a generated number', async () => {
      const agent = await agents.findOne(agentId);
      expect(agent.agentNumber).toMatch(/^AG-/);
      const roles = await prisma.partnerRoleAssignment.findMany({
        where: { partnerId: agent.partnerId },
      });
      expect(roles.map((r) => r.role)).toContain(PartnerRoleType.AGENT);
      expect(agent.activeAgreement?.id).toBe(agreementId);
    });

    it('agent users are AGENT type with preset agent.* permissions only', async () => {
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: salesCtx.userId },
      });
      expect(user).toMatchObject({
        userType: 'AGENT',
        agentId,
        agentRole: 'SALES',
        mustChangePassword: true,
        isSuperAdmin: false,
      });
      const perms = await resolver.getPermissions(salesCtx.userId);
      expect(perms.has('agent.orders.create')).toBe(true);
      expect(perms.has('agent.team.manage')).toBe(false);
      await expectCode(
        agentUsers.setPermissions(agentId, salesCtx.userId, [
          'store-orders.create' as never,
        ]),
        'AGENT_USER_INTERNAL_PERMISSION',
      );
    });

    it('Agent Admin delegation: only own permissions, never team.manage, never self', async () => {
      await expectCode(
        team.createSalesUser(adminCtx, {
          email: `agent-s2-${lower}@test.local`,
          username: `agent-s2-${lower}`,
          fullName: 'Delegated',
          permissionNames: ['agent.orders.override_shipping'],
        }),
        'AGENT_DELEGATION_EXCEEDED',
      );
      await expectCode(
        team.createSalesUser(adminCtx, {
          email: `agent-s3-${lower}@test.local`,
          username: `agent-s3-${lower}`,
          fullName: 'Delegated',
          permissionNames: ['agent.team.manage'],
        }),
        'AGENT_DELEGATION_EXCEEDED',
      );
      const created = await team.createSalesUser(adminCtx, {
        email: `agent-s4-${lower}@test.local`,
        username: `agent-s4-${lower}`,
        fullName: 'Delegated OK',
      });
      expect(created.agentRole).toBe('SALES');
      expect(created.agentId).toBe(agentId);
      await expectCode(
        team.setSalesUserActive(adminCtx, adminCtx.userId, false),
        'AGENT_TEAM_SELF',
      );
      await expectCode(
        team.setSalesUserActive(
          { ...salesCtx, userId: created.id },
          salesCtx.userId,
          false,
        ),
        'AGENT_PERMISSION_REQUIRED',
      );
    });
  });

  describe('agreements', () => {
    it('ACTIVE terms and rates are immutable', async () => {
      await expectCode(
        agreements.update(
          agentId,
          agreementId,
          { commissionRatePercent: 20 },
          adminId,
        ),
        'AGREEMENT_IMMUTABLE',
      );
      await expectCode(
        agreements.upsertShippingRate(agentId, agreementId, {
          countryId: egId,
          amount: 1,
        }),
        'AGREEMENT_IMMUTABLE',
      );
    });

    it('rejects an overlapping activation and a foreign currency', async () => {
      const overlap = await agreements.create(
        agentId,
        terms({ effectiveFrom: '2030-01-01' }),
        adminId,
      );
      await expectCode(
        agreements.activate(agentId, overlap.id, adminId),
        'AGREEMENT_OVERLAP',
      );
      await expectCode(
        agreements.create(
          agentId,
          terms({ currencyId: otherCurrencyId }),
          adminId,
        ),
        'CURRENCY_MISMATCH',
      );
    });

    it('effective dating: resolves the agreement in force on each date', async () => {
      const agent = await agents.create(
        {
          name: `Agent Dates ${tag}`,
          email: `agent-d-${lower}@test.local`,
          currencyId,
        },
        adminId,
      );
      const first = await agreements.create(
        agent.id,
        terms({ effectiveFrom: '2020-01-01', effectiveTo: '2020-12-31' }),
        adminId,
      );
      await agreements.activate(agent.id, first.id, adminId);
      const second = await agreements.create(
        agent.id,
        terms({ effectiveFrom: '2021-01-01', commissionRatePercent: 12.5 }),
        adminId,
      );
      await agreements.activate(agent.id, second.id, adminId);
      const at = (date: Date) => resolveActiveAgreement(agent.id, date, prisma);
      expect((await at(new Date('2020-06-15')))?.id).toBe(first.id);
      expect((await at(new Date()))?.id).toBe(second.id);
      const ended = await agreements.end(
        agent.id,
        second.id,
        { effectiveTo: '2022-12-31' },
        adminId,
      );
      expect(ended.status).toBe('ENDED');
      expect(await at(new Date())).toBeNull();
      expect((await at(new Date('2022-06-01')))?.id).toBe(second.id);
    });

    it('AGENT-owned destinations need an agreement that allows them', async () => {
      await expectCode(
        destinations.create(
          agentId,
          { paymentMethodId, ownership: 'AGENT', label: 'Agent wallet' },
          adminId,
        ),
        'AGENT_DESTINATIONS_NOT_ALLOWED',
      );
    });
  });

  describe('product ownership + stock', () => {
    it('owner is settable until the first movement, then locked; movements stamp the owner', async () => {
      const id = await makeProduct('LOCK');
      await products.update(id, { ownerAgentId: agentId }, adminId);
      await inventory.openingBalance(
        { productId: id, warehouseId, quantity: 5 },
        adminId,
      );
      const movement = await prisma.inventoryMovement.findFirstOrThrow({
        where: { productId: id },
      });
      expect(movement.ownerAgentId).toBe(agentId);
      await expectCode(
        products.update(id, { ownerAgentId: agentBId }, adminId),
        'PRODUCT_OWNER_LOCKED',
      );
      const stock = await inventory.getAgentStock(agentId, { productId: id });
      expect(stock.items).toHaveLength(1);
      expect(stock.items[0]).toMatchObject({
        onHand: 5,
        reserved: 0,
        available: 5,
        shipped: 0,
        returned: 0,
      });
    });

    it('owner agent must be active', async () => {
      const id = await makeProduct('INACT');
      const inactive = await agents.create(
        {
          name: `Agent Inactive ${tag}`,
          email: `agent-i-${lower}@test.local`,
          currencyId,
        },
        adminId,
      );
      await agents.setStatus(inactive.id, 'INACTIVE', adminId);
      await expectCode(
        products.update(id, { ownerAgentId: inactive.id }, adminId),
        'AGENT_NOT_ACTIVE',
      );
    });

    it('the picker catalog hides agent goods unless an agent is chosen', async () => {
      const company = await products.findSellableCatalog({
        ids: [physicalId, companyProductId],
      });
      expect(company.items.map((p) => p.id)).toEqual([companyProductId]);
      const agentCatalog = await products.findSellableCatalog({
        ids: [physicalId, companyProductId],
        agentId,
      });
      expect(agentCatalog.items.map((p) => p.id)).toEqual([physicalId]);
    });

    it('company store orders refuse agent-owned products', async () => {
      await expectCode(
        storeOrders.create(
          {
            partner: { name: `Co ${tag}`, mobile: phone(), countryId: egId },
            currencyId,
            items: [{ productId: physicalId, quantity: 1, unitPrice: 10 }],
          },
          adminId,
        ),
        'AGENT_PRODUCT_IN_COMPANY_DOCUMENT',
      );
    });
  });

  describe('agent orders', () => {
    let addedOrderId: string;

    it('rejects mixed owners and company products', async () => {
      await expectCode(
        orders.createAgentOrder(
          orderInput({
            lines: [
              { productId: physicalId, quantity: 1, lineAmount: 500 },
              { productId: companyProductId, quantity: 1, lineAmount: 500 },
            ],
          }),
          { userId: adminId },
        ),
        'MIXED_OWNER_ORDER',
      );
      await expectCode(
        orders.createAgentOrder(
          orderInput({
            lines: [
              { productId: physicalId, quantity: 1, lineAmount: 500 },
              { productId: agentBProductId, quantity: 1, lineAmount: 500 },
            ],
          }),
          { userId: adminId },
        ),
        'MIXED_OWNER_ORDER',
      );
    });

    it('an agent user cannot order another agent’s product', async () => {
      await expectCode(
        orders.createAgentOrder(
          orderInput({
            lines: [{ productId: agentBProductId, quantity: 1, lineAmount: 5 }],
          }),
          { userId: salesCtx.userId, agent: salesCtx },
        ),
        'PRODUCT_NOT_AVAILABLE',
      );
    });

    it('shipping added: 1,000 + 100 = 1,100 persisted with snapshot (agent user owns it)', async () => {
      const quote = await orders.quote(orderInput(), {
        userId: salesCtx.userId,
        agent: salesCtx,
      });
      expect(quote.valid).toBe(true);
      expect(quote.shipping).toMatchObject({
        rate: 100,
        source: 'RATE',
        rateScope: 'COUNTRY',
      });
      expect(quote.breakdown?.payableTotal).toBe(1100);

      const order = await orders.createAgentOrder(orderInput(), {
        userId: salesCtx.userId,
        agent: salesCtx,
      });
      addedOrderId = order.id;
      expect(order).toMatchObject({
        agentId,
        agentAgreementId: agreementId,
        employeeId: salesCtx.userId,
        pricingMode: 'SHIPPING_ADDED',
        shippingChargeSource: 'RATE',
        total: '1100.00',
      });
      expect(Number(order.merchandiseAmount)).toBe(1000);
      expect(Number(order.shippingCharge)).toBe(100);
      expect(Number(order.shippingRateAmount)).toBe(100);
      expect(Number(order.taxAmount)).toBe(0);
      expect(Number(order.payableTotal)).toBe(1100);
      expect(Number(order.discountAmount)).toBe(200); // list 600 × 2 − 1,000
      expect(Number(order.items[0].agreedAmount)).toBe(1000);
      expect(order.agent).toMatchObject({ id: agentId });
      expect(order.agentTermsSnapshot).toMatchObject({
        agreementId,
        commissionRatePercent: 10,
        allowAgentDestinations: false,
      });
    });

    it('shipping included: the city rate wins (1,000 incl. 60 ⇒ 940 + 60)', async () => {
      const order = await orders.createAgentOrder(
        orderInput({
          pricingMode: 'SHIPPING_INCLUDED',
          agreedTotal: 1000,
          city: ' cairo ',
          lines: [
            { productId: physicalId, quantity: 1 },
            { productId: physicalId, quantity: 2 },
          ],
        }),
        { userId: adminId },
      );
      expect(Number(order.payableTotal)).toBe(1000);
      expect(Number(order.shippingCharge)).toBe(60);
      expect(Number(order.merchandiseAmount)).toBe(940);
      const lineSum = order.items.reduce(
        (sum, item) => sum + Number(item.agreedAmount),
        0,
      );
      expect(lineSum).toBeCloseTo(940, 2);
      expect(order.total).toBe('1000.00');
    });

    it('missing rate is blocked; an override needs permission + reason and is audited', async () => {
      await expectCode(
        orders.createAgentOrder(orderInput({ countryId: noRateCountryId }), {
          userId: adminId,
        }),
        'SHIPPING_RATE_REQUIRED',
      );
      await expectCode(
        orders.createAgentOrder(
          orderInput({
            countryId: noRateCountryId,
            shippingChargeOverride: 80,
          }),
          { userId: clerkId },
        ),
        'SHIPPING_OVERRIDE_NOT_ALLOWED',
      );
      await expectCode(
        orders.createAgentOrder(orderInput({ shippingChargeOverride: 80 }), {
          userId: salesCtx.userId,
          agent: salesCtx,
        }),
        'SHIPPING_OVERRIDE_NOT_ALLOWED',
      );
      await expectCode(
        orders.createAgentOrder(
          orderInput({
            countryId: noRateCountryId,
            shippingChargeOverride: 80,
          }),
          { userId: adminId },
        ),
        'SHIPPING_OVERRIDE_REASON_REQUIRED',
      );
      const order = await orders.createAgentOrder(
        orderInput({
          countryId: noRateCountryId,
          shippingChargeOverride: 80,
          shippingOverrideReason: 'Remote area',
        }),
        { userId: adminId },
      );
      expect(order.shippingChargeSource).toBe('MANUAL');
      expect(order.shippingRateAmount).toBeNull();
      expect(Number(order.payableTotal)).toBe(1080);
      const audit = await prisma.storeOrderActivity.findFirst({
        where: { storeOrderId: order.id, action: 'AGENT_SHIPPING_OVERRIDE' },
      });
      expect(audit?.details).toContain('Remote area');
      // The clerk (store-orders.create + agents.view) may create at the rate.
      const clerkOrder = await orders.createAgentOrder(orderInput(), {
        userId: clerkId,
      });
      expect(clerkOrder.shippingChargeSource).toBe('RATE');
    });

    it('pickup and digital-only orders carry no shipping', async () => {
      const pickup = await orders.createAgentOrder(
        orderInput({ fulfillmentMethod: 'PICKUP', countryId: undefined }),
        { userId: adminId },
      );
      expect(pickup).toMatchObject({
        fulfillmentMethod: StoreOrderFulfillmentMethod.PICKUP,
        shippingChargeSource: 'NONE',
      });
      expect(Number(pickup.payableTotal)).toBe(1000);
      const digital = await orders.createAgentOrder(
        orderInput({
          countryId: undefined,
          lines: [{ productId: serviceId, quantity: 1, lineAmount: 300 }],
        }),
        { userId: adminId },
      );
      expect(digital.shippingChargeSource).toBe('NONE');
      expect(digital.shippingStage).toBe('NOT_READY');
      expect(Number(digital.payableTotal)).toBe(300);
    });

    it('currency must equal the agreement currency; the key makes submits idempotent', async () => {
      await expectCode(
        orders.createAgentOrder(orderInput({ currencyId: otherCurrencyId }), {
          userId: adminId,
        }),
        'CURRENCY_MISMATCH',
      );
      const key = randomUUID();
      const first = await orders.createAgentOrder(
        orderInput({ idempotencyKey: key }),
        { userId: adminId },
      );
      const again = await orders.createAgentOrder(
        orderInput({ idempotencyKey: key }),
        { userId: adminId },
      );
      expect(again.id).toBe(first.id);
    });

    it('declarations: full = payable incl. shipping, destination rules, partial never opens the gate', async () => {
      const today = new Date().toISOString();
      await expectCode(
        orders.declareAgentOrderPayment(
          addedOrderId,
          { kind: 'FULL', paymentDate: today, idempotencyKey: randomUUID() },
          { userId: salesCtx.userId, agent: salesCtx },
        ),
        'AGENT_DESTINATION_REQUIRED',
      );
      const foreign = await destinations.create(
        agentBId,
        { paymentMethodId, ownership: 'COMPANY', label: 'B account' },
        adminId,
      );
      await expectCode(
        orders.declareAgentOrderPayment(
          addedOrderId,
          {
            kind: 'FULL',
            destinationId: foreign.id,
            paymentDate: today,
            idempotencyKey: randomUUID(),
          },
          { userId: salesCtx.userId, agent: salesCtx },
        ),
        'AGENT_DESTINATION_INVALID',
      );

      const partial = await orders.declareAgentOrderPayment(
        addedOrderId,
        {
          kind: 'PARTIAL',
          amount: 500,
          destinationId: companyDestinationId,
          paymentDate: today,
          idempotencyKey: randomUUID(),
        },
        { userId: salesCtx.userId, agent: salesCtx },
      );
      expect(partial.declaredPaymentStatus).toBe('PARTIALLY_PAID');
      let order = await storeOrders.findOne(addedOrderId);
      const gate = () =>
        evaluateFulfillmentGate({
          paymentType: order.paymentType,
          declaredPaymentStatus: order.declaredPaymentStatus,
          paymentStatus: order.paymentStatus,
        }).allowed;
      expect(gate()).toBe(false);
      await expect(
        orders.declareAgentOrderPayment(
          addedOrderId,
          {
            kind: 'PARTIAL',
            amount: 700,
            destinationId: companyDestinationId,
            paymentDate: today,
            idempotencyKey: randomUUID(),
          },
          { userId: salesCtx.userId, agent: salesCtx },
        ),
      ).rejects.toThrow(/exceeds the remaining 600.00/);

      const fullKey = randomUUID();
      const full = await orders.declareAgentOrderPayment(
        addedOrderId,
        {
          kind: 'FULL',
          destinationId: companyDestinationId,
          paymentDate: today,
          idempotencyKey: fullKey,
        },
        { userId: salesCtx.userId, agent: salesCtx },
      );
      expect(Number(full.payment?.amount)).toBe(600);
      expect(full.payment).toMatchObject({
        agentId,
        destinationOwnership: 'COMPANY',
        agentPaymentDestinationId: companyDestinationId,
        paymentMethodId,
      });
      expect(full.declaredPaymentStatus).toBe('PAID');
      expect(full.declaredAmount).toBe('1100.00');
      const replay = await orders.declareAgentOrderPayment(
        addedOrderId,
        {
          kind: 'FULL',
          destinationId: companyDestinationId,
          paymentDate: today,
          idempotencyKey: fullKey,
        },
        { userId: salesCtx.userId, agent: salesCtx },
      );
      expect(replay.created).toBe(false);
      expect(replay.payment?.id).toBe(full.payment?.id);
      order = await storeOrders.findOne(addedOrderId);
      expect(gate()).toBe(true);
      const settlement = await computeStoreOrderSettlement(
        prisma,
        addedOrderId,
      );
      expect(settlement.total).toBe(1100);
    });

    it('agent orders cannot generate a company invoice or change line prices', async () => {
      await expectCode(
        storeOrders.generateInvoice(addedOrderId, adminId),
        'AGENT_ORDER_NO_COMPANY_INVOICE',
      );
      await expectCode(
        storeOrders.setLineAmounts(addedOrderId, { items: [] }, adminId),
        'AGENT_ORDER_PRICING_LOCKED',
      );
    });

    it('internal lists filter by agent and carry the agent badge', async () => {
      const list = await storeOrders.findAll(
        { agentId, pageSize: 200 },
        adminId,
      );
      expect(list.items.length).toBeGreaterThan(0);
      expect(list.items.every((row) => row.agentId === agentId)).toBe(true);
      const row = list.items.find((item) => item.id === addedOrderId);
      expect(row?.agent).toMatchObject({ id: agentId });
      expect(row?.total).toBe('1100.00');
      const other = await storeOrders.findAll(
        { agentId: agentBId, pageSize: 200 },
        adminId,
      );
      expect(other.items.some((item) => item.id === addedOrderId)).toBe(false);
    });

    it('legacy company orders keep Σ-lines totals (payableTotal null)', async () => {
      const order = await storeOrders.create(
        {
          partner: { name: `Legacy ${tag}`, mobile: phone(), countryId: egId },
          currencyId,
          items: [
            { productId: companyProductId, quantity: 2, unitPrice: 150 },
            { productId: companyProductId, quantity: 1, unitPrice: 75.5 },
          ],
        },
        adminId,
      );
      expect(order.payableTotal).toBeNull();
      expect(order.agentId).toBeNull();
      expect(order.total).toBe('375.50');
      const settlement = await computeStoreOrderSettlement(prisma, order.id);
      expect(settlement.total).toBe(375.5);
    });
  });

  describe('agent leads', () => {
    let agentLeadId: string;

    beforeAll(async () => {
      const lead = await agentLeads.create(salesCtx, {
        customerName: `Agent Lead ${tag}`,
        mobileNumber: phone(),
        countryId: egId,
        productId: physicalId,
      });
      agentLeadId = lead.id;
    });

    it('is owned by the creating agent user and never distributed', async () => {
      const lead = await prisma.lead.findUniqueOrThrow({
        where: { id: agentLeadId },
      });
      expect(lead).toMatchObject({
        agentId,
        salesEmployeeId: salesCtx.userId,
        distributionHeld: false,
      });
      expect(await distribution.getEligibleEmployeeIds()).not.toContain(
        salesCtx.userId,
      );
      await prisma.lead.update({
        where: { id: agentLeadId },
        data: { salesEmployeeId: null },
      });
      await distribution.distribute(agentLeadId);
      const after = await prisma.lead.findUniqueOrThrow({
        where: { id: agentLeadId },
      });
      expect(after.salesEmployeeId).toBeNull();
      await leadAssignments.assign(agentLeadId, {
        salesEmployeeId: salesCtx.userId,
        method: 'MANUAL',
      });
    });

    it('assignment never crosses the agent boundary', async () => {
      await expectCode(
        leadAssignments.assign(agentLeadId, {
          salesEmployeeId: adminId,
          method: 'MANUAL',
        }),
        'AGENT_LEAD_ASSIGNMENT_SCOPE',
      );
      const companyLead = await prisma.lead.findFirst({
        where: { agentId: null, deletedAt: null },
        select: { id: true },
      });
      if (companyLead) {
        await expectCode(
          leadAssignments.assign(companyLead.id, {
            salesEmployeeId: salesCtx.userId,
            method: 'MANUAL',
          }),
          'AGENT_USER_NOT_ASSIGNABLE',
        );
      }
      await expectCode(
        agentLeads.assign(salesCtx, agentLeadId, adminCtx.userId),
        'AGENT_PERMISSION_REQUIRED',
      );
      const reassigned = await agentLeads.assign(
        adminCtx,
        agentLeadId,
        adminCtx.userId,
      );
      expect(reassigned.salesEmployeeId).toBe(adminCtx.userId);
      await agentLeads.assign(adminCtx, agentLeadId, salesCtx.userId);
    });

    it('the internal conversion refuses an agent lead; the agent path converts with the breakdown', async () => {
      await expectCode(
        workflow.convertLead(agentLeadId, adminId, {
          items: [{ productId: physicalId, quantity: 1, agreedAmount: 10 }],
        }),
        'AGENT_LEAD_REQUIRES_AGENT_ORDER',
      );
      const input = {
        pricingMode: 'SHIPPING_ADDED' as const,
        lines: [{ productId: physicalId, quantity: 1, lineAmount: 450 }],
        countryId: egId,
      };
      const order = await orders.convertAgentLead(
        agentLeadId,
        {
          ...input,
          declaration: {
            kind: 'FULL',
            destinationId: companyDestinationId,
            paymentDate: new Date().toISOString(),
          },
        },
        { userId: salesCtx.userId, agent: salesCtx },
      );
      expect(order).toMatchObject({
        agentId,
        leadId: agentLeadId,
        employeeId: salesCtx.userId,
        declaredPaymentStatus: 'PAID',
      });
      expect(Number(order.payableTotal)).toBe(550);
      expect(Number(order.declaredAmount)).toBe(550);
      const again = await orders.convertAgentLead(agentLeadId, input, {
        userId: salesCtx.userId,
        agent: salesCtx,
      });
      expect(again.id).toBe(order.id);
    });

    it('another agent never sees the lead', async () => {
      const outsider = await agentUsers.create(
        agentBId,
        {
          email: `agent-b-admin-${lower}@test.local`,
          username: `agent-b-admin-${lower}`,
          fullName: 'Outsider',
          agentRole: 'ADMIN',
        },
        adminId,
      );
      await expect(
        agentLeads.get(
          { userId: outsider.id, agentId: agentBId, agentRole: 'ADMIN' },
          agentLeadId,
        ),
      ).rejects.toThrow('Lead not found.');
    });
  });

  // ── Review fixes (S1, S2, S4, S7, S8, F-L5, F-L8, F-M3, F-M5) ───────────

  describe('review fixes', () => {
    const agentOrderBy = (
      ctx: AgentRequestContext,
      over: Partial<CreateAgentOrderDto> = {},
    ) =>
      orders.createAgentOrder(orderInput(over), {
        userId: ctx.userId,
        agent: ctx,
      });

    it('S1: an agent customer never adopts or updates a shared partner; dedup stays inside the agent', async () => {
      const mobile = phone();
      const company = await prisma.partner.create({
        data: {
          partnerNumber: `PT-S1-${tag}`,
          name: `Company Employee ${tag}`,
          mobile,
          phone: mobile,
          address: 'COMPANY ADDRESS',
          city: 'Company City',
          roles: { create: { role: PartnerRoleType.EMPLOYEE } },
        },
      });
      const typed = {
        name: `Typed Customer ${tag}`,
        mobile,
        countryId: egId,
        city: 'Giza',
        address: 'Agent typed address',
        // Not part of the agent customer shape — ignored.
        email: `leak-${lower}@test.local`,
        taxNumber: `TAX-${tag}`,
      } as CreateAgentOrderDto['customer'];
      const first = await agentOrderBy(salesCtx, { customer: typed });
      expect(first.partnerId).not.toBe(company.id);
      const untouched = await prisma.partner.findUniqueOrThrow({
        where: { id: company.id },
        include: { roles: true },
      });
      expect(untouched).toMatchObject({
        address: 'COMPANY ADDRESS',
        city: 'Company City',
      });
      expect(untouched.roles.map((r) => r.role)).toEqual(['EMPLOYEE']);
      const created = await prisma.partner.findUniqueOrThrow({
        where: { id: first.partnerId },
      });
      expect(created).toMatchObject({
        name: typed.name,
        email: null,
        taxNumber: null,
      });
      expect(first.agentTermsSnapshot).toMatchObject({
        customer: {
          name: typed.name,
          mobile,
          city: 'Giza',
          address: 'Agent typed address',
        },
        lines: [{ productId: physicalId, inventoryLine: true }],
      });

      // Same agent, same mobile → the agent's own customer is reused and
      // never rewritten (the new address lives on the new order only).
      const second = await agentOrderBy(salesCtx, {
        customer: { ...typed, address: 'Second address' },
      });
      expect(second.partnerId).toBe(first.partnerId);
      expect(
        (
          await prisma.partner.findUniqueOrThrow({
            where: { id: first.partnerId },
          })
        ).address,
      ).toBe('Agent typed address');

      // Another agent never lands on agent A's customer.
      const other = await orders.createAgentOrder(
        orderInput({
          lines: [{ productId: agentBProductId, quantity: 1, lineAmount: 50 }],
          fulfillmentMethod: 'PICKUP',
          customer: typed,
        }),
        { userId: adminId },
      );
      expect(other.agentId).toBe(agentBId);
      expect([first.partnerId, company.id]).not.toContain(other.partnerId);

      // Lead conversion follows the same rule.
      const lead = await agentLeads.create(salesCtx, {
        customerName: `Lead Customer ${tag}`,
        mobileNumber: mobile,
        countryId: egId,
        city: 'Alexandria',
      });
      const converted = await orders.convertAgentLead(
        lead.id,
        {
          pricingMode: 'SHIPPING_ADDED',
          lines: [{ productId: physicalId, quantity: 1, lineAmount: 100 }],
        },
        { userId: salesCtx.userId, agent: salesCtx },
      );
      expect(converted.partnerId).not.toBe(company.id);
      expect(converted.agentTermsSnapshot).toMatchObject({
        customer: { name: `Lead Customer ${tag}`, city: 'Alexandria' },
      });
      expect(
        (await prisma.partner.findUniqueOrThrow({ where: { id: company.id } }))
          .city,
      ).toBe('Company City');
    });

    it('F-M5: the customer city selects the rate and is what the order keeps', async () => {
      const order = await orders.createAgentOrder(
        orderInput({
          city: undefined,
          customer: {
            name: `City Customer ${tag}`,
            mobile: phone(),
            countryId: egId,
            city: 'Cairo',
          },
        }),
        { userId: adminId },
      );
      expect(Number(order.shippingCharge)).toBe(60);
      expect(order.agentTermsSnapshot).toMatchObject({
        customer: { city: 'Cairo' },
      });
    });

    it('S2: company leads, conversions and documents refuse agent goods; the owner locks on any reference', async () => {
      const leads = moduleRef.get(LeadsService, { strict: false });
      await expectCode(
        leads.create(
          {
            customerName: `Co Lead ${tag}`,
            mobileNumber: phone(),
            countryId: egId,
            productId: physicalId,
            source: LeadSource.MANUAL,
          },
          adminId,
        ),
        'AGENT_PRODUCT_IN_COMPANY_DOCUMENT',
      );
      const companyLead = await leads.create(
        {
          customerName: `Co Lead 2 ${tag}`,
          mobileNumber: phone(),
          countryId: egId,
          source: LeadSource.MANUAL,
        },
        adminId,
      );
      await expectCode(
        workflow.convertLead(companyLead.id, adminId, {
          items: [{ productId: physicalId, quantity: 1, agreedAmount: 10 }],
        }),
        'AGENT_PRODUCT_IN_COMPANY_DOCUMENT',
      );
      // Sales / purchase documents share assertActiveProduct.
      expect(() =>
        assertActiveProduct(
          physicalId,
          new Map([
            [
              physicalId,
              {
                id: physicalId,
                status: 'ACTIVE' as const,
                ownerAgentId: agentId,
              },
            ],
          ]),
        ),
      ).toThrow(HttpException);

      const referenced = await makeProduct('S2LOCK');
      await leads.create(
        {
          customerName: `Co Lead 3 ${tag}`,
          mobileNumber: phone(),
          countryId: egId,
          productId: referenced,
          source: LeadSource.MANUAL,
        },
        adminId,
      );
      await expectCode(
        products.update(referenced, { ownerAgentId: agentId }),
        'PRODUCT_OWNER_LOCKED',
      );
    });

    it('S8: agent lead duplicates are checked inside the agent only', async () => {
      const leads = moduleRef.get(LeadsService, { strict: false });
      const mobile = phone();
      const name = `Dup Lead ${tag}`;
      await leads.create(
        {
          customerName: name,
          mobileNumber: mobile,
          countryId: egId,
          source: LeadSource.MANUAL,
        },
        adminId,
      );
      // The company already has this contact: no 409 oracle for the agent.
      await agentLeads.create(salesCtx, {
        customerName: name,
        mobileNumber: mobile,
        countryId: egId,
      });
      // …but the agent's own duplicate is still refused.
      await expect(
        agentLeads.create(salesCtx, {
          customerName: name,
          mobileNumber: mobile,
          countryId: egId,
        }),
      ).rejects.toThrow('Duplicate Lead');
    });

    it('S4: order owners follow the affiliation rule', async () => {
      await expectCode(
        storeOrders.create(
          {
            partner: { name: `Co ${tag}`, mobile: phone(), countryId: egId },
            currencyId,
            employeeId: salesCtx.userId,
            items: [
              { productId: companyProductId, quantity: 1, unitPrice: 10 },
            ],
          },
          adminId,
        ),
        'AGENT_USER_NOT_ASSIGNABLE',
      );
      const internalCreated = await orders.createAgentOrder(orderInput(), {
        userId: adminId,
      });
      expect(internalCreated.employeeId).toBeNull();
      await expectCode(
        storeOrders.update(internalCreated.id, { employeeId: adminId }),
        'AGENT_ORDER_OWNER_SCOPE',
      );
      const reassigned = await storeOrders.update(internalCreated.id, {
        employeeId: salesCtx.userId,
      });
      expect(reassigned.employeeId).toBe(salesCtx.userId);
    });

    it('F-L5: an agent pickup is returned only through the agent return receipt', async () => {
      const pickup = await orders.createAgentOrder(
        orderInput({ fulfillmentMethod: 'PICKUP', countryId: undefined }),
        { userId: adminId },
      );
      await expectCode(
        storeOrders.transitionPickup(pickup.id, 'RETURNED', adminId),
        'AGENT_ORDER_USE_RETURN_RECEIPT',
      );
    });

    it('F-M3 / F-L8: agent orders are not company sales (economics, investor allocation)', async () => {
      const order = await orders.createAgentOrder(orderInput(), {
        userId: adminId,
      });
      const economics = moduleRef.get(OrderEconomicsService, { strict: false });
      await expectCode(
        economics.getForStoreOrder(order.id),
        'AGENT_ORDER_NO_COMPANY_ECONOMICS',
      );
      expect((await economics.getSummaryForOrders([order.id])).size).toBe(0);
      expect(eligibleStoreOrderWhere()).toMatchObject({ agentId: null });
    });

    it('S7: team.manage is Admin-only; a company deactivation cannot be undone by the Agent Admin', async () => {
      await expectCode(
        agentUsers.create(
          agentId,
          {
            email: `s7-sales-${lower}@test.local`,
            username: `s7-sales-${lower}`,
            fullName: `S7 Sales ${tag}`,
            agentRole: 'SALES',
            extraPermissions: ['agent.team.manage'],
          },
          adminId,
        ),
        'AGENT_TEAM_MANAGE_ADMIN_ONLY',
      );
      // A stray row never gives a SALES user the capability.
      await grant(salesCtx.userId, ['agent.team.manage']);
      expect(
        await resolver.hasPermission(salesCtx.userId, 'agent.team.manage'),
      ).toBe(false);
      await expectCode(
        team.setSalesUserActive(salesCtx, adminCtx.userId, false),
        'AGENT_PERMISSION_REQUIRED',
      );

      const target = await agentUsers.create(
        agentId,
        {
          email: `s7-target-${lower}@test.local`,
          username: `s7-target-${lower}`,
          fullName: `S7 Target ${tag}`,
          agentRole: 'SALES',
        },
        adminId,
      );
      await agentUsers.setActive(agentId, target.id, false, {
        userId: adminId,
        kind: 'INTERNAL',
      });
      await expectCode(
        team.setSalesUserActive(adminCtx, target.id, true),
        'AGENT_USER_DEACTIVATED_BY_COMPANY',
      );
      await agentUsers.setActive(agentId, target.id, true, {
        userId: adminId,
        kind: 'INTERNAL',
      });
      // The Agent Admin's own deactivation can be undone by the Admin.
      await team.setSalesUserActive(adminCtx, target.id, false);
      const back = await team.setSalesUserActive(adminCtx, target.id, true);
      expect(back.isActive).toBe(true);
    });
  });
  describe('workspace orders list (GET /agents/:id/orders)', () => {
    let app: INestApplication;
    let server: Server;
    let financeToken: string;
    let noViewToken: string;
    let financeId: string;
    let agentOrderId: string;
    let agentBOrderId: string;

    beforeAll(async () => {
      app = moduleRef.createNestApplication();
      app.useGlobalFilters(new AllExceptionsFilter());
      app.useGlobalPipes(
        new ValidationPipe({ whitelist: true, transform: true }),
      );
      await app.init();
      server = app.getHttpServer() as Server;
      const jwt = moduleRef.get(JwtService, { strict: false });
      const mkUser = async (key: string, perms: string[]) => {
        const user = await prisma.user.create({
          data: {
            email: `agt-${key}-${lower}@test.local`,
            username: `agt-${key}-${lower}`,
            fullName: `Agents ${key} ${tag}`,
            passwordHash: 'x',
          },
        });
        await grant(user.id, perms);
        return {
          id: user.id,
          token: jwt.sign({ sub: user.id, email: user.email }),
        };
      };
      // Finance-like: agents.view + store-orders.view but no sales scope
      // (no employee link, no shipping.view) — the Store Orders list is
      // empty for them.
      const finance = await mkUser('finance', [
        'agents.view',
        'store-orders.view',
      ]);
      financeId = finance.id;
      financeToken = finance.token;
      noViewToken = (await mkUser('noview', ['store-orders.view'])).token;
      agentOrderId = (
        await orders.createAgentOrder(orderInput(), { userId: adminId })
      ).id;
      agentBOrderId = (
        await orders.createAgentOrder(
          orderInput({
            lines: [
              { productId: agentBProductId, quantity: 1, lineAmount: 50 },
            ],
            fulfillmentMethod: 'PICKUP',
          }),
          { userId: adminId },
        )
      ).id;
    });

    afterAll(async () => {
      await app.close();
    });

    it('agents.view sees only this agent orders, unscoped by sales scope', async () => {
      const scoped = await storeOrders.findAll(
        { agentId, pageSize: 200 },
        financeId,
      );
      expect(scoped.total).toBe(0);

      const res = await request(server)
        .get(`/agents/${agentId}/orders`)
        .query({ pageSize: 100, sortBy: 'createdAt', sortOrder: 'desc' })
        .set('Authorization', `Bearer ${financeToken}`)
        .expect(200);
      const body = res.body as {
        items: {
          id: string;
          agentId: string;
          agent: { id: string } | null;
          payableTotal: string | null;
          profitability?: unknown;
        }[];
        total: number;
        page: number;
        pageSize: number;
      };
      expect(body.total).toBeGreaterThan(0);
      expect(body.pageSize).toBe(100);
      expect(body.items.every((row) => row.agentId === agentId)).toBe(true);
      const row = body.items.find((item) => item.id === agentOrderId);
      expect(row?.agent).toMatchObject({ id: agentId });
      expect(row?.payableTotal).not.toBeNull();
      expect(row?.profitability).toBeUndefined();
      expect(body.items.some((item) => item.id === agentBOrderId)).toBe(false);

      const b = await request(server)
        .get(`/agents/${agentBId}/orders`)
        .set('Authorization', `Bearer ${financeToken}`)
        .expect(200);
      expect(
        (b.body as { items: { id: string }[] }).items.map((i) => i.id),
      ).toContain(agentBOrderId);
    });

    it('filters (search) apply; unknown agent is 404; no agents.view is 403', async () => {
      const order = await prisma.storeOrder.findUniqueOrThrow({
        where: { id: agentOrderId },
        select: { internalOrderId: true },
      });
      const res = await request(server)
        .get(`/agents/${agentId}/orders`)
        .query({ search: order.internalOrderId })
        .set('Authorization', `Bearer ${financeToken}`)
        .expect(200);
      const found = (res.body as { items: { id: string; agentId: string }[] })
        .items;
      expect(found.map((i) => i.id)).toContain(agentOrderId);
      expect(found.every((i) => i.agentId === agentId)).toBe(true);

      await request(server)
        .get(`/agents/${randomUUID()}/orders`)
        .set('Authorization', `Bearer ${financeToken}`)
        .expect(404);
      await request(server)
        .get(`/agents/${agentId}/orders`)
        .set('Authorization', `Bearer ${noViewToken}`)
        .expect(403);
    });
  });
});
