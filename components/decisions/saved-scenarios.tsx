"use client";

/**
 * Saved scenarios (Decisions §4). A scenario is only overrides — see
 * `stores/situation-scenario-store.ts` — so the only things worth showing
 * here are what it belongs to, how much it changes, and when it last moved.
 */

import Link from "next/link";
import { Trash2 } from "lucide-react";
import { useSituationScenarioStore } from "@/stores/situation-scenario-store";
import { Input } from "@/components/ui/input";
import type { PlanningSituation, SituationScenario } from "@/types/situation";
import { countAdjustments } from "@/lib/situations/scenario";
import { fmtDateShort } from "@/lib/utils/format";

export function SavedScenarios({
  scenarios,
  situations,
}: {
  scenarios: SituationScenario[];
  situations: PlanningSituation[];
}) {
  const setNote = useSituationScenarioStore((s) => s.setNote);
  const deleteScenario = useSituationScenarioStore((s) => s.deleteScenario);
  const titleFor = (situationId: string) => situations.find((s) => s.id === situationId)?.title ?? situationId;

  if (scenarios.length === 0) {
    return (
      <p className="py-4 text-[13px] text-[var(--text-muted)]">
        No scenarios saved yet. Open a situation in the{" "}
        <Link href="/workspace" className="text-[var(--text-primary)] underline">
          workspace
        </Link>{" "}
        to start one.
      </p>
    );
  }

  const sorted = [...scenarios].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return (
    <div className="border-t border-[var(--border)]">
      {sorted.map((scenario) => {
        const adjustments = countAdjustments(scenario.adjustments);
        return (
          <div key={scenario.id} className="border-b border-[var(--border)] py-3">
            <div className="flex items-center gap-4">
              <div className="min-w-0 flex-1">
                <Link
                  href={`/scenario-lab?situation=${scenario.situationId}`}
                  className="truncate text-[13px] font-medium text-[var(--text-primary)] hover:underline"
                >
                  {scenario.name}
                </Link>
                <div className="truncate text-[11.5px] text-[var(--text-muted)]">{titleFor(scenario.situationId)}</div>
              </div>

              <div className="hidden w-[90px] flex-none text-right text-[12px] tabular-nums text-[var(--text-secondary)] sm:block">
                {adjustments} adjustment{adjustments === 1 ? "" : "s"}
              </div>

              <div className="hidden w-[80px] flex-none text-right text-[12px] tabular-nums text-[var(--text-muted)] sm:block">
                {fmtDateShort(scenario.updatedAt)}
              </div>

              <Input
                value={scenario.note ?? ""}
                onChange={(e) => setNote(scenario.id, e.target.value)}
                placeholder="Add a note"
                className="hidden w-48 flex-none sm:flex"
              />

              <button
                type="button"
                onClick={() => deleteScenario(scenario.id)}
                title="Delete scenario"
                aria-label="Delete scenario"
                className="grid size-8 flex-none place-items-center rounded-[var(--radius-sm)] text-[var(--text-muted)] transition-colors hover:bg-[var(--interaction-hover)] hover:text-[var(--risk-critical)]"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>

            {/* A 192px note field and two figure columns do not fit beside the
                name on a phone, so they take the line underneath instead. */}
            <div className="mt-1.5 text-[11.5px] tabular-nums text-[var(--text-muted)] sm:hidden">
              {adjustments} adjustment{adjustments === 1 ? "" : "s"} · {fmtDateShort(scenario.updatedAt)}
            </div>
            <Input
              value={scenario.note ?? ""}
              onChange={(e) => setNote(scenario.id, e.target.value)}
              placeholder="Add a note"
              className="mt-2 w-full sm:hidden"
            />
          </div>
        );
      })}
    </div>
  );
}
