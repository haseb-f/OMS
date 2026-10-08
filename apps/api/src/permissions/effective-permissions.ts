import {
  isAgentPortalPermission,
  isPartnerPortalPermission,
  withAuthorizationImpliedPermissions,
  withSettingsDomainGrants,
} from './permission-catalog';

/**
 * R14 (spec-2 §A, D2-1) — the ONE effective-permission formula, shared by the
 * resolver (guards + `/auth/me`), the job-title impact preview, the
 * anti-escalation check and the migration parity script:
 *
 *   effective = expand((template ∪ GRANTs) − DENYs) − DENYs
 *
 * `expand` is the existing resolver pipeline (authorization-bearing implied
 * permissions, then settings-domain grants). Computing the implications from
 * the already-denied base means a DENY also removes every implied permission
 * that only the denied key produced; subtracting the DENYs once more after the
 * expansion means a DENY on an implied key itself wins too.
 *
 * Agent users keep their `agent.*` presets only: no job-title template, no
 * DENY rows (spec §A — templates apply to INTERNAL users only). Partner logins
 * (R15 D15-14) likewise keep only their `partner.*` grants; an INTERNAL user
 * never holds an `agent.*` or `partner.*` key.
 */
export interface PermissionSources {
  isAgentUser: boolean;
  /** R15 (D15-14) — a company partner's own login (`UserType.PARTNER`). */
  isPartnerUser?: boolean;
  agentRole?: string | null;
  /** The user's job-title template (INTERNAL users only). */
  template: Iterable<string>;
  /** Individual GRANT rows. */
  grants: Iterable<string>;
  /** Individual DENY rows. */
  denies: Iterable<string>;
}

export function computeEffectivePermissions(
  sources: PermissionSources,
): Set<string> {
  if (sources.isAgentUser) {
    // `agent.team.manage` is an Agent Admin capability only (S7).
    return new Set(
      [...sources.grants].filter(
        (name) =>
          isAgentPortalPermission(name) &&
          (name !== 'agent.team.manage' || sources.agentRole === 'ADMIN'),
      ),
    );
  }
  if (sources.isPartnerUser) {
    return new Set([...sources.grants].filter(isPartnerPortalPermission));
  }
  const denied = new Set(sources.denies);
  const base = new Set<string>();
  for (const name of [...sources.template, ...sources.grants]) {
    if (
      !isAgentPortalPermission(name) &&
      !isPartnerPortalPermission(name) &&
      !denied.has(name)
    ) {
      base.add(name);
    }
  }
  const expanded = withSettingsDomainGrants(
    withAuthorizationImpliedPermissions([...base]),
  );
  return new Set(expanded.filter((name) => !denied.has(name)));
}

/** Permissions present in `after` but not in `before` (sorted). */
export function permissionsGained(
  before: ReadonlySet<string>,
  after: ReadonlySet<string>,
): string[] {
  return [...after].filter((name) => !before.has(name)).sort();
}
