"use client";

/**
 * The application frame.
 *
 * Two layouts, one component. On a desktop the navigation is a column beside
 * the work; below `lg` it becomes an overlay, because 208px of chrome out of a
 * 390px screen is half the phone spent on where you are rather than what you
 * are doing.
 *
 * The frame used to carry `min-w-[1080px]`, which did not make the product
 * desktop-only so much as make it *broken* on anything narrower — the whole
 * page scrolled sideways and no amount of responsive work inside it could show
 * through.
 */

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [navOpen, setNavOpen] = useState(false);
  const pathname = usePathname();

  // Navigating is the reason the overlay was opened, so it closes itself.
  useEffect(() => setNavOpen(false), [pathname]);

  // Escape closes it, like every other overlay in the product.
  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setNavOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navOpen]);

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--background)] text-[var(--text-primary)]">
      {/* Desktop: a column. */}
      <div className="hidden lg:flex">
        <Sidebar />
      </div>

      {/* Mobile: the same navigation, over the work rather than beside it. */}
      {navOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setNavOpen(false)}
            className="absolute inset-0 bg-black/40 data-[state=open]:animate-in"
          />
          <div className="absolute inset-y-0 left-0 flex animate-in slide-in-from-left duration-200">
            <Sidebar forceExpanded onNavigate={() => setNavOpen(false)} />
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onOpenNav={() => setNavOpen(true)} />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
