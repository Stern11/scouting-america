"use client";

/**
 * Planning Workspace (V2 §40).
 *
 * Situations, not a gap taxonomy. Each row is one story a planner would name
 * out loud — "Halloween 2027" — and opens straight into the flow.
 */

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useDataset } from "@/components/dataset/dataset-provider";
import { StateBadge } from "@/components/shared/state-badge";
import { Page, PageHeader, NotAvailable } from "@/components/shared/page";
import { fmtMoney, fmtPct, fmtUnits, fmtWeeks } from "@/lib/utils/format";
import { fmtDateShort } from "@/lib/utils/format";

export default function WorkspacePage() {
  const { situations } = useDataset();

  return (
    <Page>
      <PageHeader title="Planning Workspace" subtitle="Future business that is not yet represented at item level" />

      {situations.length === 0 ? (
        <NotAvailable
          title="No planning situations"
          detail="Every business plan line is matched by the formal plan, or there is no business plan to compare against."
        />
      ) : (
        <div className="border-t border-[var(--border)]">
          {situations.map((situation) => {
            const { bridge, capacityExposure, materialExposure, runway } = situation;
            return (
              <Link
                key={situation.id}
                href={`/workspace/${situation.id}/reconcile`}
                className="group flex flex-col gap-3 border-b border-[var(--border)] py-4 transition-colors hover:bg-[var(--interaction-hover)] md:flex-row md:items-center md:gap-6 md:py-5"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                    <span className="text-[15px] font-semibold tracking-tight text-[var(--text-primary)]">
                      {situation.title}
                    </span>
                    <StateBadge state={situation.state} />
                  </div>
                  <div className="mt-1 truncate text-[12.5px] text-[var(--text-muted)]">
                    {situation.businessScope}
                    {situation.productionWindow
                      ? ` · Production ${fmtDateShort(situation.productionWindow.start)} – ${fmtDateShort(situation.productionWindow.end)}`
                      : ""}
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-x-4 gap-y-3 md:contents">
                <Stat
                  value={fmtMoney(bridge.unresolvedValue, bridge.currency)}
                  label="Unresolved"
                  sub={fmtUnits(bridge.unresolvedUnits, true)}
                />
                <Stat value={fmtPct(bridge.representedPct)} label="Represented" />
                <Stat
                  value={capacityExposure.available ? String(capacityExposure.exposedLineIds.length) : "—"}
                  label="Lines exposed"
                />
                <Stat
                  value={materialExposure.available ? String(materialExposure.planNowCount) : "—"}
                  label="Plan now"
                />
                <Stat
                  value={runway.weeksOfRunway !== undefined ? fmtWeeks(runway.weeksOfRunway) : "—"}
                  label="Runway"
                  critical={(runway.weeksOfRunway ?? 99) <= 8}
                />
                </div>

                <ArrowRight className="hidden size-4 flex-none text-[var(--text-muted)] opacity-0 transition-opacity group-hover:opacity-100 md:block" />
              </Link>
            );
          })}
        </div>
      )}
    </Page>
  );
}

function Stat({
  value,
  label,
  sub,
  critical,
}: {
  value: string;
  label: string;
  sub?: string;
  critical?: boolean;
}) {
  return (
    <div className="min-w-0 text-left md:w-[104px] md:flex-none md:text-right">
      <div
        className={
          critical
            ? "text-[15px] font-semibold tabular-nums text-[var(--risk-critical)]"
            : "text-[15px] font-semibold tabular-nums text-[var(--text-primary)]"
        }
      >
        {value}
      </div>
      <div className="truncate text-[11px] text-[var(--text-muted)]">{label}</div>
      {/* On a phone the stats sit in a grid, and one taller cell makes the row ragged. */}
      {sub ? <div className="hidden text-[11px] text-[var(--text-muted)] md:block">{sub}</div> : null}
    </div>
  );
}
