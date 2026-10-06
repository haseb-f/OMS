import { ForbiddenException } from '@nestjs/common';
import { PartnerRoleType, PartnerStatus } from '@prisma/client';
import type { PermissionsResolverService } from '../permissions/permissions-resolver.service';
import type { JwtPayload } from '../auth/guards/jwt-auth.guard';
import type { PrismaService } from '../prisma/prisma.service';
import type { MasterDataActivityLogService } from '../master-data/master-data-activity-log.service';
import type { NumberingEngineService } from '../numbering/numbering-engine.service';
import type { PhoneNumberService } from '../common/phone/phone-number.service';
import { PartnersController } from './partners.controller';
import { PartnersService } from './partners.service';
import type { FindOrCreatePartnerDto } from './dto/find-or-create-partner.dto';

/**
 * SEC-03 H3 — POST /partners/find-or-create matches on phone/email/tax
 * number/CR, so it must not hand a caller without `partners.view` the full
 * record, and must not let Quick Create re-purpose an HR/investor identity.
 */

const { CUSTOMER, SUPPLIER, EMPLOYEE, INVESTOR } = PartnerRoleType;
const user = { sub: 'user-1' } as JwtPayload;

function fullPartner(roles: PartnerRoleType[]) {
  return {
    id: 'p1',
    partnerNumber: 'PT-1',
    name: 'Existing Partner',
    commercialName: null,
    legalName: 'Legal',
    status: PartnerStatus.ACTIVE,
    phone: '+966500000000',
    mobile: null,
    email: 'x@example.test',
    city: 'Riyadh',
    address: 'Street 1',
    countryId: 'sa',
    taxNumber: 'TAX-9',
    commercialRegistration: 'CR-9',
    notes: 'internal',
    currencyId: null,
    currency: null,
    roles: roles.map((role, i) => ({
      id: `r${i}`,
      role,
      createdAt: new Date('2026-01-01'),
    })),
    customerProfile: roles.includes(CUSTOMER)
      ? { id: 'cp', creditLimit: '100', paymentTermId: null, paymentTerm: null }
      : null,
    supplierProfile: null,
    employeeProfile: roles.includes(EMPLOYEE) ? { id: 'ep' } : null,
    investorProfile: roles.includes(INVESTOR)
      ? { id: 'ip', nationalId: 'NID-9', iban: 'SA99' }
      : null,
    receivableBalance: 10,
    payableBalance: 20,
  };
}

