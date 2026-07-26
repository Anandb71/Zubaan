import type { Metadata, Viewport } from "next";
import {
  Bricolage_Grotesque,
  JetBrains_Mono,
  Noto_Sans_Bengali,
  Noto_Sans_Devanagari,
  Noto_Sans_Tamil,
  Silkscreen,
} from "next/font/google";

import "./globals.css";

const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-bricolage",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

const mark = Silkscreen({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-mark",
  display: "swap",
});

const deva = Noto_Sans_Devanagari({
  subsets: ["devanagari"],
  variable: "--font-deva",
  display: "swap",
});

const tamil = Noto_Sans_Tamil({
  subsets: ["tamil"],
  variable: "--font-tamil",
  display: "swap",
});

const bengali = Noto_Sans_Bengali({
  subsets: ["bengali"],
  variable: "--font-bengali",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Zubaan · Vernacular compliance witness",
    template: "%s · Zubaan",
  },
  description:
    "Real-time compliance witness for vernacular financial conversations. It hears the pitch, reads the policy, flags the gap.",
  applicationName: "Zubaan",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "dark",
  themeColor: "#08070d",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${bricolage.variable} ${mono.variable} ${mark.variable} ${deva.variable} ${tamil.variable} ${bengali.variable}`}
    >
      <body>
        <a
          href="#main-content"
          className="fixed left-3 top-3 z-[100] -translate-y-20 bg-cy px-4 py-3 font-mono text-xs font-semibold uppercase tracking-[0.14em] text-ink transition-transform focus:translate-y-0"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
