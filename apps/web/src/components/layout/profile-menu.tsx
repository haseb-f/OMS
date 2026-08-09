"use client";

import { LogOut, Settings, UserRound } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useLocale } from "@/providers/locale-provider";
import { useAuth } from "@/providers/auth-provider";

function getInitials(fullName: string) {
  const parts = fullName.trim().split(/\s+/);
  const initials = parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : parts[0]?.slice(0, 2);
  return initials?.toUpperCase() ?? "?";
}

export function ProfileMenu() {
  const { t } = useLocale();
  const { user, logout } = useAuth();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-2 rounded-full outline-none ring-ring focus-visible:ring-2"
          aria-label={t("topbar.profileMenu")}
        >
          <Avatar className="size-8">
            <AvatarFallback className="text-xs">
              {user ? getInitials(user.fullName) : "GU"}
            </AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex flex-col gap-0.5 font-normal">
          <span className="text-sm font-medium">{user?.fullName ?? t("topbar.guestUser")}</span>
          <span className="text-xs text-muted-foreground">
            {user?.email ?? t("topbar.notSignedIn")}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled>
          <UserRound />
          <span>{t("topbar.profile")}</span>
        </DropdownMenuItem>
        <DropdownMenuItem disabled>
          <Settings />
          <span>{t("topbar.accountSettings")}</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => void logout()}>
          <LogOut />
          <span>{t("topbar.logout")}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
