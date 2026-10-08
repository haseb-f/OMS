/**
 * Agents / Fulfillment Partners — tagged demo data (specs/agents-fulfillment-partners
 * brief §12). Idempotent; runnable against local and (later) Production like
 * ensure-qa-users.ts.
 *
 *   cd apps/api
 *   AGENT_DEMO_PASSWORD=... npx ts-node --transpile-only prisma/scripts/ensure-agents-demo.ts
 *
 * Env:
 *   AGENT_DEMO_PASSWORD           (required, ≥ 10 chars) password of every demo agent user
 *   AGENT_DEMO_ACTOR_EMAIL        internal actor for createdBy (default qa-admin@oms.haseb.org,
 *                                 else the oldest active super admin)
 *   AGENT_DEMO_CONFIGURE_POSTING=1  LOCAL ONLY: create three demo-tagged GL accounts and set the
 *                                 PostingSettings agent accounts when they are empty (refused
 *                                 unless DATABASE_URL points at localhost/127.0.0.1).
 *
 * Safety: every record this script creates carries DEMO-AGT-20260928 in its name, label,
 * code, email or reason. Existing non-demo data is only *referenced* (functional currency,
 * country, default warehouse, first category/unit) — never modified. The one exception is
 * explicitly requested: the internal QA personas qa-shipping / qa-finance receive the
 * additional agents.* permissions they need (rows are only added, never removed).
 * Business rules apply because every write goes through the real Nest services
 * (Nest application context) — the only direct writes are the demo users' password hash /
 * mustChangePassword (same approach as ensure-qa-users.ts) and the QA persona grants.
 */
import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AccountType, type Prisma } from '@prisma/client';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AgentsService } from '../../src/agents/admin/agents.service';
import { AgentAgreementsService } from '../../src/agents/admin/agent-agreements.service';
import { AgentShippingAgreementsService } from '../../src/agents/shipping-agreements/agent-shipping-agreements.service';
import {
  activateShippingAgreement,
  everyService,
} from '../../src/agents/shipping-agreements/shipping-agreement.fixture';
import {
  dateOnly,
  inForceWhere,
} from '../../src/agents/shipping-agreements/shipping-agreement-resolution';
import { AgentDestinationsService } from '../../src/agents/admin/agent-destinations.service';
import { AgentUsersService } from '../../src/agents/admin/agent-users.service';
import { ProductsService } from '../../src/products/products.service';
import { InventoryService } from '../../src/inventory/inventory.service';
import { ChartOfAccountsService } from '../../src/chart-of-accounts/chart-of-accounts.service';
import { PaymentMethodsService } from '../../src/payment-methods/payment-methods.service';
import { ReceivingAccountsService } from '../../src/receiving-accounts/receiving-accounts.service';
import { ExchangeRatesService } from '../../src/accounting/fx/exchange-rates.service';
import { PostingSettingsService } from '../../src/accounting/posting-settings/posting-settings.service';
import { hashPassword } from '../../src/auth/password.util';
import {
  AGENT_ROLE_PRESETS,
  ALL_PERMISSION_NAMES,
  type AgentPortalPermission,
} from '../../src/permissions/permission-catalog';

export const AGENT_DEMO_TAG = 'DEMO-AGT-20260928';
const T = AGENT_DEMO_TAG;

type Owner = 'COMPANY' | 'AGENT';

interface AgentSpec {
  key: 'A' | 'B';
  name: string;
  email: string;
  terms: {
    productCommissionRatePercent: number;
    serviceCommissionRatePercent: number;
    shippingPolicy: 'FLAT_FEE_PER_SHIPMENT';
    commissionEarningEvent: 'DELIVERED' | 'PAYMENT_VERIFIED';
    returnCommissionTreatment: 'REVERSE' | 'RETAIN';
    customerShippingChargeOwner: Owner;
    shippingFeePerShipment: number;
    returnFeePerShipment: number;
    serviceFeePerOrder: number;
    providerFeesBorneBy: Owner;
    allowAgentDestinations: boolean;
    payoutHoldDays: number;
  };
  destinations: Array<{
    method: 'RECONCILED' | 'BANK' | 'WALLET';
    ownership: Owner;
    label: string;
  }>;
  products: Array<{
    key: string;
    name: string;
    physical: boolean;
    salesPrice: number;
    openingQty: number;
  }>;
  users: Array<{
    key: string;
    email: string;
    username: string;
    fullName: string;
    agentRole: 'ADMIN' | 'SALES';
    extra: AgentPortalPermission[];
  }>;
}