describe('PartnersService.findOrCreateWithRole — sensitive identity guard', () => {
  function build(existingRoles: PartnerRoleType[] | null) {
    const service = new PartnersService(
      {} as PrismaService,
      {} as MasterDataActivityLogService,
      {} as NumberingEngineService,
      {
        parse: (value: string) => ({ isValid: true, e164: value }),
        lookupCandidates: (value: string) => [value],
        resolveWithoutCountry: (value: string) => ({
          e164: value,
          ambiguous: [],
        }),
      } as unknown as PhoneNumberService,
    );
    const internals = service as unknown as {
      findDuplicate: jest.Mock;
      findOne: jest.Mock;
      assignRole: jest.Mock;
      create: jest.Mock;
    };
    internals.findDuplicate = jest
      .fn()
      .mockResolvedValue(existingRoles ? { id: 'p1' } : null);
    internals.findOne = jest
      .fn()
      .mockResolvedValue(existingRoles ? fullPartner(existingRoles) : null);
    internals.assignRole = jest
      .fn()
      .mockResolvedValue(fullPartner([...(existingRoles ?? []), CUSTOMER]));
    internals.create = jest.fn().mockResolvedValue(fullPartner([CUSTOMER]));
    return { service, internals };
  }

  const dto = {
    name: 'Someone',
    phone: '+966500000000',
    role: CUSTOMER,
  } as FindOrCreatePartnerDto;

  it.each([[EMPLOYEE], [INVESTOR]])(
    'DENIED: attaching CUSTOMER to an existing %s partner without partners.edit',
    async (sensitive) => {
      const { service, internals } = build([sensitive]);
      await expect(
        service.findOrCreateWithRole(dto, 'user-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(internals.assignRole).not.toHaveBeenCalled();
    },
  );

  it('ALLOWED: the same attach with partners.edit', async () => {
    const { service, internals } = build([EMPLOYEE]);
    const result = await service.findOrCreateWithRole(dto, 'user-1', {
      mayExtendSensitiveIdentity: true,
    });
    expect(internals.assignRole).toHaveBeenCalledWith('p1', CUSTOMER, 'user-1');
    expect(result.created).toBe(false);
  });

  it('ALLOWED: attaching to a plain SUPPLIER partner needs no extra right', async () => {
    const { service, internals } = build([SUPPLIER]);
    await service.findOrCreateWithRole(dto, 'user-1');
    expect(internals.assignRole).toHaveBeenCalled();
  });

  it('ALLOWED: reusing an EMPLOYEE partner that already holds the requested role attaches nothing', async () => {
    const { service, internals } = build([EMPLOYEE, CUSTOMER]);
    const result = await service.findOrCreateWithRole(dto, 'user-1');
    expect(internals.assignRole).not.toHaveBeenCalled();
    expect(result.created).toBe(false);
  });

  it('creates a new partner when nothing matches', async () => {
    const { service, internals } = build(null);
    const result = await service.findOrCreateWithRole(dto, 'user-1');
    expect(internals.create).toHaveBeenCalled();
    expect(result.created).toBe(true);
  });
});

describe('PartnersController.findOrCreate — response projection', () => {
  function build(opts: {
    superAdmin?: boolean;
    grants: string[];
    roles: PartnerRoleType[];
  }) {
    const findOrCreateWithRole = jest.fn().mockResolvedValue({
      partner: fullPartner(opts.roles),
      created: false,
    });
    const controller = new PartnersController(
      { findOrCreateWithRole } as unknown as PartnersService,
      {
        isSuperAdmin: jest.fn().mockResolvedValue(opts.superAdmin ?? false),
        getPermissions: jest.fn().mockResolvedValue(new Set(opts.grants)),
      } as unknown as PermissionsResolverService,
    );
    return { controller, findOrCreateWithRole };
  }
  const dto = { name: 'Someone', role: CUSTOMER } as FindOrCreatePartnerDto;
  const FORBIDDEN_KEYS = [
    'taxNumber',
    'commercialRegistration',
    'notes',
    'legalName',
    'investorProfile',
    'employeeProfile',
    'supplierProfile',
    'payableBalance',
  ];

  it('picker projection (+ created) for a partners.create-only caller, roles narrowed to the requested role', async () => {
    const { controller, findOrCreateWithRole } = build({
      grants: ['partners.create'],
      roles: [CUSTOMER, SUPPLIER],
    });
    const result = await controller.findOrCreate(dto, user);
    expect(findOrCreateWithRole).toHaveBeenCalledWith(dto, 'user-1', {
      mayExtendSensitiveIdentity: false,
    });
    expect(result.created).toBe(false);
    expect(result.partner).not.toHaveProperty('phone');
    expect(result.partner).not.toHaveProperty('receivableBalance');
    for (const key of FORBIDDEN_KEYS)
      expect(result.partner).not.toHaveProperty(key);
    expect(result.partner.roles.map((r) => r.role)).toEqual([CUSTOMER]);
  });

  it('a Store Order creator keeps the CUSTOMER detail block its form copies (still no sensitive fields)', async () => {
    const { controller } = build({
      grants: ['partners.create', 'store-orders.create'],
      roles: [CUSTOMER],
    });
    const result = await controller.findOrCreate(dto, user);
    expect(result.partner).toHaveProperty('phone', '+966500000000');
    expect(result.partner).toHaveProperty('address', 'Street 1');
    for (const key of FORBIDDEN_KEYS)
      expect(result.partner).not.toHaveProperty(key);
  });

  it('partners.view (and partners.edit) callers get the full row and may extend sensitive identities', async () => {
    const { controller, findOrCreateWithRole } = build({
      grants: ['partners.create', 'partners.view', 'partners.edit'],
      roles: [CUSTOMER, INVESTOR],
    });
    const result = await controller.findOrCreate(dto, user);
    expect(findOrCreateWithRole).toHaveBeenCalledWith(dto, 'user-1', {
      mayExtendSensitiveIdentity: true,
    });
    expect(result.partner).toHaveProperty('taxNumber', 'TAX-9');
  });
});
