import 'dotenv/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  LeadAssignmentMethod,
  LeadSource,
  PaymentStatus,
  StoreOrderPaymentStatus,
  StoreOrderPaymentType,
  StoreOrderShippingStage,
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
import { LeadAssignmentsService } from '../leads/assignments/lead-assignments.service';
import { SalesScopeModule } from '../sales-scope/sales-scope.module';
import { SalesScopeService } from '../sales-scope/sales-scope.service';
import { StoreOrdersModule } from '../store-orders/store-orders.module';
import { StoreOrdersService } from '../store-orders/store-orders.service';
import { CustomerClassificationsModule } from '../customer-classifications/customer-classifications.module';
import { CustomerClassificationsService } from '../customer-classifications/customer-classifications.service';
import { NoPurchaseReasonsModule } from '../no-purchase-reasons/no-purchase-reasons.module';
import { NoPurchaseReasonsService } from '../no-purchase-reasons/no-purchase-reasons.service';
import { DepartmentsModule } from '../departments/departments.module';
import { DepartmentsService } from '../departments/departments.service';
import { PaymentMethodsModule } from '../payment-methods/payment-methods.module';
import { PaymentMethodsService } from '../payment-methods/payment-methods.service';
import { PhoneNumberService } from '../common/phone/phone-number.service';

