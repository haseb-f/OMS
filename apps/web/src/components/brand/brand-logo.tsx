import Image from "next/image";
import { cn } from "@/lib/utils";

const BRAND_ASSETS = {
  "horizontal-light": {
    src: "/brand/oms-logo-light.png",
    width: 988,
    height: 314,
    alt: "OMS — Operations Management System",
  },
  "horizontal-dark": {
    src: "/brand/oms-logo-dark.png",
    width: 988,
    height: 314,
    alt: "OMS — Operations Management System",
  },
  mark: {
    src: "/brand/oms-app-icon.png",
    width: 169,
    height: 170,
    alt: "OMS",
  },
} as const;

export type BrandLogoVariant = keyof typeof BRAND_ASSETS;

/**
 * Official OMS lockup / app icon. Artwork is cropped from Brand/ identity
 * files — never redrawn, recolored, covered, or clipped here.
 */
export function BrandLogo({
  variant,
  className,
  priority = false,
  decorative = false,
  sizes,
}: {
  variant: BrandLogoVariant;
  className?: string;
  priority?: boolean;
  /** Hide from assistive tech when a neighbouring text label already names OMS. */
  decorative?: boolean;
  sizes?: string;
}) {
  const asset = BRAND_ASSETS[variant];

  return (
    <Image
      src={asset.src}
      alt={decorative ? "" : asset.alt}
      width={asset.width}
      height={asset.height}
      priority={priority}
      sizes={sizes}
      aria-hidden={decorative || undefined}
      className={cn("h-auto max-w-full object-contain", className)}
    />
  );
}

/**
 * Sidebar / shell mark: official app-icon asset inside a 36px frame.
 * The icon itself stays ~32px so every chevron remains visible with padding.
 */
export function BrandMark({
  className,
  decorative = false,
}: {
  className?: string;
  decorative?: boolean;
}) {
  return (
    <span className={cn("flex size-9 shrink-0 items-center justify-center", className)}>
      <BrandLogo variant="mark" decorative={decorative} sizes="32px" className="size-8" />
    </span>
  );
}
