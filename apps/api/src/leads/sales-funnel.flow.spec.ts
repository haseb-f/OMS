import 'dotenv/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  LeadAssignmentMethod,
  LeadDistributionMode,
  LeadSource,
  StoreOrderSource,
} from '@prisma/client';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { PhoneModule } from '../common/phone/phone.module';
import { PermissionsCoreModule } from '../permissions/permissions-core.module';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { UsersService } from '../users/users.service';
import { NumberingModule } from '../numbering/numbering.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { LeadsModule } from '../leads/leads.module';
import { LeadsService } from '../leads/leads.service';
import { LeadAutoDistributionService } from '../leads/distribution/lead-auto-distribution.service';
import { SalesScopeModule } from '../sales-scope/sales-scope.module';
import { SalesScopeService } from '../sales-scope/sales-scope.service';
import { NumberingEngineService } from '../numbering/numbering-engine.service';
import { StoreOrdersModule } from '../store-orders/store-orders.module';
import { StoreOrdersService } from '../store-orders/store-orders.service';
import { WorkflowEngineService } from '../workflow/workflow-engine.service';
import { SalesPerformanceModule } from '../sales-performance/sales-performance.module';
import { SalesPerformanceService } from '../sales-performance/sales-performance.service';
import { PermissionsResolverService } from '../permissions/permissions-resolver.service';

