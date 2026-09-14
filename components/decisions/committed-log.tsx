"use client";

/**
 * What the planner has put their name to (PRD §20): components released for
 * ordering and volumes committed, across every programme, newest first.
 *
 * Every row carries its own undo. Heizen records a planning decision; it does
 * not place the order — so nothing here is irreversible, and nothing should
 * look it.
 */

import Link from "next/link";
import { useDatasetStore } from "@/stores/dataset-store";
import type { CommittedEntry } from "@/lib/situations/decisions";
import { fmtDateShort, fmtNum, fmtUnits } from "@/lib/utils/format";

export function CommittedLog({ entries }: { entries: CommittedEntry[] }) {
  const undoMaterialRelease = useDatasetStore((s) => s.undoMaterialRelease);
  const releaseCommitment = useDatasetStore((s) => s.releaseCommitment);

  if (entries.length === 0) {
    return (
      <p className="py-4 text-[13px] text-[var(--text-muted)]">Nothing released or committed yet.</p>
    );
  }

  return (
    <div className="divide-y divide-[var(--border)] border-y border-[var(--border)]">
      {entries.map((entry) => (
        <div key={entry.key} className="flex items-baseline justify-between gap-4 py-3">
          <div className="min-w-0">
            <div className="truncate text-[13px] font-medium text-[var(--text-primary)]">
              {entry.kind === "release" ? `Order ${entry.release.materialName}` : entry.commitment.itemName}
            </div>
            <div className="truncate text-[11.5px] text-[var(--text-muted)]">
              <Link
                href={`/workspace/${entry.situationId}/reconcile`}
                className="text-[var(--text-secondary)] hover:underline"
              >
                {entry.situationTitle}
              </Link>
              {" · "}
              {entry.kind === "release"
                ? `Released${
                    entry.release.supplierName ? ` to ${entry.release.supplierName}` : " for ordering"
                  } · order by ${fmtDateShort(entry.release.decisionDate)}`
                : `Volume committed · ${entry.commitment.basisLabel} would have carried ${fmtUnits(
                    entry.commitment.basisUnits
                  )}`}
            </div>
          </div>

          <div className="flex flex-none items-baseline gap-4">
            {entry.kind === "release" ? (
              // A zero net requirement means stock and open supply already
              // cover it; "0 kg" read like a missing number.
              entry.release.quantity > 0 ? (
                <span className="text-[13px] font-medium tabular-nums text-[var(--text-primary)]">
                  {fmtNum(Math.round(entry.release.quantity))} {entry.release.uom}
                </span>
              ) : (
                <span className="text-[12px] text-[var(--text-muted)]">Covered by stock</span>
              )
            ) : (
              <span className="text-[13px] font-medium tabular-nums text-[var(--state-scenario)]">
                {fmtUnits(entry.commitment.units)} units
              </span>
            )}
            <span className="hidden w-[64px] text-right text-[11.5px] tabular-nums text-[var(--text-muted)] sm:inline">
              {fmtDateShort(entry.at)}
            </span>
            <button
              type="button"
              onClick={() =>
                entry.kind === "release"
                  ? undoMaterialRelease(entry.situationId, entry.release.materialId)
                  : releaseCommitment(entry.situationId, entry.commitment.candidateId)
              }
              title={entry.kind === "release" ? "Take the release back" : "Drop the committed volume"}
              className="-my-2 inline-flex h-8 items-center px-1 text-[11.5px] text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
              style={{ transitionDuration: "var(--duration-fast)" }}
            >
              Undo
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
