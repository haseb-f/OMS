import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';

/** The identity claims of an access token; `sid` is added by `issueAccessToken`. */
export interface AccessTokenClaims {
  sub: string;
  email: string;
  typ?: 'agent';
  agentId?: string | null;
}

/** Why a session ended — stored on `user_sessions.revoked_reason`. */
export type SessionRevokeReason =
  'LOGOUT' | 'IDLE' | 'PASSWORD_RESET' | 'PASSWORD_CHANGED' | 'BROWSER_RESTART';

/** Error codes the guard answers with (401) — the web treats every one as "signed out". */
export const SESSION_ERROR = {
  missing: 'SESSION_MISSING',
  revoked: 'SESSION_REVOKED',
  idle: 'SESSION_IDLE',
  expired: 'SESSION_EXPIRED',
  accountUnavailable: 'ACCOUNT_UNAVAILABLE',
} as const;

const DEFAULT_IDLE_MINUTES = 120;
const DEFAULT_ABSOLUTE_HOURS = 12;
/** Session rows are re-read at most this often per process (spec-1 §2). */
export const SESSION_CACHE_TTL_MS = 15_000;
/** `last_seen_at` is written at most this often per session. */
export const LAST_SEEN_WRITE_INTERVAL_MS = 60_000;
const MAX_CACHED_SESSIONS = 5_000;

interface SessionSnapshot {
  userId: string;
  lastSeenAt: number;
  expiresAt: number;
  revokedAt: number | null;
  user: {
    isActive: boolean;
    isLocked: boolean;
    deleted: boolean;
  };
}

export function sessionIdleMinutes(
  raw: string | undefined = process.env.SESSION_IDLE_MINUTES,
): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_IDLE_MINUTES;
}

/**
 * Absolute session length (R14 integration). Deliberately independent of the
 * module-wide JWT_ACCESS_TTL: Production runs that at 15 m, and with no refresh
 * token and no "remember me" that would sign every user out each 15 minutes.
 * The token is still checked against its server session on every request, so
 * a long-lived token stays revocable (logout, idle, password reset, deactivation).
 */
export function sessionAbsoluteHours(
  raw: string | undefined = process.env.SESSION_ABSOLUTE_HOURS,
): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 24
    ? parsed
    : DEFAULT_ABSOLUTE_HOURS;
}

function unauthorized(code: string, message: string): UnauthorizedException {
  return new UnauthorizedException({ code, message });
}

/**
 * R14 W1 — server-side sign-in sessions. One row per login; the access token
 * carries its id as `sid`. The guard calls `assertActive` on every request:
 * a missing, revoked, idle (> SESSION_IDLE_MINUTES) or expired session, or a
 * user that is deleted / inactive / locked, is refused with 401.
 *
 * Reads are cached per process for 15 s, so a revocation made by ANOTHER
 * process takes effect within 15 s; one made by this process is immediate
 * (its cache entry is dropped). `last_seen_at` is written at most once a
 * minute per session.
 */
@Injectable()
export class UserSessionsService {
  private readonly cache = new Map<
    string,
    { snapshot: SessionSnapshot; readAt: number }
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  /**
   * Opens a session and signs its access token (`sid` = the session id). The
   * token's lifetime is `SESSION_ABSOLUTE_HOURS` (default 12, max 24), never
   * extended; the session's absolute end is that token's own `exp`.
   */
  async issueAccessToken(
    claims: AccessTokenClaims,
    userAgent?: string | null,
  ): Promise<string> {
    const sessionId = crypto.randomUUID();
    const accessToken = this.jwtService.sign(
      { ...claims, sid: sessionId },
      { expiresIn: `${sessionAbsoluteHours()}h` },
    );
    const { exp } = this.jwtService.decode<{ exp: number }>(accessToken);
    await this.prisma.userSession.create({
      data: {
        id: sessionId,
        userId: claims.sub,
        expiresAt: new Date(exp * 1000),
        userAgentHash: userAgent
          ? crypto.createHash('sha256').update(userAgent).digest('hex')
          : null,
      },
    });
    return accessToken;
  }

