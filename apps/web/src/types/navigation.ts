import type { IconName } from "../navigation/icon-registry";
import type { MessageKey } from "../i18n/translate";

/**
 * Config-driven navigation contract. Every sidebar/topbar navigation
 * surface renders from `navigation.config.ts` entries shaped like this —
 * adding a future module requires editing only that configuration, never a
 * layout component. `titleKey`/`subtitleKey` are i18n message keys, not
 * display text — Arabic is the default locale, so nothing here may be a
 * hardcoded English string.
 */
export interface NavigationItem {
  /** Stable unique identifier — used for expand/pin/recent state, never the route. */
  id: string;
  titleKey: MessageKey;
  subtitleKey?: MessageKey;
  /** Looked up in the icon registry (`navigation/icon-registry.ts`) — config stores a name, not a component reference. */
  icon?: IconName;
  /** Omit for a parent-only item that just groups children. */
  route?: string;
  parent?: string;
  /** Lower renders first among siblings. */
  order?: number;
  /** Permission keys required to see this item. No permission system exists yet — reserved for when Identity/Auth is wired up; an empty/undefined list means "always visible." */
  permissions?: string[];
  /** Feature flag key gating this item. No feature-flag system exists yet — reserved for future use. */
  featureFlag?: string;
  badge?: {
    label: string;
    variant?: "default" | "secondary" | "destructive" | "outline";
  };
  /** Defaults to true when omitted. */
  visible?: boolean;
  children?: NavigationItem[];
}
