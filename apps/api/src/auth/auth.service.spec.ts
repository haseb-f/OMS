import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { hashPassword } from './password.util';
import type { PrismaService } from '../prisma/prisma.service';
import type { PermissionsResolverService } from '../permissions/permissions-resolver.service';

describe('AuthService.login', () => {
  const prisma = {
    user: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  };
  const jwtService = { sign: jest.fn().mockReturnValue('token') };
  const permissionsResolver = { getPermissions: jest.fn() };
  const service = new AuthService(
    prisma as unknown as PrismaService,
    jwtService as unknown as JwtService,
    permissionsResolver as unknown as PermissionsResolverService,
  );

  const baseUser = {
    id: 'user-1',
    email: 'admin@example.com',
    fullName: 'Admin',
    isActive: true,
    isLocked: false,
    mustChangePassword: false,
    passwordHash: '',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jwtService.sign.mockReturnValue('token');
    prisma.user.update.mockResolvedValue({});
  });

  it('logs in with mixed-case email against a stored lowercase hash', async () => {
    const password = 'Secret123!';
    prisma.user.findFirst.mockResolvedValue({
      ...baseUser,
      passwordHash: await hashPassword(password),
    });

    const result = await service.login({
      email: '  Admin@Example.COM  ',
      password,
    });

    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: {
        deletedAt: null,
        email: { equals: 'admin@example.com', mode: 'insensitive' },
      },
      include: { agent: { select: { status: true, deletedAt: true } } },
    });
    expect(result.accessToken).toBe('token');
    expect(result.user.email).toBe('admin@example.com');
  });

  it('rejects a wrong password', async () => {
    prisma.user.findFirst.mockResolvedValue({
      ...baseUser,
      passwordHash: await hashPassword('CorrectPass1!'),
    });

    await expect(
      service.login({ email: 'admin@example.com', password: 'WrongPass1!' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects an inactive user after the password is verified', async () => {
    const password = 'Secret123!';
    prisma.user.findFirst.mockResolvedValue({
      ...baseUser,
      isActive: false,
      passwordHash: await hashPassword(password),
    });

    await expect(
      service.login({ email: 'admin@example.com', password }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects a locked user after the password is verified', async () => {
    const password = 'Secret123!';
    prisma.user.findFirst.mockResolvedValue({
      ...baseUser,
      isLocked: true,
      passwordHash: await hashPassword(password),
    });

    await expect(
      service.login({ email: 'admin@example.com', password }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('issues an agent-scoped token to an external agent user', async () => {
    const password = 'Secret123!';
    prisma.user.findFirst.mockResolvedValue({
      ...baseUser,
      userType: 'AGENT',
      agentId: 'agent-1',
      agent: { status: 'ACTIVE', deletedAt: null },
      passwordHash: await hashPassword(password),
    });
    const result = await service.login({
      email: 'admin@example.com',
      password,
    });
    expect(jwtService.sign).toHaveBeenCalledWith(
      {
        sub: 'user-1',
        email: 'admin@example.com',
        typ: 'agent',
        agentId: 'agent-1',
      },
      undefined,
    );
    expect(result.user.userType).toBe('AGENT');
  });

  it('never gives an internal user an agent claim', async () => {
    const password = 'Secret123!';
    prisma.user.findFirst.mockResolvedValue({
      ...baseUser,
      userType: 'INTERNAL',
      agentId: null,
      agent: null,
      passwordHash: await hashPassword(password),
    });
    await service.login({ email: 'admin@example.com', password });
    expect(jwtService.sign).toHaveBeenCalledWith(
      { sub: 'user-1', email: 'admin@example.com' },
      undefined,
    );
  });

  it('refuses login for a user of an inactive agent', async () => {
    const password = 'Secret123!';
    prisma.user.findFirst.mockResolvedValue({
      ...baseUser,
      userType: 'AGENT',
      agentId: 'agent-1',
      agent: { status: 'INACTIVE', deletedAt: null },
      passwordHash: await hashPassword(password),
    });
    await expect(
      service.login({ email: 'admin@example.com', password }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(jwtService.sign).not.toHaveBeenCalled();
  });
});