describe('Sales Flow Hardening', () => {
  jest.setTimeout(180_000);

  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let leads: LeadsService;
  let assignments: LeadAssignmentsService;
  let salesScope: SalesScopeService;
  let users: UsersService;
  let storeOrders: StoreOrdersService;
  let classifications: CustomerClassificationsService;
  let reasons: NoPurchaseReasonsService;
  let departments: DepartmentsService;
  let paymentMethods: PaymentMethodsService;
  let phone: PhoneNumberService;
  let dbUnreachable = false;

  const createdUserIds: string[] = [];
  const createdLeadIds: string[] = [];
  const createdTeamIds: string[] = [];
  const createdClassificationIds: string[] = [];
  const createdReasonIds: string[] = [];
  const createdDepartmentIds: string[] = [];
  const createdPaymentMethodIds: string[] = [];
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
        CustomerClassificationsModule,
        NoPurchaseReasonsModule,
        DepartmentsModule,
        PaymentMethodsModule,
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    leads = moduleRef.get(LeadsService);
    assignments = moduleRef.get(LeadAssignmentsService);
    salesScope = moduleRef.get(SalesScopeService);
    users = moduleRef.get(UsersService);
    storeOrders = moduleRef.get(StoreOrdersService);
    classifications = moduleRef.get(CustomerClassificationsService);
    reasons = moduleRef.get(NoPurchaseReasonsService);
    departments = moduleRef.get(DepartmentsService);
    paymentMethods = moduleRef.get(PaymentMethodsService);
    phone = moduleRef.get(PhoneNumberService);
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      dbUnreachable = true;
      console.warn(
        'Sales Flow Hardening live tests skipped: Postgres is not reachable.',
      );
    }
  });

  afterAll(async () => {
    if (prisma && !dbUnreachable) {
      const orderWhere = {
        OR: [
          { leadId: { in: createdLeadIds } },
          { employeeId: { in: createdUserIds } },
        ],
      };
      await prisma.paymentAttachment.deleteMany({
        where: { payment: { storeOrder: orderWhere } },
      });
      await prisma.paymentNote.deleteMany({
        where: { payment: { storeOrder: orderWhere } },
      });
      await prisma.paymentActivity.deleteMany({
        where: { payment: { storeOrder: orderWhere } },
      });
      await prisma.storeOrderReceipt.deleteMany({
        where: { storeOrder: orderWhere },
      });
      await prisma.payment.deleteMany({
        where: { storeOrder: orderWhere },
      });
      await prisma.storeOrderItem.deleteMany({
        where: { storeOrder: orderWhere },
      });
      await prisma.storeOrderActivity.deleteMany({
        where: { storeOrder: orderWhere },
      });
      await prisma.storeOrder.deleteMany({ where: orderWhere });
      if (createdLeadIds.length) {
        await prisma.leadFollowUp.deleteMany({
          where: { leadId: { in: createdLeadIds } },
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
      if (createdClassificationIds.length) {
        await prisma.customerClassification.deleteMany({
          where: { id: { in: createdClassificationIds } },
        });
      }
      if (createdReasonIds.length) {
        await prisma.noPurchaseReason.deleteMany({
          where: { id: { in: createdReasonIds } },
        });
      }
      if (createdPaymentMethodIds.length) {
        await prisma.paymentMethod.deleteMany({
          where: { id: { in: createdPaymentMethodIds } },
        });
      }
      if (createdUserIds.length) {
        await prisma.leadAssignment.deleteMany({
          where: {
            OR: [
              { assignedToId: { in: createdUserIds } },
              { actorId: { in: createdUserIds } },
              { fromUserId: { in: createdUserIds } },
            ],
          },
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
          await prisma.salesTeam.deleteMany({
            where: { id: { in: createdTeamIds } },
          });
        }
        await prisma.userPermission.deleteMany({
          where: { userId: { in: createdUserIds } },
        });
        await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      }
      if (createdDepartmentIds.length) {
        await prisma.department.deleteMany({
          where: { id: { in: createdDepartmentIds } },
        });
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

  async function departmentId() {
    const existing = await prisma.department.findFirst({
      where: { deletedAt: null, isActive: true },
      select: { id: true },
    });
    if (existing) return existing.id;
    const created = await departments.create({
      name: `Hardening Dept ${suffix()}`,
      isActive: true,
    });
    createdDepartmentIds.push(created.id);
    return created.id;
  }

  async function refs() {
    const country =
      (await prisma.country.findFirst({
        where: { deletedAt: null, code: 'SA' },
        select: { id: true, code: true },
      })) ??
      (await prisma.country.findFirst({
        where: { deletedAt: null },
        select: { id: true, code: true },
      }));
    const currency = await prisma.currency.findFirst({
      where: { deletedAt: null },
      select: { id: true },
    });
    if (!country || !currency) {
      throw new Error(
        'Country/currency seed required for live hardening tests.',
      );
    }
    return {
      countryId: country.id,
      countryCode: country.code,
      currencyId: currency.id,
    };
  }

  function uniqueSaMobile() {
    const n = 500000000 + Math.floor(Math.random() * 99999999);
    return `+966${n}`;
  }

  async function salesUser(name: string, extra: string[] = []) {
    const tag = suffix();
    const created = await users.create({
      email: `hf-${tag}@example.com`,
      username: `hf_${tag}`,
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
    return salesUser(name, ['crm.leads.manage']);
  }

  async function makeTeam(managerId: string, memberIds: string[]) {
    const team = await prisma.salesTeam.create({
      data: {
        code: `ST-HF-${suffix()}`,
        name: `Hardening Team ${suffix()}`,
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

  async function productIds() {
    const products = await prisma.product.findMany({
      where: { deletedAt: null, isSellable: true, status: 'ACTIVE' },
      select: { id: true },
      take: 2,
    });
    if (!products.length) throw new Error('A sellable product is required.');
    if (products.length === 1) return [products[0].id, products[0].id];
    return [products[0].id, products[1].id];
  }

  async function createOwnedLead(
    ownerId: string,
    overrides: Record<string, unknown> = {},
  ) {
    const { countryId, currencyId } = await refs();
    const [sku] = await productIds();
    const lead = await leads.create(
      {
        customerName: `HF ${suffix()}`,
        mobileNumber: uniqueSaMobile(),
        countryId,
        currencyId,
        source: LeadSource.MANUAL,
        salesEmployeeId: ownerId,
        productId: sku,
        quantity: 1,
        ...overrides,
      },
      ownerId,
    );
    createdLeadIds.push(lead.id);
    return lead;
  }

  liveIt(
    'denies Sales Agent assign / reassign / bulk-assign of another agent',
    async () => {
      const agentA = await salesUser('Agent A');
      const agentB = await salesUser('Agent B');
      const lead = await createOwnedLead(agentA.id);
      const agentScope = await salesScope.resolve(agentA.id);
      expect(agentScope.kind).toBe('OWN');
      expect(salesScope.canAssignLeads(agentScope)).toBe(false);

      await expect(
        assignments.assign(lead.id, {
          salesEmployeeId: agentB.id,
          method: LeadAssignmentMethod.MANUAL,
          actorId: agentA.id,
          scope: agentScope,
        }),
      ).rejects.toThrow(ForbiddenException);

      await expect(
        leads.bulkAssign(
          { leadIds: [lead.id], salesEmployeeId: agentB.id },
          agentA.id,
          agentScope,
        ),
      ).rejects.toThrow(ForbiddenException);

      await expect(
        leads.create(
          {
            customerName: `HF steal ${suffix()}`,
            mobileNumber: uniqueSaMobile(),
            countryId: (await refs()).countryId,
            currencyId: (await refs()).currencyId,
            source: LeadSource.MANUAL,
            salesEmployeeId: agentB.id,
          },
          agentA.id,
        ),
      ).rejects.toThrow(ForbiddenException);
    },
  );

  liveIt('allows Team Manager within team and Admin globally', async () => {
    const teamManager = await salesUser('Team Manager');
    const agentA = await salesUser('TM Agent A');
    const agentB = await salesUser('TM Agent B');
    const outsider = await salesUser('Outsider');
    const admin = await managerUser('Admin Manager');
    await makeTeam(teamManager.id, [agentA.id, agentB.id]);
    const lead = await createOwnedLead(agentA.id);

    const teamScope = await salesScope.resolve(teamManager.id);
    expect(teamScope.kind).toBe('TEAM');
    await assignments.assign(lead.id, {
      salesEmployeeId: agentB.id,
      method: LeadAssignmentMethod.MANUAL,
      actorId: teamManager.id,
      scope: teamScope,
    });
    const reassigned = await leads.findOne(lead.id, teamScope);
    expect(reassigned.salesEmployeeId).toBe(agentB.id);

    await expect(
      assignments.assign(lead.id, {
        salesEmployeeId: outsider.id,
        method: LeadAssignmentMethod.MANUAL,
        actorId: teamManager.id,
        scope: teamScope,
      }),
    ).rejects.toThrow(ForbiddenException);

    const adminScope = await salesScope.resolve(admin.id);
    expect(adminScope.kind).toBe('ALL');
    await assignments.assign(lead.id, {
      salesEmployeeId: outsider.id,
      method: LeadAssignmentMethod.MANUAL,
      actorId: admin.id,
      scope: adminScope,
    });
    const adminMoved = await leads.findOne(lead.id, adminScope);
    expect(adminMoved.salesEmployeeId).toBe(outsider.id);
  });

  liveIt(
    'keeps workflow status unchanged when classification changes',
    async () => {
      const owner = await salesUser('Classify Owner');
      const ownerScope = await salesScope.resolve(owner.id);
      const hesitant = await classifications.create({
        name: `متردد ${suffix()}`,
        color: 'warning',
      });
      const interested = await classifications.create({
        name: `مهتم ${suffix()}`,
        color: 'success',
      });
      createdClassificationIds.push(hesitant.id, interested.id);

      const lead = await createOwnedLead(owner.id, {
        customerClassificationId: hesitant.id,
      });
      const historical = await createOwnedLead(owner.id, {
        customerClassificationId: hesitant.id,
      });
      await leads.firstOpen(lead.id, owner.id, ownerScope);
      const opened = await leads.findOne(lead.id, ownerScope);
      expect(opened.status.code).toBe('IN_PROGRESS');
      expect(opened.customerClassificationId).toBe(hesitant.id);

      const updated = await leads.update(
        lead.id,
        { customerClassificationId: interested.id },
        ownerScope,
      );
      expect(updated.customerClassificationId).toBe(interested.id);
      expect(updated.status.code).toBe('IN_PROGRESS');
      expect(updated.status.id).toBe(opened.status.id);

      const filtered = await leads.findAll(
        { classificationIds: [interested.id], lifecycle: 'active' },
        ownerScope,
      );
      expect(filtered.items.some((row) => row.id === lead.id)).toBe(true);

      await classifications.archive(hesitant.id, owner.id);
      const archivedList = await classifications.findAll({});
      expect(archivedList.items.some((row) => row.id === hesitant.id)).toBe(
        false,
      );

      const stillOnLead = await leads.findOne(historical.id, ownerScope);
      expect(stillOnLead.customerClassificationId).toBe(hesitant.id);
      expect(stillOnLead.customerClassification?.deletedAt).toBeTruthy();

      const other = await createOwnedLead(owner.id);
      await expect(
        leads.update(
          other.id,
          { customerClassificationId: hesitant.id },
          ownerScope,
        ),
      ).rejects.toThrow(/Archived or inactive/);
    },
  );

  liveIt(
    'closes without purchase, leaves active queue, and preserves reason',
    async () => {
      const owner = await salesUser('Close Owner');
      const ownerScope = await salesScope.resolve(owner.id);
      const reason = await reasons.create({
        name: `السعر مرتفع ${suffix()}`,
      });
      createdReasonIds.push(reason.id);
      const lead = await createOwnedLead(owner.id);
      await leads.firstOpen(lead.id, owner.id, ownerScope);
      await leads.addFollowUp(
        lead.id,
        {
          outcome: 'NO_ANSWER',
          note: 'first call',
          followUpAt: new Date().toISOString(),
        },
        owner.id,
        ownerScope,
      );
      await leads.closeWithoutPurchase(
        lead.id,
        { noPurchaseReasonId: reason.id, notes: 'will not buy' },
        owner.id,
        ownerScope,
      );
      const closed = await leads.findOne(lead.id, ownerScope);
      expect(['LOST', 'DISQUALIFIED']).toContain(closed.status.code);
      expect(closed.noPurchaseReasonId).toBe(reason.id);
      expect(closed.closeNotes).toBe('will not buy');

      const active = await leads.findAll({ lifecycle: 'active' }, ownerScope);
      expect(active.items.some((row) => row.id === lead.id)).toBe(false);
      const closedList = await leads.findAll(
        { lifecycle: 'closed' },
        ownerScope,
      );
      expect(closedList.items.some((row) => row.id === lead.id)).toBe(true);
      const followUps = await leads.listFollowUps(lead.id);
      expect(followUps.length).toBeGreaterThan(0);
    },
  );

  liveIt(
    'converts with independent agreed amounts, PREPAID claim, and COD not paid',
    async () => {
      const owner = await salesUser('Convert Owner');
      const ownerScope = await salesScope.resolve(owner.id);
      const [skuA, skuB] = await productIds();
      const paymentMethod = await prisma.paymentMethod.findFirst({
        where: { deletedAt: null },
        select: { id: true },
      });
      const receivingAccount = await prisma.receivingAccount.findFirst({
        where: { deletedAt: null, isActive: true },
        select: { id: true },
      });
      if (!receivingAccount) {
        throw new Error(
          'Receiving account required for conversion payment tests.',
        );
      }

      const prepaidLead = await createOwnedLead(owner.id, {
        source: LeadSource.GOOGLE_SHEETS,
      });
      await leads.firstOpen(prepaidLead.id, owner.id, ownerScope);
      const converted = await leads.convertToStoreOrder(
        prepaidLead.id,
        {
          items: [
            { productId: skuA, quantity: 3, agreedAmount: 500 },
            { productId: skuB, quantity: 1, agreedAmount: 80 },
          ],
          paymentType: 'PREPAID',
          paymentMethodId: paymentMethod?.id,
          amountPaid: 200,
          paymentReference: 'TX-HF-1',
          paymentProofUrl: 'https://example.com/proof.png',
          address: 'King Fahd Rd',
          city: 'Riyadh',
        },
        owner.id,
        ownerScope,
      );
      expect(converted?.status.code).toBe('CONVERTED');
      const prepaidOrder = await prisma.storeOrder.findFirst({
        where: { leadId: prepaidLead.id },
        include: { items: true, payments: true, receipts: true },
      });
      expect(prepaidOrder).toBeTruthy();
      expect(prepaidOrder?.employeeId).toBe(owner.id);
      expect(prepaidOrder?.source).toBe('GOOGLE_SHEETS');
      const line500 = prepaidOrder?.items.find(
        (item) => Number(item.agreedAmount) === 500,
      );
      expect(line500?.quantity).toBe(3);
      expect(Number(line500?.agreedAmount)).toBe(500);
      expect(Number(line500?.unitPrice)).not.toBe(1500);
      expect(prepaidOrder?.payments).toHaveLength(1);
      expect(prepaidOrder?.payments[0].status).toBe(PaymentStatus.PENDING);
      expect(Number(prepaidOrder?.payments[0].amount)).toBe(200);
      expect(
        prepaidOrder?.receipts.some(
          (row) => row.paymentId === prepaidOrder.payments[0].id,
        ),
      ).toBe(true);
      expect(prepaidOrder?.paymentStatus).not.toBe(
        StoreOrderPaymentStatus.FULLY_PAID_RECONCILED,
      );
      const activeAfterConvert = await leads.findAll(
        { lifecycle: 'active' },
        ownerScope,
      );
      expect(
        activeAfterConvert.items.some((row) => row.id === prepaidLead.id),
      ).toBe(false);

      const codLead = await createOwnedLead(owner.id);
      await leads.firstOpen(codLead.id, owner.id, ownerScope);
      await leads.convertToStoreOrder(
        codLead.id,
        {
          items: [
            { productId: skuA, quantity: 2, agreedAmount: 300 },
            { productId: skuB, quantity: 4, agreedAmount: 100 },
          ],
          paymentType: 'CASH_ON_DELIVERY',
          amountPaid: 0,
          address: 'Olaya',
          city: 'Riyadh',
        },
        owner.id,
        ownerScope,
      );
      const codOrder = await prisma.storeOrder.findFirst({
        where: { leadId: codLead.id },
        include: { items: true, payments: true },
      });
      expect(codOrder?.paymentType).toBe(
        StoreOrderPaymentType.CASH_ON_DELIVERY,
      );
      expect(codOrder?.shippingStage).toBe(
        StoreOrderShippingStage.READY_FOR_SHIPPING,
      );
      expect(codOrder?.payments).toHaveLength(0);
      expect(codOrder?.paymentStatus).not.toBe(
        StoreOrderPaymentStatus.FULLY_PAID_RECONCILED,
      );
      const qty2 = codOrder?.items.find((item) => item.quantity === 2);
      expect(Number(qty2?.agreedAmount)).toBe(300);
    },
  );

  liveIt(
    'normalizes Saudi phones on Lead create for local and international forms',
    async () => {
      const owner = await salesUser('Phone Owner');
      const { countryId, countryCode, currencyId } = await refs();
      if (countryCode !== 'SA') return;
      const inputs = [
        '0570267876',
        '570267876',
        '966570267876',
        '+966570267876',
      ];
      for (const input of inputs) {
        const parsed = phone.parse(input, 'SA');
        expect(parsed.isValid).toBe(true);
        expect(parsed.e164).toBe('+966570267876');
      }
      const national = uniqueSaMobile().replace('+966', '');
      const lead = await leads.create(
        {
          customerName: `Phone ${suffix()}`,
          mobileNumber: `0${national}`,
          countryId,
          currencyId,
          source: LeadSource.MANUAL,
          salesEmployeeId: owner.id,
        },
        owner.id,
      );
      createdLeadIds.push(lead.id);
      expect(lead.mobileNumber).toBe(`+966${national}`);
      const egypt = phone.parse('1001234567', 'EG');
      expect(egypt.e164).not.toBe('+966570267876');
      expect(egypt.e164?.startsWith('+20')).toBe(true);
    },
  );

  liveIt(
    'lists Leads and StoreOrders newest first with stable pagination',
    async () => {
      const owner = await salesUser('Sort Owner');
      const ownerScope = await salesScope.resolve(owner.id);
      const first = await createOwnedLead(owner.id);
      const second = await createOwnedLead(owner.id);
      const third = await createOwnedLead(owner.id);
      const page = await leads.findAll(
        {
          lifecycle: 'active',
          sortBy: 'createdAt',
          sortOrder: 'desc',
          pageSize: 50,
        },
        ownerScope,
      );
      const ids = page.items.map((row) => row.id);
      expect(ids.indexOf(third.id)).toBeLessThan(ids.indexOf(second.id));
      expect(ids.indexOf(second.id)).toBeLessThan(ids.indexOf(first.id));

      const [sku] = await productIds();
      for (const lead of [first, second, third]) {
        await leads.convertToStoreOrder(
          lead.id,
          {
            items: [{ productId: sku, quantity: 1, agreedAmount: 50 }],
            paymentType: 'CASH_ON_DELIVERY',
            amountPaid: 0,
            address: 'Street',
          },
          owner.id,
          ownerScope,
        );
      }
      const orders = await storeOrders.findAll(
        { sortBy: 'createdAt', sortOrder: 'desc', pageSize: 50 },
        owner.id,
      );
      const orderLeadIds = orders.items
        .filter((row) =>
          [first.id, second.id, third.id].includes(row.leadId ?? ''),
        )
        .map((row) => row.leadId);
      expect(orderLeadIds[0]).toBe(third.id);
      expect(orderLeadIds[1]).toBe(second.id);
      expect(orderLeadIds[2]).toBe(first.id);
    },
  );

  liveIt(
    'exposes newly created Department, Payment Method, and Classification dynamically',
    async () => {
      const dept = await departments.create({
        name: `قسم المبيعات ${suffix()}`,
        isActive: true,
      });
      createdDepartmentIds.push(dept.id);
      const deptList = await departments.findAll({});
      expect(deptList.items.some((row) => row.id === dept.id)).toBe(true);

      const account = await prisma.chartOfAccount.findFirst({
        where: { deletedAt: null, allowsPosting: true },
        select: { id: true },
      });
      if (!account) throw new Error('Chart of Accounts posting row required.');
      const method = await paymentMethods.create({
        name: `STC Pay ${suffix()}`,
        accountId: account.id,
      });
      createdPaymentMethodIds.push(method.id);
      const methodList = await paymentMethods.findAll({});
      expect(methodList.items.some((row) => row.id === method.id)).toBe(true);

      const classification = await classifications.create({
        name: `عميل محتمل قوي ${suffix()}`,
        color: 'info',
      });
      createdClassificationIds.push(classification.id);
      const classList = await classifications.findAll({});
      expect(classList.items.some((row) => row.id === classification.id)).toBe(
        true,
      );

      await departments.archive(dept.id);
      await paymentMethods.archive(method.id);
      await classifications.archive(classification.id);
      expect(
        (await departments.findAll({})).items.some((row) => row.id === dept.id),
      ).toBe(false);
      expect(
        (await paymentMethods.findAll({})).items.some(
          (row) => row.id === method.id,
        ),
      ).toBe(false);
      expect(
        (await classifications.findAll({})).items.some(
          (row) => row.id === classification.id,
        ),
      ).toBe(false);

      await departments.restore(dept.id);
      await paymentMethods.restore(method.id);
      await classifications.restore(classification.id);
      expect(
        (await departments.findAll({})).items.some((row) => row.id === dept.id),
      ).toBe(true);
      expect(
        (await paymentMethods.findAll({})).items.some(
          (row) => row.id === method.id,
        ),
      ).toBe(true);
      expect(
        (await classifications.findAll({})).items.some(
          (row) => row.id === classification.id,
        ),
      ).toBe(true);
    },
  );

  liveIt(
    'suggests outstanding amount from verified payments only',
    async () => {
      const owner = await salesUser('Pay Owner');
      const ownerScope = await salesScope.resolve(owner.id);
      const [sku] = await productIds();
      const lead = await createOwnedLead(owner.id);
      await leads.convertToStoreOrder(
        lead.id,
        {
          items: [{ productId: sku, quantity: 1, agreedAmount: 500 }],
          paymentType: 'PREPAID',
          amountPaid: 0,
          address: 'Pay St',
        },
        owner.id,
        ownerScope,
      );
      const order = await prisma.storeOrder.findFirst({
        where: { leadId: lead.id },
      });
      if (!order) throw new Error('Converted order missing.');
      const empty = await storeOrders.paymentContext(order.id, owner.id);
      expect(empty.total).toBe('500.00');
      expect(empty.outstanding).toBe('500.00');

      const source = await prisma.paymentSource.findFirst({
        where: { deletedAt: null, isActive: true },
      });
      const account = await prisma.receivingAccount.findFirst({
        where: { deletedAt: null, isActive: true },
      });
      if (!source || !account)
        throw new Error('Payment source/account required.');
      const payment = await prisma.payment.create({
        data: {
          paymentNumber: `PAY-HF-${suffix()}`,
          storeOrderId: order.id,
          paymentDate: new Date(),
          amount: 200,
          currencyId: order.currencyId,
          paymentSourceId: source.id,
          receivingAccountId: account.id,
          senderName: 'Customer',
          status: PaymentStatus.VERIFIED,
        },
      });
      const after200 = await storeOrders.paymentContext(order.id, owner.id);
      expect(after200.paid).toBe('200.00');
      expect(after200.outstanding).toBe('300.00');

      await prisma.payment.create({
        data: {
          paymentNumber: `PAY-HF-${suffix()}`,
          storeOrderId: order.id,
          paymentDate: new Date(),
          amount: 100,
          currencyId: order.currencyId,
          paymentSourceId: source.id,
          receivingAccountId: account.id,
          senderName: 'Customer',
          status: PaymentStatus.VERIFIED,
        },
      });
      const after100 = await storeOrders.paymentContext(order.id, owner.id);
      expect(after100.outstanding).toBe('200.00');
      void payment;
    },
  );
});