  /** Throws 401 unless the session is live and its user may still sign in. */
  async assertActive(
    sessionId: string | undefined,
    userId: string,
    now: number = Date.now(),
  ): Promise<void> {
    if (!sessionId) {
      throw unauthorized(SESSION_ERROR.missing, 'Session not found.');
    }
    const snapshot = await this.read(sessionId, now);
    if (!snapshot || snapshot.userId !== userId) {
      throw unauthorized(SESSION_ERROR.missing, 'Session not found.');
    }
    if (snapshot.revokedAt !== null) {
      throw unauthorized(SESSION_ERROR.revoked, 'This session has ended.');
    }
    if (now >= snapshot.expiresAt) {
      throw unauthorized(SESSION_ERROR.expired, 'This session has expired.');
    }
    if (now - snapshot.lastSeenAt > sessionIdleMinutes() * 60_000) {
      await this.revoke(sessionId, 'IDLE');
      throw unauthorized(
        SESSION_ERROR.idle,
        'This session ended after a period of inactivity.',
      );
    }
    if (
      snapshot.user.deleted ||
      !snapshot.user.isActive ||
      snapshot.user.isLocked
    ) {
      throw unauthorized(
        SESSION_ERROR.accountUnavailable,
        'This account is inactive, locked or no longer available.',
      );
    }
    if (now - snapshot.lastSeenAt >= LAST_SEEN_WRITE_INTERVAL_MS) {
      await this.touch(sessionId, snapshot, now);
    }
  }

  async revoke(sessionId: string, reason: SessionRevokeReason): Promise<void> {
    this.cache.delete(sessionId);
    await this.prisma.userSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }

  /** Ends every live session of a user, optionally keeping the caller's own. */
  async revokeAllForUser(
    userId: string,
    reason: SessionRevokeReason,
    exceptSessionId?: string,
  ): Promise<number> {
    for (const [id, entry] of this.cache) {
      if (entry.snapshot.userId === userId && id !== exceptSessionId) {
        this.cache.delete(id);
      }
    }
    const result = await this.prisma.userSession.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
      },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    return result.count;
  }

  private async read(
    sessionId: string,
    now: number,
  ): Promise<SessionSnapshot | null> {
    const cached = this.cache.get(sessionId);
    if (cached && now - cached.readAt < SESSION_CACHE_TTL_MS) {
      return cached.snapshot;
    }
    const row = await this.prisma.userSession.findUnique({
      where: { id: sessionId },
      select: {
        userId: true,
        lastSeenAt: true,
        expiresAt: true,
        revokedAt: true,
        user: { select: { isActive: true, isLocked: true, deletedAt: true } },
      },
    });
    if (!row) {
      this.cache.delete(sessionId);
      return null;
    }
    const snapshot: SessionSnapshot = {
      userId: row.userId,
      lastSeenAt: row.lastSeenAt.getTime(),
      expiresAt: row.expiresAt.getTime(),
      revokedAt: row.revokedAt?.getTime() ?? null,
      user: {
        isActive: row.user.isActive,
        isLocked: row.user.isLocked,
        deleted: row.user.deletedAt !== null,
      },
    };
    this.pruneCache(now);
    this.cache.set(sessionId, { snapshot, readAt: now });
    return snapshot;
  }

  /** Keeps the per-process cache bounded: stale entries are re-read anyway. */
  private pruneCache(now: number): void {
    if (this.cache.size < MAX_CACHED_SESSIONS) return;
    for (const [id, entry] of this.cache) {
      if (now - entry.readAt >= SESSION_CACHE_TTL_MS) this.cache.delete(id);
    }
  }

  private async touch(
    sessionId: string,
    snapshot: SessionSnapshot,
    now: number,
  ): Promise<void> {
    snapshot.lastSeenAt = now;
    await this.prisma.userSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { lastSeenAt: new Date(now) },
    });
  }
}
