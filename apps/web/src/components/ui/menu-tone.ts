/**
 * R14 W1 (spec-1 §3) — semantic colour of a menu ITEM (never a trigger, never
 * a catalogue selector option). The colours are the `--menu-tone-*` tokens
 * (`theme/tokens.css`); an item opts in through `data-menu-tone`, so neutral
 * items render exactly as before.
 */
export const MENU_TONES = ["neutral", "info", "success", "warning", "destructive"] as const;

export type MenuTone = (typeof MENU_TONES)[number];

const TONE_BASE =
  "data-menu-tone:text-(--menu-item-fg) data-menu-tone:*:[svg]:text-(--menu-item-fg) data-menu-tone:focus:bg-(--menu-item-bg) data-menu-tone:focus:text-(--menu-item-fg) data-menu-tone:data-[checked=true]:bg-(--menu-item-bg) data-menu-tone:data-[checked=true]:text-(--menu-item-fg)";

/**
 * Tone classes of a Radix `DropdownMenuItem`: text + icon in the tone colour;
 * hover/focus (highlighted) and checked on the same hue's tinted background;
 * disabled stays muted for every tone. Radix sets `data-highlighted` /
 * `data-disabled` only while true.
 */
export const DROPDOWN_ITEM_TONE_CLASS = `${TONE_BASE} data-menu-tone:data-highlighted:bg-(--menu-item-bg) data-menu-tone:data-[state=checked]:bg-(--menu-item-bg) data-menu-tone:data-disabled:text-muted-foreground data-menu-tone:data-disabled:*:[svg]:text-muted-foreground`;

/**
 * Tone classes of a cmdk `CommandItem` (status filters / status lists). cmdk
 * always renders `data-selected` / `data-disabled` as "true" | "false", so
 * the states are matched by value.
 */
export const COMMAND_ITEM_TONE_CLASS = `${TONE_BASE} data-menu-tone:data-[selected=true]:bg-(--menu-item-bg) data-menu-tone:data-[selected=true]:text-(--menu-item-fg) data-menu-tone:data-[selected=true]:*:[svg]:text-(--menu-item-fg) data-menu-tone:data-[disabled=true]:text-muted-foreground data-menu-tone:data-[disabled=true]:*:[svg]:text-muted-foreground`;

/** The `data-menu-tone` attribute value: absent for neutral (default look). */
export function menuToneAttribute(
  tone: MenuTone | undefined,
): Exclude<MenuTone, "neutral"> | undefined {
  return tone && tone !== "neutral" ? tone : undefined;
}

/**
 * The one action-verb → tone map (spec-1 §3), so the same verb reads the same
 * colour in every row menu and header overflow:
 * create / approve / confirm / post / deliver / activate → success;
 * hold / suspend / reopen / review → warning;
 * delete / cancel / archive / reject / void → destructive;
 * view / print / export / copy / edit (and anything unlisted) → neutral;
 * info → info.
 */
const VERB_TONES: Record<string, MenuTone> = {
  // success — the action moves the record forward / brings it into use.
  create: "success",
  add: "success",
  new: "success",
  approve: "success",
  confirm: "success",
  post: "success",
  deliver: "success",
  delivered: "success",
  activate: "success",
  restore: "success",
  accept: "success",
  submit: "success",
  settle: "success",
  "mark-paid": "success",
  complete: "success",
  receive: "success",
  // warning — reversible holds, re-openings and reviews; access interventions.
  hold: "warning",
  suspend: "warning",
  reopen: "warning",
  review: "warning",
  deactivate: "warning",
  lock: "warning",
  reverse: "warning",
  refund: "warning",
  dispute: "warning",
  dispose: "warning",
  unlink: "warning",
  unmatch: "warning",
  unreconcile: "warning",
  "reset-password": "warning",
  "force-password-change": "warning",
  "close-without-purchase": "warning",
  // destructive — removes, voids or refuses.
  delete: "destructive",
  remove: "destructive",
  cancel: "destructive",
  archive: "destructive",
  reject: "destructive",
  void: "destructive",
  // info
  info: "info",
};

/** `markPaid` / `reset_password` / `Reset-Password` → `mark-paid` / `reset-password`. */
function normalizeKind(kind: string): string {
  return kind
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[_\s]+/g, "-")
    .toLowerCase();
}

/**
 * Tone of an action by its kind (usually the action `key`): the whole key
 * first (`reset-password`), then its leading verb (`cancel-refund` → cancel).
 * Unknown kinds are neutral — colour is never guessed.
 */
export function actionTone(kind: string): MenuTone {
  const normalized = normalizeKind(kind);
  return VERB_TONES[normalized] ?? VERB_TONES[normalized.split("-")[0]] ?? "neutral";
}