describe('Sales Funnel Engine', () => {
  jest.setTimeout(180_000);

  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let leads: LeadsService;
  let distribution: LeadAutoDistributionService;
  let salesScope: SalesScopeService;
  let users: UsersService;
  let numbering: NumberingEngineService;
  let storeOrders: StoreOrdersService;
  let workflow: WorkflowEngineService;
  let performance: SalesPerformanceService;
  let permissions: PermissionsResolverService;
  let dbUnreachable = false;

  const createdUserIds: string[] = [];
  const createdLeadIds: string[] = [];
  const createdTeamIds: string[] = [];
  const suffix = () => randomUUID().slice(0, 8);

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        PrismaModule,
        PhoneModule,
        PermissionsCoreModule,
        AuthModule,
        SalesScopeModule,
        UsersModule,
        NumberingModule,
        WorkflowModule,
        LeadsModule,
        StoreOrdersModule,
        SalesPerformanceModule,
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    leads = moduleRef.get(LeadsService);
    distribution = moduleRef.get(LeadAutoDistributionService);
    salesScope = moduleRef.get(SalesScopeService);
    users = moduleRef.get(UsersService);
    numbering = moduleRef.get(NumberingEngineService);
    storeOrders = moduleRef.get(StoreOrdersService);
    workflow = moduleRef.get(WorkflowEngineService);
    performance = moduleRef.get(SalesPerformanceService);
    permissions = moduleRef.get(PermissionsResolverService);
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      dbUnreachable = true;
      console.warn(
        'Sales Funnel live tests skipped: Postgres is not reachable.',
      );
    }
  });

  afterAll(async () => {
    if (prisma && !dbUnreachable) {
      await distribution.deactivate();
      const orderWhere = {
        OR: [
          { leadId: { in: createdLeadIds } },
          { employeeId: { in: createdUserIds } },
        ],
      };
      await prisma.storeOrderItem.deleteMany({
        where: { storeOrder: orderWhere },
      });
      await prisma.storeOrderActivity.deleteMany({
        where: { storeOrder: orderWhere },
      });
      await prisma.storeOrder.deleteMany({ where: orderWhere });
      if (createdLeadIds.length) {
        await prisma.leadFollowUp.deleteMany({
          where: {
            OR: [
              { leadId: { in: createdLeadIds } },
              { userId: { in: createdUserIds } },
            ],
          },
        });
        await prisma.leadAssignment.deleteMany({
          where: { leadId: { in: createdLeadIds } },
        });
        await prisma.leadActivity.deleteMany({
          where: { leadId: { in: createdLeadIds } },
        });
        await prisma.statusHistory.deleteMany({
          where: { entityId: { in: createdLeadIds } },
        });
        await prisma.lead.deleteMany({ where: { id: { in: createdLeadIds } } });
      }
      if (createdUserIds.length) {
        await prisma.storeOrderItem.deleteMany({
          where: { storeOrder: { employeeId: { in: createdUserIds } } },
        });
        await prisma.storeOrderActivity.deleteMany({
          where: { storeOrder: { employeeId: { in: createdUserIds } } },
        });
        await prisma.storeOrder.deleteMany({
          where: { employeeId: { in: createdUserIds } },
        });
        await prisma.leadAssignment.deleteMany({
          where: {
            OR: [
              { assignedToId: { in: createdUserIds } },
              { actorId: { in: createdUserIds } },
              { fromUserId: { in: createdUserIds } },
            ],
          },
        });
        await prisma.leadDistributionPolicy.updateMany({
          where: { createdBy: { in: createdUserIds } },
          data: { isActive: false },
        });
        await prisma.salesTeamMember.deleteMany({
          where: {
            OR: [
              { userId: { in: createdUserIds } },
              { salesTeamId: { in: createdTeamIds } },
            ],
          },
        });
        if (createdTeamIds.length) {
          await prisma.leadDistributionPolicy.updateMany({
            where: { teamId: { in: createdTeamIds } },
            data: { teamId: null, isActive: false },
          });
          await prisma.salesTeam.deleteMany({
            where: { id: { in: createdTeamIds } },
          });
        }
        await prisma.userPermission.deleteMany({
          where: { userId: { in: createdUserIds } },
        });
        await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      }
      await prisma.$disconnect();
    }
    if (moduleRef) await moduleRef.close();
  });

  function liveIt(name: string, fn: () => Promise<void>) {
    it(name, async () => {
      if (dbUnreachable) return;
      await fn();
    });
  }

  it('round-robin advances A → B → C → A', () => {
    const next = distribution.nextRoundRobin.bind(distribution);
    const ids = ['A', 'B', 'C'];
    expect(next(ids, null)).toBe('A');
    expect(next(ids, 'A')).toBe('B');
    expect(next(ids, 'B')).toBe('C');
    expect(next(ids, 'C')).toBe('A');
  });

  async function departmentId() {
    const existing = await prisma.department.findFirst({
      where: { deletedAt: null, isActive: true },
      select: { id: true },
    });
    if (existing) return existing.id;
    return (
      await prisma.department.create({
        data: {
          code: `DEPT-SF-${suffix()}`,
          name: 'Sales Funnel Dept',
          isActive: true,
        },
      })
    ).id;
  }

  async function refs() {
    const country =
      (await prisma.country.findFirst({
        where: { deletedAt: null, code: 'SA' },
        select: { id: true },
      })) ??
      (await prisma.country.findFirst({
        where: { deletedAt: null },
        select: { id: true },
      }));
    const currency = await prisma.currency.findFirst({
      where: { deletedAt: null },
      select: { id: true },
    });
    if (!country || !currency) {
      throw new Error('Country/currency seed required for live funnel tests.');
    }
    return { countryId: country.id, currencyId: currency.id };
  }

  function saMobile() {
    const n = 500000000 + Math.floor(Math.random() * 99999999);
    return `+966${n}`;
  }

  async function salesUser(name: string, extra: string[] = []) {
    const tag = suffix();
    const created = await users.create({
      email: `sf-${tag}@example.com`,
      username: `sf_${tag}`,
      fullName: name,
      password: 'SalesPassw0rd!',
      departmentId: await departmentId(),
    });
    createdUserIds.push(created.id);
    await users.setPermissions(created.id, {
      permissionNames: [
        'crm.leads.view',
        'crm.leads.edit',
        'crm.leads.convert',
        'store-orders.view',
        'store-orders.edit',
        ...extra,
      ],
    });
    return created;
  }

  async function managerUser(name: string) {
    const tag = suffix();
    const created = await users.create({
      email: `sf-m-${tag}@example.com`,
      username: `sf_m_${tag}`,
      fullName: name,
      password: 'SalesPassw0rd!',
      departmentId: await departmentId(),
    });
    createdUserIds.push(created.id);
    await users.setPermissions(created.id, {
      permissionNames: [
        'crm.leads.view',
        'crm.leads.manage',
        'crm.leads.convert',
        'store-orders.view',
        'store-orders.edit',
      ],
    });
    return created;
  }

  async function makeTeam(managerId: string, memberIds: string[]) {
    const team = await prisma.salesTeam.create({
      data: {
        code: `ST-SF-${suffix()}`,
        name: `Funnel Team ${suffix()}`,
        departmentId: await departmentId(),
        managerId,
        members: {
          create: memberIds.map((userId) => ({ userId })),
        },
      },
    });
    createdTeamIds.push(team.id);
    return team;
  }

  async function productId() {
    const product = await prisma.product.findFirst({
      where: { deletedAt: null, isSellable: true, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!product) throw new Error('A sellable product is required.');
    return product.id;
  }

  liveIt(
    'assigns 6 leads A-B-C-A-B-C and keeps the cursor after a new policy snapshot',
    async () => {
      const manager = await managerUser('RR Manager');
      const a = await salesUser('AA Ahmed');
      const b = await salesUser('BB Sara');
      const c = await salesUser('CC Mohamed');
      const team = await makeTeam(manager.id, [a.id, b.id, c.id]);
      await distribution.activate({
        mode: LeadDistributionMode.CONTINUOUS,
        actorId: manager.id,
        teamId: team.id,
      });
      const { countryId, currencyId } = await refs();
      const created = [];
      for (let i = 0; i < 6; i += 1) {
        const lead = await leads.create({
          customerName: `RR Lead ${i} ${suffix()}`,
          mobileNumber: saMobile(),
          countryId,
          currencyId,
          source: LeadSource.MANUAL,
          quantity: 1,
        });
        createdLeadIds.push(lead.id);
        created.push(lead);
      }
      const owners = created.map((lead) => lead.salesEmployeeId);
      expect(owners).toEqual([a.id, b.id, c.id, a.id, b.id, c.id]);
      const snapshot = await distribution.getPolicySnapshot();
      expect(snapshot.policy?.mode).toBe(LeadDistributionMode.CONTINUOUS);
      const seventh = await leads.create({
        customerName: `RR Lead 6 ${suffix()}`,
        mobileNumber: saMobile(),
        countryId,
        currencyId,
        source: LeadSource.MANUAL,
        quantity: 1,
      });
      createdLeadIds.push(seventh.id);
      expect(seventh.salesEmployeeId).toBe(a.id);
      await distribution.deactivate(manager.id);
    },
  );

  liveIt('24-hour policy expires without a cron', async () => {
    const actor = await salesUser('Policy Actor');
    const started = new Date('2026-01-01T00:00:00.000Z');
    await distribution.activate({
      mode: LeadDistributionMode.TIME_LIMITED,
      actorId: actor.id,
      now: started,
    });
    const stillOn = await distribution.getEffectivePolicy(
      new Date('2026-01-01T12:00:00.000Z'),
    );
    expect(stillOn).toBeTruthy();
    const expired = await distribution.getEffectivePolicy(
      new Date('2026-01-02T00:00:00.000Z'),
    );
    expect(expired).toBeNull();
    await distribution.deactivate(actor.id);
  });

  liveIt('custom N assigns exactly N unassigned leads', async () => {
    const manager = await salesUser('N Manager');
    await users.setPermissions(manager.id, {
      permissionNames: [
        'crm.leads.view',
        'crm.leads.edit',
        'crm.leads.manage',
        'store-orders.view',
      ],
    });
    const agent = await salesUser('N Agent');
    await distribution.deactivate(manager.id);
    const { countryId, currencyId } = await refs();
    const marker = `N-LEAD-${suffix()}`;
    const ids: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      const lead = await leads.create({
        customerName: `${marker} ${i}`,
        mobileNumber: saMobile(),
        countryId,
        currencyId,
        source: LeadSource.MANUAL,
        quantity: 1,
      });
      createdLeadIds.push(lead.id);
      ids.push(lead.id);
    }
    const scope = await salesScope.resolve(manager.id);
    const result = await leads.bulkAssign(
      {
        salesEmployeeId: agent.id,
        count: 5,
        unassignedOnly: true,
        search: marker,
      },
      manager.id,
      scope,
    );
    expect(result.assigned).toBe(5);
    const assigned = await prisma.lead.count({
      where: { id: { in: ids }, salesEmployeeId: agent.id },
    });
    expect(assigned).toBe(5);
    const histories = await prisma.leadAssignment.count({
      where: {
        leadId: { in: result.ids },
        method: LeadAssignmentMethod.MANUAL,
      },
    });
    expect(histories).toBe(5);
  });

  liveIt('agent A cannot read agent B lead', async () => {
    const a = await salesUser('Agent A');
    const b = await salesUser('Agent B');
    const { countryId, currencyId } = await refs();
    const leadB = await leads.create({
      customerName: `Owned by B ${suffix()}`,
      mobileNumber: saMobile(),
      countryId,
      currencyId,
      source: LeadSource.MANUAL,
      quantity: 1,
      salesEmployeeId: b.id,
    });
    createdLeadIds.push(leadB.id);
    const scopeA = await salesScope.resolve(a.id);
    await expect(leads.findOne(leadB.id, scopeA)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  liveIt('first owner open moves NEW to IN_PROGRESS once', async () => {
    const owner = await salesUser('Owner Open');
    const manager = await salesUser('Manager Open');
    await users.setPermissions(manager.id, {
      permissionNames: ['crm.leads.view', 'crm.leads.edit', 'crm.leads.manage'],
    });
    const { countryId, currencyId } = await refs();
    const lead = await leads.create({
      customerName: `First Open ${suffix()}`,
      mobileNumber: saMobile(),
      countryId,
      currencyId,
      source: LeadSource.MANUAL,
      quantity: 1,
      salesEmployeeId: owner.id,
    });
    createdLeadIds.push(lead.id);
    const managerScope = await salesScope.resolve(manager.id);
    const afterManager = await leads.firstOpen(
      lead.id,
      manager.id,
      managerScope,
    );
    expect(afterManager.status.code).toBe('NEW');
    const ownerScope = await salesScope.resolve(owner.id);
    const afterOwner = await leads.firstOpen(lead.id, owner.id, ownerScope);
    expect(afterOwner.status.code).toBe('IN_PROGRESS');
    const again = await leads.firstOpen(lead.id, owner.id, ownerScope);
    expect(again.status.code).toBe('IN_PROGRESS');
    const history = await prisma.statusHistory.count({
      where: {
        entityId: lead.id,
        toStatus: { code: 'IN_PROGRESS' },
      },
    });
    expect(history).toBe(1);
  });

  liveIt(
    'Lead and StoreOrder numbering stay unique under concurrent minting',
    async () => {
      const [a, b, c, d] = await Promise.all([
        numbering.generateNumber('LEAD'),
        numbering.generateNumber('LEAD'),
        numbering.generateNumber('STORE_ORDER'),
        numbering.generateNumber('STORE_ORDER'),
      ]);
      expect(new Set([a, b]).size).toBe(2);
      expect(new Set([c, d]).size).toBe(2);
      expect(a.startsWith('LD-') || a.includes('-')).toBe(true);
      expect(c.startsWith('STO-') || c.includes('-')).toBe(true);
    },
  );

  liveIt('StoreOrder list is scoped to the sales owner', async () => {
    const a = await salesUser('Order Owner A');
    const b = await salesUser('Order Owner B');
    const listed = await storeOrders.findAll({ page: 1, pageSize: 50 }, a.id);
    expect(
      listed.items.every((row) => !row.employeeId || row.employeeId === a.id),
    ).toBe(true);
    void b;
  });

  liveIt(
    'Excel and Google Sheets intake honor ON/OFF distribution',
    async () => {
      const manager = await managerUser('Import Dist Manager');
      const a = await salesUser('AA Import Ahmed');
      const b = await salesUser('BB Import Sara');
      const team = await makeTeam(manager.id, [a.id, b.id]);
      const { countryId, currencyId } = await refs();
      await distribution.deactivate(manager.id);
      const offLead = await leads.create({
        customerName: `Sheets OFF ${suffix()}`,
        mobileNumber: saMobile(),
        countryId,
        currencyId,
        source: LeadSource.GOOGLE_SHEETS,
        importBatch: `gs-${suffix()}`,
        quantity: 1,
      });
      createdLeadIds.push(offLead.id);
      expect(offLead.salesEmployeeId).toBeNull();

      await distribution.activate({
        mode: LeadDistributionMode.CONTINUOUS,
        actorId: manager.id,
        teamId: team.id,
      });
      const onLead = await leads.create({
        customerName: `Excel ON ${suffix()}`,
        mobileNumber: saMobile(),
        countryId,
        currencyId,
        source: LeadSource.EXCEL,
        importBatch: `xl-${suffix()}`,
        quantity: 1,
      });
      createdLeadIds.push(onLead.id);
      expect(onLead.salesEmployeeId).toBe(a.id);

      const externalOrderId = `EXT-${suffix()}`;
      const owned = await leads.create({
        customerName: `Retry owner ${suffix()}`,
        mobileNumber: saMobile(),
        countryId,
        currencyId,
        source: LeadSource.GOOGLE_SHEETS,
        externalOrderId,
        salesEmployeeId: b.id,
        quantity: 1,
      });
      createdLeadIds.push(owned.id);
      expect(owned.salesEmployeeId).toBe(b.id);
      await expect(
        leads.create({
          customerName: `Retry owner ${suffix()}`,
          mobileNumber: saMobile(),
          countryId,
          currencyId,
          source: LeadSource.GOOGLE_SHEETS,
          externalOrderId,
          quantity: 1,
        }),
      ).rejects.toThrow(/Duplicate Lead/);
      const unchanged = await prisma.lead.findUnique({
        where: { id: owned.id },
        select: { salesEmployeeId: true },
      });
      expect(unchanged?.salesEmployeeId).toBe(b.id);
      await distribution.deactivate(manager.id);
    },
  );

  liveIt('reassigns A → B and flips access', async () => {
    const a = await salesUser('Reassign A');
    const b = await salesUser('Reassign B');
    const manager = await managerUser('Reassign Manager');
    const { countryId, currencyId } = await refs();
    const lead = await leads.create({
      customerName: `Reassign ${suffix()}`,
      mobileNumber: saMobile(),
      countryId,
      currencyId,
      source: LeadSource.MANUAL,
      salesEmployeeId: a.id,
      quantity: 1,
    });
    createdLeadIds.push(lead.id);
    const managerScope = await salesScope.resolve(manager.id);
    await leads.bulkAssign(
      {
        salesEmployeeId: b.id,
        leadIds: [lead.id],
        reason: 'coverage',
      },
      manager.id,
      managerScope,
    );
    const updated = await prisma.lead.findUnique({
      where: { id: lead.id },
      select: { salesEmployeeId: true },
    });
    expect(updated?.salesEmployeeId).toBe(b.id);
    const history = await prisma.leadAssignment.findFirst({
      where: {
        leadId: lead.id,
        method: LeadAssignmentMethod.REASSIGNMENT,
      },
    });
    expect(history?.fromUserId).toBe(a.id);
    expect(history?.assignedToId).toBe(b.id);
    expect(history?.reason).toBe('coverage');
    const scopeA = await salesScope.resolve(a.id);
    const scopeB = await salesScope.resolve(b.id);
    await expect(leads.findOne(lead.id, scopeA)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(leads.findOne(lead.id, scopeB)).resolves.toMatchObject({
      id: lead.id,
    });
  });

  liveIt(
    'denies agent mutations and StoreOrder GET across owners',
    async () => {
      const a = await salesUser('Sec A');
      const b = await salesUser('Sec B');
      const { countryId, currencyId } = await refs();
      const leadB = await leads.create({
        customerName: `Sec Lead B ${suffix()}`,
        mobileNumber: saMobile(),
        countryId,
        currencyId,
        source: LeadSource.MANUAL,
        salesEmployeeId: b.id,
        quantity: 1,
      });
      createdLeadIds.push(leadB.id);
      const orderB = await storeOrders.create(
        {
          partner: {
            name: `Sec Partner ${suffix()}`,
            phone: saMobile(),
            countryId,
          },
          currencyId,
          employeeId: b.id,
          items: [{ productId: await productId(), quantity: 1, unitPrice: 20 }],
        },
        b.id,
      );
      const scopeA = await salesScope.resolve(a.id);
      await expect(leads.findOne(leadB.id, scopeA)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(
        leads.update(leadB.id, { city: 'Riyadh' }, scopeA),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        leads.addFollowUp(
          leadB.id,
          { outcome: 'called', note: 'nope' },
          a.id,
          scopeA,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        workflow.executeTransitionByCodes(
          'LEAD',
          leadB.id,
          'NEW',
          'IN_PROGRESS',
          a.id,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(storeOrders.findOne(orderB.id, a.id)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(storeOrders.findOne(orderB.id, b.id)).resolves.toMatchObject(
        {
          id: orderB.id,
        },
      );
    },
  );

  liveIt(
    'sales cannot edit shipping; shipping cannot read CRM leads',
    async () => {
      const agent = await salesUser('Ship Sales');
      const shipperTag = suffix();
      const shipper = await users.create({
        email: `sf-ship-${shipperTag}@example.com`,
        username: `sf_ship_${shipperTag}`,
        fullName: 'Shipping Agent',
        password: 'SalesPassw0rd!',
        departmentId: await departmentId(),
      });
      createdUserIds.push(shipper.id);
      await users.setPermissions(shipper.id, {
        permissionNames: [
          'shipping.view',
          'shipping.edit',
          'store-orders.view',
        ],
      });
      expect(await permissions.hasPermission(agent.id, 'shipping.edit')).toBe(
        false,
      );
      expect(
        await permissions.hasPermission(shipper.id, 'crm.leads.view'),
      ).toBe(false);
      const { countryId, currencyId } = await refs();
      const lead = await leads.create({
        customerName: `Ship CRM ${suffix()}`,
        mobileNumber: saMobile(),
        countryId,
        currencyId,
        source: LeadSource.MANUAL,
        salesEmployeeId: agent.id,
        quantity: 1,
      });
      createdLeadIds.push(lead.id);
      const shipperScope = await salesScope.resolve(shipper.id);
      await expect(leads.findOne(lead.id, shipperScope)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    },
  );

  liveIt('structured follow-up, overdue next date, and reopen', async () => {
    const owner = await salesUser('Follow Owner');
    const manager = await managerUser('Follow Manager');
    const { countryId, currencyId } = await refs();
    const lead = await leads.create({
      customerName: `Follow ${suffix()}`,
      mobileNumber: saMobile(),
      countryId,
      currencyId,
      source: LeadSource.MANUAL,
      salesEmployeeId: owner.id,
      quantity: 1,
    });
    createdLeadIds.push(lead.id);
    const ownerScope = await salesScope.resolve(owner.id);
    await leads.firstOpen(lead.id, owner.id, ownerScope);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    await leads.addFollowUp(
      lead.id,
      {
        outcome: 'interested',
        note: 'call tomorrow',
        followUpAt: tomorrow.toISOString(),
      },
      owner.id,
      ownerScope,
    );
    const overdue = new Date();
    overdue.setDate(overdue.getDate() - 2);
    await leads.addFollowUp(
      lead.id,
      {
        outcome: 'no answer',
        note: 'retry',
        followUpAt: overdue.toISOString(),
      },
      owner.id,
      ownerScope,
    );
    const rows = await leads.listFollowUps(lead.id);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const refreshed = await leads.findOne(lead.id, ownerScope);
    expect(refreshed.status.code).toBe('FOLLOW_UP');
    expect(refreshed.nextFollowUpAt).toBeTruthy();
    await workflow.executeTransitionByCodes(
      'LEAD',
      lead.id,
      'FOLLOW_UP',
      'LOST',
      owner.id,
      { reason: 'price' },
    );
    const lost = await leads.findOne(lead.id, ownerScope);
    expect(lost.status.code).toBe('LOST');
    const managerScope = await salesScope.resolve(manager.id);
    await workflow.executeTransitionByCodes(
      'LEAD',
      lead.id,
      'LOST',
      'IN_PROGRESS',
      manager.id,
      { reason: 'reopen requested' },
    );
    const reopened = await leads.findOne(lead.id, managerScope);
    expect(reopened.status.code).toBe('IN_PROGRESS');
  });

  liveIt(
    'converts a Google Sheets lead preserving owner and source',
    async () => {
      const owner = await salesUser('Convert Owner');
      const { countryId, currencyId } = await refs();
      const sku = await productId();
      const lead = await leads.create({
        customerName: `Convert ${suffix()}`,
        mobileNumber: saMobile(),
        countryId,
        currencyId,
        source: LeadSource.GOOGLE_SHEETS,
        salesEmployeeId: owner.id,
        productId: sku,
        quantity: 2,
      });
      createdLeadIds.push(lead.id);
      const ownerScope = await salesScope.resolve(owner.id);
      await leads.firstOpen(lead.id, owner.id, ownerScope);
      await workflow.executeTransitionByCodes(
        'LEAD',
        lead.id,
        'IN_PROGRESS',
        'CONVERTED',
        owner.id,
        { convertPayload: { productId: sku, quantity: 2, unitPrice: 150 } },
      );
      const converted = await leads.findOne(lead.id, ownerScope);
      expect(converted.status.code).toBe('CONVERTED');
      const order = await prisma.storeOrder.findFirst({
        where: { leadId: lead.id },
      });
      expect(order?.employeeId).toBe(owner.id);
      expect(order?.source).toBe(StoreOrderSource.GOOGLE_SHEETS);
      expect(order?.internalOrderId).toMatch(/^STO-/);
      await expect(
        workflow.executeTransitionByCodes(
          'LEAD',
          lead.id,
          'IN_PROGRESS',
          'CONVERTED',
          owner.id,
          { convertPayload: { productId: sku, quantity: 2, unitPrice: 150 } },
        ),
      ).rejects.toThrow();
      const count = await prisma.storeOrder.count({
        where: { leadId: lead.id },
      });
      expect(count).toBe(1);
      const partner = await prisma.partner.findUnique({
        where: { id: order!.partnerId },
        include: { roles: true },
      });
      expect(partner?.roles.some((role) => role.role === 'CUSTOMER')).toBe(
        true,
      );
    },
  );

  liveIt(
    'team manager ranking and dashboard exclude another team',
    async () => {
      const manager = await managerUser('Rank Manager');
      const a = await salesUser('Rank A');
      const b = await salesUser('Rank B');
      const c = await salesUser('Rank C');
      await makeTeam(manager.id, [a.id, b.id]);
      const { countryId, currencyId } = await refs();
      const sku = await productId();
      const makeCount = async (employeeId: string, n: number) => {
        for (let i = 0; i < n; i += 1) {
          await storeOrders.create(
            {
              partner: {
                name: `Rank Partner ${suffix()}`,
                phone: saMobile(),
                countryId,
              },
              currencyId,
              employeeId,
              items: [{ productId: sku, quantity: 1, unitPrice: 10 }],
            },
            employeeId,
          );
        }
      };
      await makeCount(a.id, 3);
      await makeCount(b.id, 2);
      await makeCount(c.id, 7);
      const dash = await performance.dashboard(manager.id, 'month');
      expect(dash.scope).toBe('TEAM');
      const board = dash.ranking.leaderboard;
      expect(board[0]?.userId).toBe(a.id);
      expect(board[0]?.orders).toBe(3);
      expect(board[1]?.userId).toBe(b.id);
      expect(board[1]?.orders).toBe(2);
      expect(board.some((row) => row.userId === c.id)).toBe(false);
      const managerScope = await salesScope.resolve(manager.id);
      const listed = await leads.findAll(
        { page: 1, pageSize: 50 },
        managerScope,
      );
      const outsider = await leads.create({
        customerName: `Outsider ${suffix()}`,
        mobileNumber: saMobile(),
        countryId,
        currencyId,
        source: LeadSource.MANUAL,
        salesEmployeeId: c.id,
        quantity: 1,
      });
      createdLeadIds.push(outsider.id);
      await expect(
        leads.findOne(outsider.id, managerScope),
      ).rejects.toBeInstanceOf(NotFoundException);
      void listed;
    },
  );

  liveIt(
    'funnel stages include assignment and operational StoreOrder events',
    async () => {
      const owner = await salesUser('Funnel Owner');
      const { countryId, currencyId } = await refs();
      const sku = await productId();
      const lead = await leads.create({
        customerName: `Funnel ${suffix()}`,
        mobileNumber: saMobile(),
        countryId,
        currencyId,
        source: LeadSource.MANUAL,
        salesEmployeeId: owner.id,
        productId: sku,
        quantity: 1,
      });
      createdLeadIds.push(lead.id);
      const ownerScope = await salesScope.resolve(owner.id);
      await leads.firstOpen(lead.id, owner.id, ownerScope);
      await leads.addFollowUp(
        lead.id,
        { outcome: 'qualified soon', note: 'ok' },
        owner.id,
        ownerScope,
      );
      const current = await leads.findOne(lead.id, ownerScope);
      if (current.status.code === 'FOLLOW_UP') {
        await workflow.executeTransitionByCodes(
          'LEAD',
          lead.id,
          'FOLLOW_UP',
          'QUALIFIED',
          owner.id,
        );
      }
      const afterQualify = await leads.findOne(lead.id, ownerScope);
      await workflow.executeTransitionByCodes(
        'LEAD',
        lead.id,
        afterQualify.status.code,
        'CONVERTED',
        owner.id,
        { convertPayload: { productId: sku, quantity: 1, unitPrice: 40 } },
      );
      const order = await prisma.storeOrder.findFirstOrThrow({
        where: { leadId: lead.id },
      });
      const paid = await prisma.statusDefinition.findFirst({
        where: { workflowType: 'PAYMENT', code: 'PAID', deletedAt: null },
      });
      const shipped = await prisma.statusDefinition.findFirst({
        where: {
          workflowType: 'FULFILLMENT',
          code: 'SHIPPED',
          deletedAt: null,
        },
      });
      const delivered = await prisma.statusDefinition.findFirst({
        where: {
          workflowType: 'FULFILLMENT',
          code: 'DELIVERED',
          deletedAt: null,
        },
      });
      await prisma.storeOrder.update({
        where: { id: order.id },
        data: {
          ...(paid ? { paymentStatusId: paid.id } : {}),
          ...(delivered
            ? { fulfillmentStatusId: delivered.id }
            : shipped
              ? { fulfillmentStatusId: shipped.id }
              : {}),
        },
      });
      const funnel = await workflow.getLeadFunnel({
        salesEmployeeId: owner.id,
      });
      expect(funnel.stages.CREATED).toBeGreaterThanOrEqual(1);
      expect(funnel.stages.ASSIGNED).toBeGreaterThanOrEqual(1);
      expect(funnel.stages.IN_PROGRESS).toBeGreaterThanOrEqual(1);
      expect(funnel.stages.CONVERTED).toBeGreaterThanOrEqual(1);
      expect(funnel.stages.ORDER).toBeGreaterThanOrEqual(1);
    },
  );

  liveIt(
    'concurrent creates keep unique owners and a fair round-robin split',
    async () => {
      const manager = await managerUser('Conc Manager');
      const a = await salesUser('AA Conc Ahmed');
      const b = await salesUser('BB Conc Sara');
      const c = await salesUser('CC Conc Mohamed');
      const team = await makeTeam(manager.id, [a.id, b.id, c.id]);
      await distribution.activate({
        mode: LeadDistributionMode.CONTINUOUS,
        actorId: manager.id,
        teamId: team.id,
      });
      const { countryId, currencyId } = await refs();
      const created = await Promise.all(
        Array.from({ length: 6 }, (_, i) =>
          leads.create({
            customerName: `Conc ${i} ${suffix()}`,
            mobileNumber: saMobile(),
            countryId,
            currencyId,
            source: LeadSource.MANUAL,
            quantity: 1,
          }),
        ),
      );
      created.forEach((lead) => createdLeadIds.push(lead.id));
      const counts = new Map<string, number>();
      for (const lead of created) {
        expect(lead.salesEmployeeId).toBeTruthy();
        counts.set(
          lead.salesEmployeeId!,
          (counts.get(lead.salesEmployeeId!) ?? 0) + 1,
        );
      }
      expect(counts.get(a.id)).toBe(2);
      expect(counts.get(b.id)).toBe(2);
      expect(counts.get(c.id)).toBe(2);
      await distribution.deactivate(manager.id);
    },
  );
});
