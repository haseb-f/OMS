"use client";

import { StatusBadge } from "@/components/business/status-badge";
import { RecordGridCard } from "@/components/shared/data-table";
import { LocaleText } from "@/components/shared/locale-text";
import { SemanticValue } from "@/components/shared/semantic-value";
import {
  ActionsCell,
  StatusCell,
  userStatusTone,
  type UserRowHandlers,
} from "@/config/settings/user-columns";
import { formatDateTime } from "@/lib/date";
import { useLocale } from "@/providers/locale-provider";
import type { UserRow } from "@/services/users-service";

/**
 * The user card of the Grid view (R9): name, username, job title and
 * department (for an agent user: the agent), email, branch, last sign-in and
 * the account status - the fields the Users table shows. The page itself is
 * gated by `settings.manage`; the actions are the table's own `ActionsCell`
 * (same permission checks, same agent-team redirect). Colour = account state
 * (locked / active / inactive); the badge always names it.
 */
export function UserGridCard({
  user,
  handlers,
  selected,
  onToggleSelected,
}: {
  user: UserRow;
  handlers: UserRowHandlers;
  selected: boolean;
  onToggleSelected: () => void;
}) {
  const { t } = useLocale();
  const isAgent = user.userType === "AGENT";
  const subtitle = isAgent
    ? user.agent
      ? `${user.agent.name} · ${user.agent.agentNumber}`
      : null
    : [user.jobTitle?.name, user.department?.name].filter(Boolean).join(" · ") || null;
  return (
    <RecordGridCard
      tone={userStatusTone(user)}
      selected={selected}
      onToggleSelected={onToggleSelected}
      selectLabel={t("tableViews.card.selectRow", { name: user.fullName })}
      title={<LocaleText>{user.fullName}</LocaleText>}
      subtitle={subtitle ? <LocaleText>{subtitle}</LocaleText> : null}
      reference={
        <SemanticValue kind="id" className="font-medium">
          {user.username}
        </SemanticValue>
      }
      meta={
        user.lastLoginAt ? (
          <SemanticValue kind="date">{formatDateTime(user.lastLoginAt)}</SemanticValue>
        ) : null
      }
      fields={[
        {
          key: "email",
          label: t("settings.users.fields.email"),
          value: user.email ? <SemanticValue kind="email">{user.email}</SemanticValue> : "—",
        },
        ...(user.branch
          ? [
              {
                key: "branch",
                label: t("settings.users.fields.branch"),
                value: <LocaleText>{user.branch.name}</LocaleText>,
              },
            ]
          : []),
      ]}
      badges={
        <>
          <StatusCell row={user} />
          <StatusBadge
            label={t(isAgent ? "agents.users.AGENT" : "agents.users.INTERNAL")}
            tone={isAgent ? "info" : "neutral"}
          />
        </>
      }
      actionsNode={<ActionsCell row={user} handlers={handlers} />}
    />
  );
}
