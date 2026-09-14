"use client";

/**
 * Components held by a decision rather than by a lead time. Listed so their
 * dates are not a surprise — never with an order action: stable ingredients
 * being predictable does not make uncertain packaging orderable.
 */

import Link from "next/link";
import type { ProgrammeBlockedMaterial } from "@/lib/situations/decisions";

export function BlockedList({
  rows,
  showProgramme,
}: {
  rows: ProgrammeBlockedMaterial[];
  /** Name the programme on each row, when the page spans more than one. */
  showProgramme: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {rows.map((row) => (
        <div
          key={row.key}
          className="flex flex-col gap-1 rounded-[var(--radius-sm)] bg-[var(--surface)] px-3.5 py-2.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-medium text-[var(--text-primary)] sm:inline">{row.materialName}</span>
            <span className="mt-0.5 block text-[12px] text-[var(--text-muted)] sm:ml-2 sm:mt-0 sm:inline">
              {showProgramme ? (
                <>
                  <span className="text-[var(--text-secondary)]">{row.situationTitle}</span>
                  {" · "}
                </>
              ) : null}
              {row.reason}
            </span>
          </span>
          {row.blockedBy ? (
            <Link
              href={`/workspace/${row.situationId}/reconcile`}
              className="flex-none text-[11.5px] text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
              style={{ transitionDuration: "var(--duration-fast)" }}
            >
              Waiting on {row.blockedBy} →
            </Link>
          ) : null}
        </div>
      ))}
    </div>
  );
}