const AGENTS: AgentSpec[] = [
  {
    key: 'A',
    name: `وكيل تجريبي A — ${T}`,
    email: 'agent-a.demo-agt@oms.local',
    terms: {
      productCommissionRatePercent: 10,
      serviceCommissionRatePercent: 10,
      shippingPolicy: 'FLAT_FEE_PER_SHIPMENT',
      commissionEarningEvent: 'DELIVERED',
      returnCommissionTreatment: 'REVERSE',
      customerShippingChargeOwner: 'COMPANY',
      shippingFeePerShipment: 30,
      returnFeePerShipment: 20,
      serviceFeePerOrder: 0,
      providerFeesBorneBy: 'AGENT',
      allowAgentDestinations: true,
      payoutHoldDays: 0,
    },
    destinations: [
      {
        method: 'RECONCILED',
        ownership: 'COMPANY',
        label: `بوابة دفع الشركة (تسوية) — ${T}`,
      },
      {
        method: 'BANK',
        ownership: 'COMPANY',
        label: `تحويل بنكي لحساب الشركة — ${T}`,
      },
      {
        method: 'WALLET',
        ownership: 'AGENT',
        label: `محفظة الوكيل A — ${T}`,
      },
    ],
    products: [
      {
        key: 'A-PHYS',
        name: `منتج الوكيل A — ${T}`,
        physical: true,
        salesPrice: 500,
        openingQty: 200,
      },
      {
        key: 'A-COURSE',
        name: `دورة رقمية للوكيل A — ${T}`,
        physical: false,
        salesPrice: 400,
        openingQty: 0,
      },
    ],
    users: [
      {
        key: 'A-ADMIN',
        email: 'agent-a-admin.demo-agt@oms.local',
        username: 'agent-a-admin.demo-agt',
        fullName: `مدير الوكيل A — ${T}`,
        agentRole: 'ADMIN',
        extra: ['agent.team.manage'],
      },
      {
        key: 'A-SALES1',
        email: 'agent-a-sales1.demo-agt@oms.local',
        username: 'agent-a-sales1.demo-agt',
        fullName: `مبيعات الوكيل A (1) — ${T}`,
        agentRole: 'SALES',
        extra: [],
      },
      {
        key: 'A-SALES2',
        email: 'agent-a-sales2.demo-agt@oms.local',
        username: 'agent-a-sales2.demo-agt',
        fullName: `مبيعات الوكيل A (2) — ${T}`,
        agentRole: 'SALES',
        extra: [],
      },
    ],
  },
  {
    key: 'B',
    name: `وكيل تجريبي B — ${T}`,
    email: 'agent-b.demo-agt@oms.local',
    terms: {
      productCommissionRatePercent: 8,
      serviceCommissionRatePercent: 8,
      shippingPolicy: 'FLAT_FEE_PER_SHIPMENT',
      commissionEarningEvent: 'PAYMENT_VERIFIED',
      returnCommissionTreatment: 'RETAIN',
      customerShippingChargeOwner: 'AGENT',
      shippingFeePerShipment: 25,
      returnFeePerShipment: 15,
      serviceFeePerOrder: 5,
      providerFeesBorneBy: 'COMPANY',
      allowAgentDestinations: false,
      payoutHoldDays: 0,
    },
    destinations: [
      {
        method: 'BANK',
        ownership: 'COMPANY',
        label: `تحويل بنكي لحساب الشركة — ${T}`,
      },
    ],
    products: [
      {
        key: 'B-PHYS',
        name: `منتج الوكيل B — ${T}`,
        physical: true,
        salesPrice: 300,
        openingQty: 100,
      },
      {
        key: 'B-COURSE',
        name: `دورة رقمية للوكيل B — ${T}`,
        physical: false,
        salesPrice: 250,
        openingQty: 0,
      },
    ],
    users: [
      {
        key: 'B-ADMIN',
        email: 'agent-b-admin.demo-agt@oms.local',
        username: 'agent-b-admin.demo-agt',
        fullName: `مدير الوكيل B — ${T}`,
        agentRole: 'ADMIN',
        extra: ['agent.team.manage'],
      },
      {
        key: 'B-SALES1',
        email: 'agent-b-sales1.demo-agt@oms.local',
        username: 'agent-b-sales1.demo-agt',
        fullName: `مبيعات الوكيل B — ${T}`,
        agentRole: 'SALES',
        extra: [],
      },
    ],
  },
];

