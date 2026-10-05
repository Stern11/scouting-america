"use client";

/**
 * Primary navigation (V2 §7).
 *
 * Intent: a planner who lives in one of four places and wants the rest of the
 * screen for a table. Navigation should say where they are, then get out of
 * the way — which is why it collapses to icons rather than disappearing.
 *
 * Hierarchy: the active destination is the only item with a surface behind it;
 * everything else is quiet until hovered. The account sits at the foot, where
 * an account belongs — it is the least frequent thing here, and putting it in
 * the top bar had it competing with the command bar for the corner a planner
 * looks at most.
 *
 * Depth: borders only, one hairline against the canvas. The sidebar shares the
 * page's own surface rather than taking a colour of its own, so the app reads
 * as one space instead of two.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowRightLeft,
  ListChecks,
  LayoutGrid,
  PanelLeftClose,
  PanelLeftOpen,
  SlidersHorizontal,
} from "lucide-react";
import { useAppStore } from "@/stores/app-store";
import { cn } from "@/lib/utils/cn";
import { UserMenu } from "./user-menu";

/**
 * Four destinations. Lineage, demand, inventory, store coverage and
 * replenishment are steps inside one transition rather than modules of their
 * own — a planner navigates a product transition, not a taxonomy.
 */
const PRIMARY_NAV = [
  { href: "/overview", label: "Overview", icon: LayoutGrid },
  { href: "/transitions", label: "SKU Transitions", icon: ArrowRightLeft },
  { href: "/simulator", label: "Planning Simulator", icon: SlidersHorizontal },
  { href: "/actions", label: "Actions", icon: ListChecks },
];

export function Sidebar({
  forceExpanded = false,
  onNavigate,
}: {
  /** The mobile overlay always shows labels — it has the width to spare. */
  forceExpanded?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const stored = useAppStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const collapsed = forceExpanded ? false : stored;

  return (
    <aside
      className={cn(
        "flex flex-none flex-col border-r border-[var(--border)] bg-[var(--surface)] transition-[width]",
        collapsed ? "w-[60px]" : "w-52"
      )}
      style={{
        transitionDuration: "var(--duration-medium)",
        transitionTimingFunction: "var(--ease-out)",
      }}
    >
      {/* Brand row, same 56px as the top bar so the two align across the seam. */}
      <div
        className={cn(
          "flex h-14 flex-none items-center",
          collapsed ? "justify-center px-0" : "gap-2.5 px-4"
        )}
      >
        <span className="grid size-6 flex-none place-items-center rounded-[5px] bg-[var(--accent)] text-[12px] font-bold text-[var(--text-on-accent)]">
          H
        </span>
        {!collapsed ? (
          <span className="min-w-0 leading-tight">
            <span className="block truncate text-[14px] font-semibold tracking-tight text-[var(--text-primary)]">Heizen</span>
            <span className="block truncate text-[10.5px] text-[var(--text-muted)]">Scout Shop planning</span>
          </span>
        ) : null}
      </div>

      <nav className={cn("flex-1 pt-2", collapsed ? "px-2" : "px-2.5")}>
        <ul className="space-y-0.5">
          {PRIMARY_NAV.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={onNavigate}
                  title={collapsed ? item.label : undefined}
                  aria-label={collapsed ? item.label : undefined}
                  className={cn(
                    "flex items-center rounded-[var(--radius-sm)] text-[13px] transition-colors",
                    collapsed ? "h-9 justify-center" : "gap-2.5 px-2.5 py-[7px]",
                    active
                      ? "bg-[var(--interaction-selected)] font-medium text-[var(--text-primary)]"
                      : "text-[var(--text-secondary)] hover:bg-[var(--interaction-hover)] hover:text-[var(--text-primary)]"
                  )}
                  style={{ transitionDuration: "var(--duration-fast)" }}
                >
                  <Icon className="size-4 flex-none" />
                  {!collapsed ? <span className="truncate">{item.label}</span> : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {!collapsed ? (
        <p className="px-4 pb-3 text-[11px] leading-snug text-[var(--text-muted)]">
          Plan across product transitions, not just individual SKUs.
        </p>
      ) : null}

      <div
        className={cn(
          "flex flex-none items-center border-t border-[var(--border)]",
          collapsed ? "flex-col gap-1 px-2 py-2" : "gap-2 px-3 py-2.5"
        )}
      >
        <UserMenu collapsed={collapsed} />

        {/* Collapsing is a desktop affordance: the mobile overlay is already
            the compact form, and shrinking it there would leave an icon rail
            floating over the page. */}
        <button
          type="button"
          onClick={toggleSidebar}
          hidden={forceExpanded}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          className={cn(
            "grid size-8 flex-none place-items-center rounded-[var(--radius-sm)] text-[var(--text-muted)] transition-colors hover:bg-[var(--interaction-hover)] hover:text-[var(--text-primary)]",
            !collapsed && "ml-auto"
          )}
          style={{ transitionDuration: "var(--duration-fast)" }}
        >
          {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
        </button>
      </div>
    </aside>
  );
}
