"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const productNav = [
  { href: "/call", label: "Live" },
  { href: "/inbox", label: "Inbox" },
  { href: "/import", label: "Import" },
  { href: "/compliance", label: "Ledger" },
  { href: "/product", label: "Sources" },
];

const landingNav = [
  { href: "#witness", label: "Witness" },
  { href: "#duet", label: "Two mouths" },
  { href: "#console", label: "Live console" },
];

export function AppShell({
  children,
  bare = false,
  landing = false,
}: {
  children: ReactNode;
  bare?: boolean;
  landing?: boolean;
}) {
  const pathname = usePathname();
  const nav = landing ? landingNav : productNav;

  return (
    <div className="noise-field min-h-dvh">
      <div className="scanline" aria-hidden>
        <span />
      </div>

      <header className="sticky top-0 z-[70] border-b border-[rgba(239,232,218,0.1)] bg-[linear-gradient(180deg,rgba(8,7,13,.94),rgba(8,7,13,.72))] backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-[1400px] items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/" className="group flex min-h-11 items-center gap-3" aria-label="Zubaan home">
            <span className="brand-mark" aria-hidden />
            <span className="flex items-baseline gap-2">
              <span className="font-mark text-[13px] tracking-[0.22em] text-bone">
                ZUBAAN
              </span>
              <span className="font-deva hidden text-sm text-dim sm:inline">ज़ुबान</span>
            </span>
          </Link>

          <nav
            className="hidden items-center gap-5 font-mono text-[11px] uppercase tracking-[0.14em] md:flex"
            aria-label="Primary navigation"
          >
            {nav.map((item) => {
              const active =
                !landing &&
                (pathname === item.href || pathname.startsWith(`${item.href}/`));
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={
                    active
                      ? "text-cy"
                      : "text-dim transition-colors hover:text-bone"
                  }
                >
                  {item.label}
                </Link>
              );
            })}
            {landing ? (
              <Link
                href="/call"
                className="text-cy transition-colors hover:text-bone"
              >
                Enter app
              </Link>
            ) : null}
            <span className="rec-pill" aria-hidden>
              <i />
              REC
            </span>
          </nav>

          <div className="flex items-center gap-2 md:hidden">
            <span className="rec-pill">
              <i />
              REC
            </span>
          </div>
        </div>
      </header>

      <main
        id="main-content"
        className={
          bare
            ? "relative z-[1]"
            : "relative z-[1] mx-auto max-w-[1400px] px-4 pb-28 pt-7 sm:px-6 lg:pb-12"
        }
      >
        {children}
      </main>

      {!landing ? (
        <nav
          className="fixed inset-x-0 bottom-0 z-50 border-t border-[rgba(239,232,218,0.12)] bg-ink/95 px-2 pb-[max(.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur-md md:hidden"
          aria-label="Mobile navigation"
        >
          <div className="grid grid-cols-5">
            {productNav.map((item) => {
              const active =
                pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={[
                    "flex min-h-14 flex-col items-center justify-center gap-1 font-mono text-[10px] uppercase tracking-[0.12em]",
                    active ? "text-cy" : "text-dim",
                  ].join(" ")}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        </nav>
      ) : null}
    </div>
  );
}
