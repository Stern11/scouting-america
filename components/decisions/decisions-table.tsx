"use client";

/**
 * Every candidate item the planner has explicitly disposed of, across every
 * situation (Decisions §3). Proposed and chosen disposition are shown side by
 * side deliberately — an overridden proposal should stay visible, not be
 * silently replaced by the planner's final call.
 */

import Link from "next/link";
import { DataTable, type Column } from "@/components/shared/data-table";
import { DispositionBadge } from "@/components/shared/state-badge";
import type { CandidateItem, PlanningSituation, SituationOverrides } from "@/types/situation";
import { LOAD_BEARING_DISPOSITIONS } from "@/types/situation";
import { fmtMoney, fmtUnits } from "@/lib/utils/format";

interface DecisionRow {
  situationId: string;
  situationTitle: string;
  currency: string;
  item: CandidateItem;
}

export function DecisionsTable({
  situations,
  overridesBySituation,
}: {
  situations: PlanningSituation[];
  overridesBySituation: Record<string, SituationOverrides>;
}) {
  const rows: DecisionRow[] = [];
  for (const situation of situations) {
    const dispositions = overridesBySituation[situation.id]?.dispositions ?? {};
    for (const item of situation.candidateItems) {
      if (item.id in dispositions) {
        rows.push({
          situationId: situation.id,
          situationTitle: situation.title,
          currency: situation.bridge.currency,
          item,
        });
      }
    }
  }

  const columns: Column<DecisionRow>[] = [
    {
      key: "situation",
      header: "Situation",
      width: "16%",
      sortValue: (row) => row.situationTitle,
      render: (row) => (
        <Link
          href={`/workspace/${row.situationId}/reconcile`}
          className="truncate text-[13px] text-[var(--text-primary)] hover:underline"
        >
          {row.situationTitle}
        </Link>
      ),
    },
    {
      key: "item",
      header: "Item",
      width: "26%",
      sortValue: (row) => row.item.itemName,
      render: (row) => (
        <div className="min-w-0">
          <div className="truncate font-medium text-[var(--text-primary)]">{row.item.itemName}</div>
          <div className="truncate text-[11.5px] text-[var(--text-muted)]">{row.item.itemId}</div>
        </div>
      ),
    },
    {
      key: "units",
      header: "Prior units",
      numeric: true,
      sortValue: (row) => row.item.actualUnits,
      render: (row) => fmtUnits(row.item.actualUnits),
    },
    {
      key: "value",
      header: "Prior value",
      numeric: true,
      sortValue: (row) => row.item.actualValue,
      render: (row) => fmtMoney(row.item.actualValue, row.currency),
    },
    {
      key: "proposed",
      header: "Proposed",
      width: "150px",
      render: (row) => <DispositionBadge disposition={row.item.proposedDisposition} />,
    },
    {
      key: "decided",
      header: "Decided",
      width: "150px",
      render: (row) => <DispositionBadge disposition={row.item.disposition} />,
    },
    {
      key: "load",
      header: "Load-bearing",
      width: "100px",
      render: (row) =>
        LOAD_BEARING_DISPOSITIONS.includes(row.item.disposition) ? (
          <span className="text-[12px] text-[var(--state-validated)]">Yes</span>
        ) : (
          <span className="text-[12px] text-[var(--text-muted)]">No</span>
        ),
    },
  ];

  return (
    <DataTable
      rows={rows}
      columns={columns}
      rowKey={(row) => `${row.situationId}:${row.item.id}`}
      initialSort={{ key: "value", direction: "desc" }}
      minWidth={880}
      card={(row) => (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-[13px] font-medium text-[var(--text-primary)]">{row.item.itemName}</div>
              <div className="truncate text-[11.5px] text-[var(--text-muted)]">
                <Link href={`/workspace/${row.situationId}/reconcile`} className="text-[var(--text-secondary)] hover:underline">
                  {row.situationTitle}
                </Link>
                {` · ${row.item.itemId}`}
              </div>
            </div>
            <div className="flex-none text-right">
              <div className="text-[13px] font-medium tabular-nums text-[var(--text-primary)]">
                {fmtMoney(row.item.actualValue, row.currency)}
              </div>
              <div className="text-[11px] tabular-nums text-[var(--text-muted)]">{fmtUnits(row.item.actualUnits)} prior</div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-[11.5px] text-[var(--text-muted)]">
            <DispositionBadge disposition={row.item.proposedDisposition} />
            <span aria-hidden>→</span>
            <DispositionBadge disposition={row.item.disposition} />
            <span className="ml-auto">
              {LOAD_BEARING_DISPOSITIONS.includes(row.item.disposition) ? (
                <span className="text-[var(--state-validated)]">Counts as load</span>
              ) : (
                "No load"
              )}
            </span>
          </div>
        </div>
      )}
      empty={
        <span>
          No decisions have been recorded yet. Open a situation in the{" "}
          <Link href="/workspace" className="text-[var(--text-primary)] underline">
            workspace
          </Link>{" "}
          to decide.
        </span>
      }
    />
  );
}