/** Demo shipping rates (functional currency EGP): whole country + one city row. */
const RATES = [
  { city: '', amount: 100 },
  { city: 'الإسكندرية', amount: 150 },
];

/** Internal QA personas — additive grants only. */
const INTERNAL_GRANTS: Record<string, string[]> = {
  // Shipping keeps the whole shipping.* set: `shipping.manage` is what starts a
  // shipment from Store Orders (bulk «تغيير حالة الشحن»).
  'qa-shipping@oms.haseb.org': [
    'agents.view',
    'shipping.view',
    'shipping.create',
    'shipping.edit',
    'shipping.manage',
    'shipping.import',
    'shipping.export',
    'shipping.print',
  ],
  'qa-finance@oms.haseb.org': [
    'agents.view',
    'agents.finance.view',
    'agents.finance.verify',
    'agents.finance.post',
    'agents.finance.adjust',
    'agents.payouts.create',
    'agents.payouts.reverse',
    'agents.statement.print',
  ],
};

const todayIso = () => new Date().toISOString().slice(0, 10);
const isLocalDb = () =>
  /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? '');

export async function ensureAgentsDemo(
  app: Awaited<ReturnType<typeof NestFactory.createApplicationContext>>,
  password: string,
  opts: { configurePosting?: boolean } = {},
) {
  if (!password || password.length < 10) {
    throw new Error(
      'AGENT_DEMO_PASSWORD must be set to at least 10 characters.',
    );
  }
  const get = <X>(cls: new (...args: never[]) => X) =>
    app.get(cls, { strict: false });
  const prisma = get(PrismaService);
  const agents = get(AgentsService);
  const agreements = get(AgentAgreementsService);
  const shippingAgreements = get(AgentShippingAgreementsService);
  const destinations = get(AgentDestinationsService);
  const agentUsers = get(AgentUsersService);
  const products = get(ProductsService);
  const inventory = get(InventoryService);
  const coa = get(ChartOfAccountsService);
  const methods = get(PaymentMethodsService);
  const receiving = get(ReceivingAccountsService);
  const fx = get(ExchangeRatesService);
  const postingSettings = get(PostingSettingsService);

  const log: string[] = [];
  const note = (line: string) => {
    log.push(line);
    console.log(line);
  };

  // ── references (read-only) ──────────────────────────────────────────────
  const actorEmail =
    process.env.AGENT_DEMO_ACTOR_EMAIL ?? 'qa-admin@oms.haseb.org';
  const actor =
    (await prisma.user.findFirst({
      where: { email: actorEmail, deletedAt: null, userType: 'INTERNAL' },
      select: { id: true, email: true },
    })) ??
    (await prisma.user.findFirst({
      where: {
        isSuperAdmin: true,
        isActive: true,
        deletedAt: null,
        userType: 'INTERNAL',
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true, email: true },
    }));
  if (!actor) throw new Error('No internal actor user found.');
  const currencyId = await fx.requireFunctionalCurrencyId();
  const currency = await prisma.currency.findUniqueOrThrow({
    where: { id: currencyId },
    select: { code: true },
  });
  const egypt = await prisma.country.findFirst({
    where: { code: 'EG', deletedAt: null },
    select: { id: true, name: true },
  });
  if (!egypt) throw new Error('Country EG not found.');
  const warehouse = await prisma.warehouse.findFirst({
    where: { isActive: true, deletedAt: null },
    orderBy: [{ isDefault: 'desc' }, { name: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, code: true },
  });
  if (!warehouse) throw new Error('No active warehouse.');
  const category = await prisma.productCategory.findFirst({
    where: { deletedAt: null },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  const unit = await prisma.unit.findFirst({
    where: { deletedAt: null },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (!category || !unit) throw new Error('No product category / unit.');
  note(
    `actor=${actor.email} currency=${currency.code} country=EG warehouse=${warehouse.code}`,
  );

  // ── demo GL accounts, receiving account, payment methods ───────────────
  async function ensureAccount(name: string, accountType: AccountType) {
    const existing = await prisma.chartOfAccount.findFirst({
      where: { name, deletedAt: null },
      select: { id: true, code: true },
    });
    if (existing) return existing;
    const created = await coa.create({ name, accountType }, actor!.id);
    note(`+ account ${created.code} ${name}`);
    return { id: created.id, code: created.code };
  }
  const clearingAccount = await ensureAccount(
    `مقاصة بوابة الدفع التجريبية — ${T}`,
    AccountType.ASSET,
  );
  const bankAccount = await ensureAccount(
    `بنك الوكلاء التجريبي — ${T}`,
    AccountType.ASSET,
  );

  const raCode = 'DEMO-AGT-20260928-BANK';
  let receivingAccount = await prisma.receivingAccount.findFirst({
    where: { code: raCode, deletedAt: null },
    select: { id: true },
  });
  if (!receivingAccount) {
    receivingAccount = await receiving.create({
      name: `حساب استلام بنك الوكلاء — ${T}`,
      code: raCode,
      chartOfAccountId: bankAccount.id,
      currencyId,
      notes: T,
    });
    note(`+ receiving account ${raCode}`);
  }

  async function ensureMethod(
    name: string,
    accountId: string,
    requiresReconciliation: boolean,
  ) {
    const existing = await prisma.paymentMethod.findFirst({
      where: { name, deletedAt: null },
      select: { id: true },
    });
    if (existing) return existing.id;
    const created = await methods.create(
      {
        name,
        accountId,
        requiresReconciliation,
        isActive: true,
        description: T,
      },
      actor!.id,
    );
    note(`+ payment method ${name}`);
    return created.id;
  }
  const methodIds = {
    RECONCILED: await ensureMethod(
      `بوابة دفع تجريبية (تتطلب تسوية) — ${T}`,
      clearingAccount.id,
      true,
    ),
    BANK: await ensureMethod(`تحويل بنكي تجريبي — ${T}`, bankAccount.id, false),
    WALLET: await ensureMethod(
      `محفظة الوكيل التجريبية — ${T}`,
      bankAccount.id,
      false,
    ),
  };

  // ── agents ──────────────────────────────────────────────────────────────
  const summary: Record<string, unknown> = {
    tag: T,
    currency: currency.code,
    receivingAccountId: receivingAccount.id,
    paymentMethods: methodIds,
    agents: {},
  };

  for (const spec of AGENTS) {
    let agent = await prisma.agent.findFirst({
      where: { name: spec.name, deletedAt: null },
      select: { id: true, agentNumber: true, status: true },
    });
    if (!agent) {
      const created = await agents.create(
        {
          name: spec.name,
          legalName: spec.name,
          contactName: `مسؤول الوكيل ${spec.key} — ${T}`,
          email: spec.email,
          countryId: egypt.id,
          currencyId,
          notes: `بيانات تجريبية — ${T}`,
        },
        actor.id,
      );
      agent = {
        id: created.id,
        agentNumber: created.agentNumber,
        status: created.status,
      };
      note(`+ agent ${agent.agentNumber} ${spec.name}`);
    }
    if (agent.status !== 'ACTIVE') {
      await agents.setStatus(agent.id, 'ACTIVE', actor.id);
    }

    // Shipping agreement in force today (R15 D15-13): the demo charges for
    // every service, Egypt-wide with a city override.
    const shippingInForce = await prisma.agentShippingAgreement.findFirst({
      where: inForceWhere(agent.id, dateOnly(todayIso())),
      select: { id: true },
    });
    if (!shippingInForce) {
      const shipping = await activateShippingAgreement(
        shippingAgreements,
        agent.id,
        RATES.flatMap((rate) =>
          everyService(rate.amount, { countryId: egypt.id, city: rate.city }),
        ),
        actor.id,
        { effectiveFrom: todayIso() },
      );
      note(`+ shipping agreement ${shipping.agreementNumber} for ${spec.key}`);
    }

    // Agreement in force today (ACTIVE). Created DRAFT → ACTIVE.
    const today = new Date(`${todayIso()}T00:00:00.000Z`);
    let agreement = await prisma.agentAgreement.findFirst({
      where: {
        agentId: agent.id,
        // An agreement ended with a future last day is still in force today.
        status: { in: ['ACTIVE', 'ENDED'] },
        effectiveFrom: { lte: today },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: today } }],
      },
      select: {
        id: true,
        agreementNumber: true,
        productCommissionRatePercent: true,
      },
    });
    if (!agreement) {
      const draft = await agreements.create(
        agent.id,
        {
          effectiveFrom: todayIso(),
          ...spec.terms,
          notes: `شروط تجريبية صريحة — ${T}`,
        },
        actor.id,
      );
      await agreements.activate(agent.id, draft.id, actor.id);
      agreement = {
        id: draft.id,
        agreementNumber: draft.agreementNumber,
        productCommissionRatePercent: draft.productCommissionRatePercent,
      };
      note(`+ agreement ${draft.agreementNumber} (ACTIVE) for ${spec.key}`);
    }

    // Payment destinations
    const existingDest = await destinations.list(agent.id);
    const destIds: Record<string, string> = {};
    for (const d of spec.destinations) {
      const methodId = methodIds[d.method];
      const found = existingDest.find(
        (row) =>
          row.paymentMethodId === methodId && row.ownership === d.ownership,
      );
      if (found) {
        if (!found.isActive)
          await destinations.setActive(agent.id, found.id, true);
        destIds[d.method] = found.id;
        continue;
      }
      const created = await destinations.create(
        agent.id,
        {
          paymentMethodId: methodId,
          ownership: d.ownership,
          label: d.label,
          details: `بيانات حساب تجريبية — ${T}`,
        },
        actor.id,
      );
      destIds[d.method] = created.id;
      note(`+ destination ${d.label}`);
    }

    // Agent-owned products + stock receipt (opening balance, no cost / no JE)
    const productIds: Record<string, string> = {};
    for (const p of spec.products) {
      let product = await prisma.product.findFirst({
        where: { name: p.name, ownerAgentId: agent.id, deletedAt: null },
        select: { id: true, sku: true },
      });
      if (!product) {
        const data = {
          name: p.name,
          internalName: p.name,
          displayName: p.name,
          categoryId: category.id,
          unitId: unit.id,
          type: p.physical ? 'PURCHASE_AND_SALE' : 'SERVICE',
          status: 'ACTIVE',
          isSellable: true,
          isPurchasable: p.physical,
          isInventoryItem: p.physical,
          itemType: p.physical ? 'PRODUCT' : 'SERVICE',
          salesPrice: p.salesPrice,
          preferredWarehouseId: p.physical ? warehouse.id : undefined,
          ...(p.physical
            ? { weight: 1, width: 10, height: 10, length: 10 }
            : {}),
          searchKeywords: T,
          ownerAgentId: agent.id,
        } as unknown as Parameters<ProductsService['create']>[0];
        const created = await products.create(data, actor.id);
        product = { id: created.id, sku: created.sku };
        note(`+ product ${created.sku} ${p.name}`);
      }
      productIds[p.key] = product.id;
      if (p.physical && p.openingQty > 0) {
        const moved = await prisma.inventoryMovement.count({
          where: { productId: product.id },
        });
        if (moved === 0) {
          await inventory.openingBalance(
            {
              productId: product.id,
              warehouseId: warehouse.id,
              quantity: p.openingQty,
              notes: `استلام مخزون الوكيل ${spec.key} — ${T}`,
            },
            actor.id,
          );
          note(`+ stock ${p.openingQty} × ${product.sku} @ ${warehouse.code}`);
        }
      }
    }

    // Agent users (created through AgentUsersService; demo password set after).
    const passwordHash = await hashPassword(password);
    const userIds: Record<string, string> = {};
    for (const u of spec.users) {
      let user = await prisma.user.findFirst({
        where: { email: u.email },
        select: { id: true, agentId: true, userType: true },
      });
      if (user && (user.userType !== 'AGENT' || user.agentId !== agent.id)) {
        throw new Error(
          `${u.email} exists but is not a user of ${spec.name} — refusing to touch it.`,
        );
      }
      const permissions = [
        ...new Set([...AGENT_ROLE_PRESETS[u.agentRole], ...u.extra]),
      ] as AgentPortalPermission[];
      if (!user) {
        const created = await agentUsers.create(
          agent.id,
          {
            email: u.email,
            username: u.username,
            fullName: u.fullName,
            agentRole: u.agentRole,
            extraPermissions: u.extra,
          },
          actor.id,
        );
        user = { id: created.id, agentId: agent.id, userType: 'AGENT' };
        note(`+ agent user ${u.email} (${u.agentRole})`);
      } else {
        await agentUsers.setPermissions(agent.id, user.id, permissions);
      }
      // Demo only: known password, no forced change (explicit, after creation).
      await prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          mustChangePassword: false,
          isActive: true,
          isLocked: false,
        } satisfies Prisma.UserUpdateInput,
      });
      userIds[u.key] = user.id;
    }

    (summary.agents as Record<string, unknown>)[spec.key] = {
      id: agent.id,
      agentNumber: agent.agentNumber,
      name: spec.name,
      agreement: agreement.agreementNumber,
      destinations: destIds,
      products: productIds,
      users: spec.users.map((u) => u.email),
    };
  }

  // ── internal personas (additive grants) ────────────────────────────────
  for (const [email, names] of Object.entries(INTERNAL_GRANTS)) {
    const user = await prisma.user.findFirst({
      where: { email, deletedAt: null, userType: 'INTERNAL' },
      select: { id: true },
    });
    if (!user) {
      note(`! internal persona ${email} not found — run ensure-qa-users first`);
      continue;
    }
    for (const name of names) {
      if (!ALL_PERMISSION_NAMES.includes(name)) {
        note(`! permission ${name} not in catalog`);
        continue;
      }
      // Catalog row (same upsert as prisma/provision-permissions.ts).
      const permission = await prisma.permission.upsert({
        where: { name },
        update: {},
        create: { name, description: `Permission Matrix: ${name}` },
        select: { id: true },
      });
      await prisma.userPermission.upsert({
        where: {
          userId_permissionId: { userId: user.id, permissionId: permission.id },
        },
        update: {},
        create: { userId: user.id, permissionId: permission.id },
      });
    }
  }

  // ── (C) local posting accounts ─────────────────────────────────────────
  if (opts.configurePosting) {
    if (!isLocalDb()) {
      throw new Error(
        'AGENT_DEMO_CONFIGURE_POSTING is local-only (DATABASE_URL is not localhost).',
      );
    }
    const settings = await postingSettings.get();
    const payable = await ensureAccount(
      `ذمم أموال الوكلاء — ${T}`,
      AccountType.LIABILITY,
    );
    const commission = await ensureAccount(
      `إيراد عمولة الوكلاء — ${T}`,
      AccountType.REVENUE,
    );
    const service = await ensureAccount(
      `إيراد خدمات التنفيذ للوكلاء — ${T}`,
      AccountType.REVENUE,
    );
    const patch: Record<string, string> = {};
    if (!settings.agentFundsPayableAccountId)
      patch.agentFundsPayableAccountId = payable.id;
    if (!settings.agentCommissionRevenueAccountId)
      patch.agentCommissionRevenueAccountId = commission.id;
    if (!settings.agentServiceRevenueAccountId)
      patch.agentServiceRevenueAccountId = service.id;
    if (Object.keys(patch).length) {
      await postingSettings.update(patch, actor.id);
      note(
        `+ posting settings agent accounts: ${Object.keys(patch).join(', ')}`,
      );
    } else {
      note('= posting settings agent accounts already configured (kept)');
    }
    summary.postingAccounts = {
      payable: payable.code,
      commission: commission.code,
      service: service.code,
    };
  }

  summary.log = log;
  return summary;
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const summary = await ensureAgentsDemo(
      app,
      process.env.AGENT_DEMO_PASSWORD ?? '',
      { configurePosting: process.env.AGENT_DEMO_CONFIGURE_POSTING === '1' },
    );
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
