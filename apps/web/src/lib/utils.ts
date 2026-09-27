import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge only knows Tailwind's built-in scale, so it reads the OMS
 * typography utilities (`text-caption`, `text-table-head`, … — theme/tokens.css)
 * as text *colors* and would drop them next to a real color class
 * (`text-caption text-muted-foreground` → size lost). Registering them as
 * font sizes keeps both. Keep this list in sync with the `--text-*` tokens.
 */
const OMS_FONT_SIZES = [
  "display",
  "page-title",
  "section-title",
  "card-title",
  "ui-title",
  "metric",
  "body",
  "button",
  "table",
  "table-head",
  "caption",
  "micro",
];

const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: OMS_FONT_SIZES,
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
