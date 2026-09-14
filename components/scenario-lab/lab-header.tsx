/**
 * The Scenario Lab page title and its two modes, as tabs.
 *
 * Demand planning and capacity planning answer different questions for
 * different owners, so they never share a screen or a scenario. The title is a
 * heading, not a tab-row item — only the two modes look clickable. The tab
 * keeps the programme in the URL so switching back lands where the planner left.
 */

"use client";

import Link from "next/link";
import { cn } from "@/lib/utils/cn";

export type LabMode = "demand" | "capacity";

const TABS: { mode: LabMode; label: string }[] = [
  { mode: "demand", label: "Demand planning" },
  { mode: "capacity", label: "Capacity planning" },
];

export function LabHeader({ mode, situationId }: { mode: LabMode; situationId?: string }) {
  return (
    <div className="border-b border-[var(--border)] bg-[var(--surface)]">
      <div className="mx-auto w-full max-w-[1360px] px-4 pt-4 sm:px-8 sm:pt-5">
        <h1 className="text-[18px] font-semibold leading-tight tracking-[-0.01em] text-[var(--text-primary)] sm:text-[20px]">
          Scenario Lab
        </h1>
        <p className="mt-0.5 truncate text-[12.5px] text-[var(--text-secondary)] sm:text-[13px]">
          Test changes without touching the plan.
        </p>
        <nav className="mt-3 flex gap-5 sm:gap-6" aria-label="Scenario Lab mode">
          {TABS.map((tab) => {
            const params = new URLSearchParams({ mode: tab.mode });
            if (situationId) params.set("situation", situationId);
            const active = tab.mode === mode;
            return (
              <Link
                key={tab.mode}
                href={`/scenario-lab?${params.toString()}`}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "-mb-px border-b-2 pb-2.5 text-[13.5px] font-medium transition-colors",
                  active
                    ? "border-[var(--text-primary)] text-[var(--text-primary)]"
                    : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                )}
                style={{ transitionDuration: "var(--duration-fast)" }}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
