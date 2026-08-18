import type { Metadata } from "next";
import "./globals.css";
import { IBM_Plex_Sans_Arabic } from "next/font/google";
import { cn } from "@/lib/utils";
import { AppProviders } from "@/providers/app-providers";
import { siteConfig } from "@/config/site";

/** IBM Plex Sans Arabic — Arabic-first typography (ADR-0020), since Arabic is the default locale. Falls back to Alexandria. */
const bodyFont = IBM_Plex_Sans_Arabic({
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  fallback: ["Alexandria", "system-ui", "sans-serif"],
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
      className={cn("font-sans", bodyFont.variable)}
      suppressHydrationWarning
    >
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
