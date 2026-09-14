import * as fs from 'fs';
import * as path from 'path';

/**
 * TASK-062 Security Hardening Phase 25 — "Controller Coverage Safety Net".
 *
 * The previous performance audit found ~20 of 28 Master Data controllers
 * had NO backend permission guard, and this pass separately found several
 * controllers with no `JwtAuthGuard` at all (reachable by an unauthenticated
 * caller). Both classes of gap are easy to introduce silently: a new
 * `@Controller` that forgets `@UseGuards(JwtAuthGuard)` or `@PermissionModule`
 * compiles and runs fine — nothing fails until someone notices in
 * production. This test makes that failure mode loud instead: every
 * controller must be authenticated, and every controller must have made an
 * explicit authorization decision (`@PermissionModule`, or a reasoned entry
 * in `INTENTIONALLY_UNGATED` below) — never "nobody thought about it yet".
 *
 * This is a static text scan, not a NestJS metadata reflection test — the
 * app's DI graph is expensive to boot for every controller in the repo, and
 * a scan is enough to catch "forgot the decorator entirely", which is the
 * actual failure mode being guarded against.
 */

const SRC_ROOT = path.join(__dirname, '..');

function findControllerFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findControllerFiles(fullPath));
    } else if (entry.name.endsWith('.controller.ts')) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Controllers with NO `@PermissionModule` (class- or method-level), each
 * with a one-line reason this is a deliberate choice, not an oversight
 * (Phase 4: "If an entity must be readable by all authenticated users for
 * valid business reasons: document that explicitly").
 */
const INTENTIONALLY_UNGATED: Record<string, string> = {
  'auth/auth.controller.ts':
    'Pre-authentication endpoints (login/forgot-password/reset-password); logout/me are self-scoped to the caller.',
  'health/health.controller.ts': 'Public health check — no data, no auth.',
  'common/storage/attachments.controller.ts':
    'Generic staging upload/download; JwtAuthGuard + per-file ownership check inside AttachmentsService.getFile().',
  'financial-transactions/financial-transaction-types.controller.ts':
    'Closed, hardcoded catalog (not a CRUD table) — read-only, SkipPermissionCheck under JwtAuthGuard.',
  'shipping-methods/shipping-methods.controller.ts':
    'Retired — every route throws 410 Gone, no data exposed.',
  'sales-performance/sales-performance.controller.ts':
    "Dashboard scoped to the caller's own performance (user.sub), not cross-user data.",
  'sales-orders/sales-orders.controller.ts':
    'KNOWN DEBT (TASK-062): legacy route family overlapping sales/orders + store-orders shipping flows; JwtAuthGuard added, granular permission module needs a product decision on which boundary to adopt.',
  'payments/payments.controller.ts':
    'KNOWN DEBT (TASK-062): no frontend caller references this generic /payments route (superseded by sales.receipts / purchasing.payments / accounting.expense-payments, all already guarded); JwtAuthGuard added, granular permission module needs a product decision on whether this is dead code to remove or a boundary to define.',
  'investor-portal/investor-portal-auth.controller.ts':
    'Pre-authentication Investor Portal endpoints (login/activate/forgot-password) — same shape as auth/auth.controller.ts above, for the external Investor identity instead of the internal User.',
  'investor-portal/investor-portal.controller.ts':
    "Guarded by the Investor Portal's own InvestorPortalAuthGuard (not the internal PermissionsGuard/@PermissionModule system — mission Part 18/52 requires a fully separate external-access boundary); every handler is self-scoped to the authenticated Portal Investor via @CurrentPortalInvestor(), never an internal permission check.",
};

/** Read-only, system-generated audit-trail sub-resources of an already-permission-guarded parent document — Phase 1 explicitly scoped this milestone to Master Data, not every transactional sub-resource; each stays behind JwtAuthGuard only. */
const AUDIT_TRAIL_SUFFIXES = [
  '/activities/',
  '/attachments/',
  '/notes/',
  '/status-history/',
  '/shipments/',
  '/components/',
  '/variants/',
];

function isAuditTrailSubResource(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, '/');
  return AUDIT_TRAIL_SUFFIXES.some((suffix) => normalized.includes(suffix));
}

describe('Controller authorization coverage (TASK-062 safety net)', () => {
  const files = findControllerFiles(SRC_ROOT);
  const cases = files.map((file) => {
    const relPath = path.relative(SRC_ROOT, file).replace(/\\/g, '/');
    return { file, relPath, content: fs.readFileSync(file, 'utf8') };
  });

  it('found controller files to check (sanity check the scan itself works)', () => {
    expect(cases.length).toBeGreaterThan(80);
  });

  it.each(cases.map((c) => [c.relPath, c] as const))(
    "%s requires authentication (JwtAuthGuard or the Investor Portal's own InvestorPortalAuthGuard)",
    (_label, { relPath, content }) => {
      if (relPath === 'health/health.controller.ts') return; // deliberately public
      if (relPath === 'investor-portal/investor-portal-auth.controller.ts')
        return; // pre-authentication Portal endpoints, see INTENTIONALLY_UNGATED
      // Investor Engine Milestone 4, Part C — the Investor Portal is a
      // deliberately SEPARATE external-access boundary from internal
      // sessions (mission Part 18/22/52): its authenticated routes are
      // guarded by `InvestorPortalAuthGuard`, never the internal
      // `JwtAuthGuard`, so a valid internal session token can never reach
      // them and vice versa (see investor-portal.spec.ts's dedicated
      // cross-boundary rejection tests for the enforced property this
      // static scan only spot-checks by name).
      const AUTH_GUARD_MARKERS = ['JwtAuthGuard', 'InvestorPortalAuthGuard'];
      expect(
        AUTH_GUARD_MARKERS.some((marker) => content.includes(marker)),
      ).toBe(true);
    },
  );

  it.each(cases.map((c) => [c.relPath, c] as const))(
    '%s has an explicit authorization decision (@PermissionModule or a documented reason)',
    (_label, { relPath, content }) => {
      if (content.includes('@PermissionModule')) return;
      if (INTENTIONALLY_UNGATED[relPath]) return;
      if (isAuditTrailSubResource(relPath)) return;
      throw new Error(
        `${relPath} has no @PermissionModule and is not in the documented ` +
          `INTENTIONALLY_UNGATED allowlist in controller-authorization.spec.ts. ` +
          `Add @PermissionModule('<catalog-key>') or, if this route is deliberately ` +
          `open to any authenticated user, add it to INTENTIONALLY_UNGATED with a reason.`,
      );
    },
  );
});
