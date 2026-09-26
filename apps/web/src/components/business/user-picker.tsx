"use client";

import { UserCog } from "lucide-react";
import { EntityCombobox } from "@/components/shared/entity-combobox";
import { useUsersList } from "@/hooks/use-reference-data";
import type { UserRow } from "@/services/users-service";
import { useLocale } from "@/providers/locale-provider";

/**
 * The one system-user selector (salesperson, warehouse keeper, assignment,
 * "copy permissions from"). Value is the user id; the list comes from the
 * session-cached `useUsersList`, so every picker on a page shares one request.
 */
export function UserPicker({
  value,
  onValueChange,
  activeOnly = true,
  excludeIds,
  disabled,
  allowClear = false,
  error,
  placeholder,
  className,
  id,
  "aria-label": ariaLabel,
  "aria-describedby": ariaDescribedBy,
}: {
  value: string | null | undefined;
  onValueChange: (userId: string) => void;
  activeOnly?: boolean;
  excludeIds?: string[];
  disabled?: boolean;
  allowClear?: boolean;
  error?: boolean;
  placeholder?: string;
  className?: string;
  id?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
}) {
  const { t } = useLocale();
  const users = useUsersList();
  const excluded = new Set(excludeIds ?? []);
  const options = users.filter(
    (user) => !excluded.has(user.id) && (!activeOnly || user.isActive || user.id === value),
  );
  const loading = useUsersList.isLoading();
  // A saved user the viewer can't list (no settings.manage → empty list) or
  // one since removed still reads as assigned, never as "none".
  const selected =
    users.find((user) => user.id === value) ??
    (value
      ? ({
          id: value,
          fullName: loading ? "…" : t("pickers.option.unavailable"),
          username: "",
          email: "",
        } as UserRow)
      : null);

  return (
    <EntityCombobox<UserRow>
      id={id}
      value={selected}
      onChange={(user) => onValueChange(user?.id ?? "")}
      items={options}
      loading={loading}
      getId={(user) => user.id}
      getTitle={(user) => user.fullName || user.username}
      getSubtitle={(user) => user.email}
      getSearchText={(user) => `${user.username} ${user.email}`}
      subtitleDir="ltr"
      placeholder={placeholder ?? t("pickers.user.select")}
      searchPlaceholder={t("pickers.user.search")}
      emptyText={t("pickers.user.empty")}
      disabled={disabled}
      allowClear={allowClear}
      error={error}
      icon={<UserCog className="size-3.5 shrink-0 text-muted-foreground" />}
      triggerClassName={className}
      triggerProps={{ "aria-label": ariaLabel, "aria-describedby": ariaDescribedBy }}
    />
  );
}
