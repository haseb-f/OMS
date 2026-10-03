import type { Metadata } from "next";
import "./globals.css";
import { Geist, Geist_Mono, IBM_Plex_Sans_Arabic } from "next/font/google";
import { cn } from "@/lib/utils";
import { AppProviders } from "@/providers/app-providers";
import { siteConfig } from "@/config/site";

/** IBM Plex Sans Arabic — Arabic-first typography (ADR-0020), since Arabic is the default locale. Falls back to Alexandria. */
const bodyFont = IBM_Plex_Sans_Arabic({
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex",
  fallback: ["Alexandria", "system-ui", "sans-serif"],
});

/**
 * Geist for Latin text and digits (design-system §12.3). Geist has no Arabic
 * glyphs, so Arabic falls through to IBM Plex Sans Arabic in the
 * `--font-sans` stack (globals.css). No metric fallback face: "Geist
 * Fallback" is Arial, which has Arabic glyphs and would beat Plex.
 */
const geistFont = Geist({
  subsets: ["latin"],
  variable: "--font-geist",
  preload: false,
  adjustFontFallback: false,
  fallback: [],
});
const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  preload: false,
  adjustFontFallback: false,
  fallback: [],
});

export const metadata: Metadata = {
  title: { default: siteConfig.fullName, template: `%s — ${siteConfig.name}` },
  description: siteConfig.description,
  icons: {
    icon: "/brand/oms-app-icon.png",
    apple: "/brand/oms-app-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ar"
      dir="rtl"
      className={cn("font-sans", bodyFont.variable, geistFont.variable, geistMono.variable)}
      suppressHydrationWarning
    >
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
