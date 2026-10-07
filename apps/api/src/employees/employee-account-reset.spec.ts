import {
  BadRequestException,
  ConflictException,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import type { PermissionsResolverService } from '../permissions/permissions-resolver.service';
import { EmployeesController } from './employees.controller';
import { EmployeesService } from './employees.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { PartnersService } from '../partners/partners.service';
import type { UsersService } from '../users/users.service';
import type { DepartmentsService } from '../departments/departments.service';
import type { PayrollComponentsService } from '../payroll-components/payroll-components.service';
import type { MasterDataActivityLogService } from '../master-data/master-data-activity-log.service';

/**
 * R14 W1 (spec-1 §5) — HR "Reset password" for an employee's login account:
 * `POST /employees/:id/reset-password`, authorised exactly like Settings →
 * Users → Reset password (`settings.manage`), delegating to
 * `UsersService.resetPassword` (sessions revoked there).
 */
describe('Employee account password reset', () => {
  describe('authorization (PermissionsGuard on the real handler metadata)', () => {
    function context(held: Set<string>) {
      const resolver = {
        isSuperAdmin: jest.fn().mockResolvedValue(false),
        hasPermission: jest.fn((_: string, name: string) =>
          Promise.resolve(held.has(name)),
        ),
      };
      const guard = new PermissionsGuard(
        new Reflector(),
        resolver as unknown as PermissionsResolverService,
      );
      // eslint-disable-next-line @typescript-eslint/unbound-method
      const handler = EmployeesController.prototype.resetAccountPassword;
      const ctx = {
        getHandler: () => handler,
        getClass: () => EmployeesController,
        switchToHttp: () => ({
          getRequest: () => ({ method: 'POST', user: { sub: 'actor' } }),
        }),
      } as unknown as ExecutionContext;
      return { guard, ctx, resolver };
    }

    it('admits a holder of settings.manage', async () => {
      const { guard, ctx, resolver } = context(new Set(['settings.manage']));
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(resolver.hasPermission).toHaveBeenCalledWith(
        'actor',
        'settings.manage',
      );
    });

    it('refuses HR employee rights alone (create / edit / view)', async () => {
      const { guard, ctx } = context(
        new Set([
          'hr.employees.view',
          'hr.employees.create',
          'hr.employees.edit',
          'settings.view',
        ]),
      );
      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('EmployeesService.resetAccountPassword', () => {
    const employee = {
      id: 'emp-1',
      userId: 'user-1',
      deletedAt: null,
      partner: { name: 'Sara' },
    };
    let findFirst: jest.Mock;
    let users: {
      assertInternallyManaged: jest.Mock;
      resetPassword: jest.Mock;
    };
    let activityLog: { log: jest.Mock };
    let service: EmployeesService;

    beforeEach(() => {
      findFirst = jest.fn().mockResolvedValue(employee);
      users = {
        assertInternallyManaged: jest.fn().mockResolvedValue(undefined),
        resetPassword: jest.fn(),
      };
      activityLog = { log: jest.fn() };
      service = new EmployeesService(
        {
          employeeProfile: { findFirst },
        } as unknown as PrismaService,
        {} as PartnersService,
        users as unknown as UsersService,
        {} as DepartmentsService,
        {} as PayrollComponentsService,
        activityLog as unknown as MasterDataActivityLogService,
      );
    });

    it('delegates to UsersService.resetPassword and never echoes a supplied password', async () => {
      users.resetPassword.mockResolvedValue({ id: 'user-1' });
      const result = await service.resetAccountPassword(
        'emp-1',
        { newPassword: 'Supplied-Passw0rd!' },
        'actor',
      );
      expect(users.resetPassword).toHaveBeenCalledWith('user-1', {
        newPassword: 'Supplied-Passw0rd!',
      });
      expect(JSON.stringify(result)).not.toContain('Supplied-Passw0rd!');
      const logged = JSON.stringify(activityLog.log.mock.calls);
      expect(logged).not.toContain('Supplied-Passw0rd!');
      expect(activityLog.log).toHaveBeenCalledWith(
        'EMPLOYEE',
        'emp-1',
        'PASSWORD_RESET',
        expect.any(String),
        'actor',
      );
    });

    it('returns a server-generated temporary password once', async () => {
      users.resetPassword.mockResolvedValue({
        id: 'user-1',
        temporaryPassword: 'Gen3rated-Temp!',
      });
      await expect(service.resetAccountPassword('emp-1')).resolves.toEqual({
        message: 'Password reset.',
        temporaryPassword: 'Gen3rated-Temp!',
      });
    });

    it('refuses an employee without a login account', async () => {
      findFirst.mockResolvedValue({ ...employee, userId: null });
      await expect(service.resetAccountPassword('emp-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(users.resetPassword).not.toHaveBeenCalled();
    });

    it('refuses an agent user (managed in the agent workspace)', async () => {
      users.assertInternallyManaged.mockRejectedValue(
        new ConflictException('agent'),
      );
      await expect(service.resetAccountPassword('emp-1')).rejects.toThrow(
        ConflictException,
      );
      expect(users.resetPassword).not.toHaveBeenCalled();
    });
  });
});
