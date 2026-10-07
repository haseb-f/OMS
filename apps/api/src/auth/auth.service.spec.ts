import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { hashPassword } from './password.util';
import type { PrismaService } from '../prisma/prisma.service';
import type { PermissionsResolverService } from '../permissions/permissions-resolver.service';
import { JwtService } from '@nestjs/jwt';
import { UserSessionsService } from './sessions/user-sessions.service';

describe('AuthService.login', () => {
  const prisma = {
    user: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  };
  const permissionsResolver = { getPermissions: jest.fn() };
  const sessions = {
    issueAccessToken: jest.fn().mockResolvedValue('token'),
  };
  const service = new AuthService(
    prisma as unknown as PrismaService,
    permissionsResolver as unknown as PermissionsResolverService,
    sessions as unknown as UserSessionsService,
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
    sessions.issueAccessToken.mockResolvedValue('token');
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
    expect(sessions.issueAccessToken).toHaveBeenCalledWith(
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
    expect(sessions.issueAccessToken).toHaveBeenCalledWith(
      { sub: 'user-1', email: 'admin@example.com' },
      undefined,
    );
  });

  it('opens the session with the login request user agent', async () => {
    const password = 'Secret123!';
    prisma.user.findFirst.mockResolvedValue({
      ...baseUser,
      passwordHash: await hashPassword(password),
    });
    await service.login({ email: 'admin@example.com', password }, 'UA/1.0');
    expect(sessions.issueAccessToken).toHaveBeenCalledWith(
      { sub: 'user-1', email: 'admin@example.com' },
      'UA/1.0',
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
    expect(sessions.issueAccessToken).not.toHaveBeenCalled();
  });
});

describe('UserSessionsService.issueAccessToken', () => {
  it('ignores rememberMe: the token lives JWT_ACCESS_TTL and the session ends at its exp', async () => {
    const jwt = new JwtService({
      secret: 's',
      signOptions: { expiresIn: '15m' },
    });
    const create = jest.fn();
    const sessions = new UserSessionsService(
      { userSession: { create } } as unknown as PrismaService,
      jwt,
    );
    const before = Math.floor(Date.now() / 1000);
    const token = await sessions.issueAccessToken(
      { sub: 'user-1', email: 'a@x.test' },
      'UA/1.0',
    );
    const payload = jwt.decode<{ sid: string; exp: number; iat: number }>(
      token,
    );
    expect(payload.exp - payload.iat).toBe(15 * 60);
    expect(payload.exp).toBeGreaterThanOrEqual(before + 15 * 60);
    const [[{ data: row }]] = create.mock.calls as [
      [{ data: { id: string; expiresAt: Date; userAgentHash: string } }],
    ];
    expect(row.id).toBe(payload.sid);
    expect(row.expiresAt).toEqual(new Date(payload.exp * 1000));
    expect(row.userAgentHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('AuthService session lifecycle', () => {
  const prisma = {
    user: { findFirst: jest.fn(), update: jest.fn() },
  };
  const sessions = {
    revoke: jest.fn(),
    revokeAllForUser: jest.fn(),
  };
  const service = new AuthService(
    prisma as unknown as PrismaService,
    {} as PermissionsResolverService,
    sessions as unknown as UserSessionsService,
  );

  beforeEach(() => jest.clearAllMocks());

  it('logout revokes the caller session server-side', async () => {
    await service.logout('sid-9');
    expect(sessions.revoke).toHaveBeenCalledWith('sid-9', 'LOGOUT');
  });

  it('own password change ends every OTHER session of the user', async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: 'user-1',
      passwordHash: await hashPassword('OldPassw0rd!'),
    });
    await service.changePassword(
      'user-1',
      { currentPassword: 'OldPassw0rd!', newPassword: 'NewPassw0rd!' },
      'sid-current',
    );
    expect(sessions.revokeAllForUser).toHaveBeenCalledWith(
      'user-1',
      'PASSWORD_CHANGED',
      'sid-current',
    );
  });
});
