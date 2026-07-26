"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

type IconName = "call" | "document" | "shield" | "pulse";

const nav = [
  { href: "/call", label: "Live call", icon: "call" as const },
  { href: "/compliance", label: "Compliance", icon: "pulse" as const },
  { href: "/product", label: "Product terms", icon: "document" as const },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="noise-field min-h-dvh bg-ink">
      <header className="sticky top-0 z-40 border-b hairline bg-ink/95 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-[1600px] items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link
            href="/call"
            className="group flex min-h-11 items-center gap-3 rounded-md pr-2"
            aria-label="Zubaan home"
          >
            <span className="grid size-9 place-items-center rounded-md bg-saffron text-ink transition-transform duration-200 group-active:scale-95">
              <Icon name="shield" className="size-5" />
            </span>
            <span>
              <span className="font-display block text-lg font-semibold leading-none tracking-tight">
                ZUBAAN
              </span>
              <span className="mt-1 hidden text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)] sm:block">
                Before they sign
              </span>
            </span>
          </Link>

          <nav className="hidden items-center gap-1 md:flex" aria-label="Primary navigation">
            {nav.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={[
                    "flex min-h-11 items-center gap-2 rounded-md px-4 text-sm font-semibold transition-colors duration-200",
                    active
                      ? "bg-ink-soft text-[var(--text)]"
                      : "text-[var(--text-muted)] hover:bg-ink-soft/70 hover:text-[var(--text)]",
                  ].join(" ")}
                >
                  <Icon name={item.icon} className="size-[18px]" />
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-muted)]">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-safe opacity-40" />
              <span className="relative inline-flex size-2 rounded-full bg-safe" />
            </span>
            System online
          </div>
        </div>
      </header>

      <main id="main-content" className="mx-auto max-w-[1600px] px-4 pb-28 pt-6 sm:px-6 lg:px-8 lg:pb-10">
        {children}
      </main>

      <nav
        className="fixed inset-x-0 bottom-0 z-50 border-t hairline bg-ink/95 px-2 pb-[max(.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur-md md:hidden"
        aria-label="Mobile navigation"
      >
        <div className="grid grid-cols-3">
          {nav.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={[
                  "flex min-h-14 flex-col items-center justify-center gap-1 rounded-md text-[11px] font-semibold transition-colors",
                  active ? "bg-ink-soft text-saffron" : "text-[var(--text-muted)]",
                ].join(" ")}
              >
                <Icon name={item.icon} className="size-5" />
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

export function Icon({
  name,
  className = "size-5",
}: {
  name: IconName;
  className?: string;
}) {
  const common = {
    className,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  if (name === "call") {
    return (
      <svg {...common}>
        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3M8 22h8" />
      </svg>
    );
  }
  if (name === "document") {
    return (
      <svg {...common}>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
        <path d="M14 2v6h6M8 13h8M8 17h6" />
      </svg>
    );
  }
  if (name === "pulse") {
    return (
      <svg {...common}>
        <path d="M3 12h4l2-7 4 14 2-7h6" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}
