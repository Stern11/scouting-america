/**
 * Turning a scenario volume into a plan (V2 §20.3, §53).
 *
 * The step the lab was missing at the other end: a planner could reach a
 * number they believed, and then had nowhere to put it.
 *
 * Committing does not write back to the dataset. It records a governed
 * provisional assumption — what was carried, what the basis would have said,
 * and when the planner decided — and marks the item carry forward so it bears
 * load. The workbook it came from is never rewritten, and the commitment stays
 * reversible and visible on Decisions.
 */

"use client";

import { Check, Undo2 } from "lucide-react";
import { useDatasetStore } from "@/stores/dataset-store";
import { cn } from "@/lib/utils/cn";
import { fmtUnits } from "@/lib/utils/format";
import type { PlanningSituation, ScenarioAdjustments, VolumeCommitment } from "@/types/situation";

/** A stable empty reference, so an absent map never re-renders the tree. */
const EMPTY_COMMITMENTS: Record<string, VolumeCommitment> = {};

export function CommitBar({
  baseline,
  scenario,
  adjustments,
}: {
  baseline: PlanningSituation;
  /** The situation recomputed with the scenario applied. */
  scenario: PlanningSituation;
  adjustments: ScenarioAdjustments;
}) {
  const commitVolume = useDatasetStore((s) => s.commitVolume);
  const releaseCommitment = useDatasetStore((s) => s.releaseCommitment);
  // Selected as the stored reference, not `?? {}` — a selector that mints a new
  // object each call makes Zustand's snapshot change on every render, which
  // React reports as an infinite update loop.
  const commitments = useDatasetStore((s) => s.overridesBySituation[baseline.id]?.commitments);
  const committed = commitments ?? EMPTY_COMMITMENTS;

  const overrides = adjustments.volumeUnits ?? {};
  // Only changes that differ from what is already committed are pending — a
  // value the planner has already put in the plan is not a change to make again.
  const pending = Object.entries(overrides)
    .map(([candidateId, units]) => {
      const item = scenario.candidateItems.find((c) => c.id === candidateId);
      if (!item) return undefined;
      // Committing marks an item carry forward. Whether a SKU is carried is a
      // Reconcile decision, so a volume tested on a to-decide SKU sizes the gap
      // here but is never slipped into the plan by this button.
      if (item.disposition !== "carry_forward") return undefined;
      const already = committed[candidateId];
      if (already && already.units === units) return undefined;
      return { item, units, already };
    })
    .filter((x): x is NonNullable<typeof x> => x !== undefined);

  const committedList = Object.values(committed);

  if (pending.length === 0 && committedList.length === 0) return null;

  const commitAll = () => {
    for (const { item, units } of pending) {
      commitVolume(baseline.id, {
        candidateId: item.id,
        itemName: item.itemName,
        units,
        basisUnits: item.plannedBasis.inferredUnits,
        basisLabel: item.plannedBasis.label,
        // Dataset time, never wall-clock — the same rule the engine follows.
        committedAt: baseline.calculatedAt,
      });
    }
  };

  const pendingUnits = pending.reduce(
    (sum, p) => sum + (p.units - (p.already?.units ?? p.item.plannedBasis.inferredUnits)),
    0
  );

  return (
    <div className="mt-8 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] px-4 py-4 sm:px-5">
      {pending.length > 0 ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
          <div className="min-w-0">
            <div className="text-[13px] font-medium text-[var(--text-primary)]">
              {pending.length} volume change{pending.length === 1 ? "" : "s"} not in the plan yet
            </div>
            <div className="mt-0.5 truncate text-[12px] tabular-nums text-[var(--text-muted)]">
              {pendingUnits >= 0 ? "+" : ""}
              {fmtUnits(pendingUnits)} against the basis ·{" "}
              {pending
                .slice(0, 2)
                .map((p) => p.item.itemName)
                .join(", ")}
              {pending.length > 2 ? ` +${pending.length - 2} more` : ""}
            </div>
          </div>
          <button
            type="button"
            onClick={commitAll}
            className="inline-flex flex-none items-center justify-center gap-1.5 self-stretch rounded-[var(--radius-sm)] sm:self-auto bg-[var(--accent)] px-3.5 py-2 text-[13px] font-medium text-[var(--text-on-accent)] transition-opacity hover:opacity-90"
            style={{ transitionDuration: "var(--duration-fast)" }}
          >
            <Check className="size-3.5" />
            Add to plan
          </button>
        </div>
      ) : null}

      {committedList.length > 0 ? (
        <div className={cn(pending.length > 0 && "mt-4 border-t border-[var(--border)] pt-3.5")}>
          <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.09em] text-[var(--text-muted)]">
            In the plan
          </div>
          <ul className="flex flex-col gap-1.5">
            {committedList.map((c) => (
              <li key={c.candidateId} className="flex items-baseline justify-between gap-4">
                <span className="min-w-0 truncate text-[12.5px] text-[var(--text-primary)]">
                  {c.itemName}
                </span>
                <span className="flex flex-none items-baseline gap-3">
                  <span className="text-[12px] tabular-nums text-[var(--text-muted)]">
                    {fmtUnits(c.basisUnits)} → {fmtUnits(c.units)}
                  </span>
                  <button
                    type="button"
                    onClick={() => releaseCommitment(baseline.id, c.candidateId)}
                    className="inline-flex items-center gap-1 text-[11.5px] text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
                    style={{ transitionDuration: "var(--duration-fast)" }}
                  >
                    <Undo2 className="size-3" />
                    Release
                  </button>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2.5 text-[11.5px] leading-relaxed text-[var(--text-muted)]">
            These carry load in the plan and appear on Decisions with what they were based on. The
            uploaded data is never rewritten — releasing one returns the item to its season basis.
          </p>
        </div>
      ) : null}
    </div>
  );
}
