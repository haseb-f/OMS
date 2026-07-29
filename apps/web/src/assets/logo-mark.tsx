import type { SVGProps } from "react";

/**
 * Original abstract OMS mark — a rounded square with a stacked-layer glyph
 * (three offset bars, evoking layered operations/records). Uses
 * `currentColor` so it inherits the surrounding text color and needs no
 * separate light/dark variant.
 */
export function LogoMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <rect width="32" height="32" rx="9" fill="currentColor" />
      <rect
        x="8"
        y="9"
        width="16"
        height="3.2"
        rx="1.6"
        fill="var(--color-primary-foreground)"
        opacity="0.95"
      />
      <rect
        x="8"
        y="14.4"
        width="12"
        height="3.2"
        rx="1.6"
        fill="var(--color-primary-foreground)"
        opacity="0.8"
      />
      <rect
        x="8"
        y="19.8"
        width="8"
        height="3.2"
        rx="1.6"
        fill="var(--color-primary-foreground)"
        opacity="0.65"
      />
    </svg>
  );
}
