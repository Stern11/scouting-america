/**
 * Potential network impact — the "prove it on a few SKUs, multiply across
 * the rest" business case.
 *
 * Left: what the engine measures on today's active transitions. Right: the
 * same per-transition rates scaled to the whole portfolio, labelled as an
 * illustrative extrapolation everywhere it appears. Purchasing is "deferred or
 * avoided", never "saved"; planner hours rest on a stated assumption.
 */

import type { NetworkImpact } from "@/lib/transitions/portfolio";
import { PLANNER_HOURS_PER_TRANSITION_CYCLE } from "@/lib/transitions/portfolio";
import { fmtMoney, fmtNum } from "@/lib/utils/format";

export function NetworkImpactPanel({ impact, currency }: { impact: NetworkImpact; currency: string }) {
  const m = impact.measured;
  const x = impact.extrapolated;
  const rows: { label: string; measured: string; extrapolated: string; note?: string }[] = [
    {
      label: "Usable legacy inventory surfaced",
      measured: `${fmtNum(m.legacyUnitsSurfaced)} units`,
      extrapolated: `${fmtNum(x.legacyUnitsSurfaced)} units`,
      note: "Legacy stock JDA no longer plans against, counted toward successor demand.",
    },
    {
      label: "Purchasing deferred or avoided",
      measured: m.purchasingAvoidedValue !== null ? fmtMoney(m.purchasingAvoidedValue, currency) : `${fmtNum(m.purchasingAvoidedUnits)} units`,
      extrapolated: x.purchasingAvoidedValue !== null ? fmtMoney(x.purchasingAvoidedValue, currency) : `${fmtNum(x.purchasingAvoidedUnits)} units`,
      note: "Successor units an item-level plan would order that existing legacy stock covers. Some is only bought later.",
    },
    {
      label: "Store stockouts prevented",
      measured: fmtNum(m.stockoutsPrevented),
      extrapolated: fmtNum(x.stockoutsPrevented),
      note: "At-risk stores covered by transfers or DC stock before the next shipment.",
    },
    {
      label: "Units rebalanced between stores",
      measured: fmtNum(m.transferUnits),
      extrapolated: fmtNum(x.transferUnits),
    },
    {
      label: "Legacy inventory at risk of stranding",
      measured: m.strandedLegacyValue !== null ? fmtMoney(m.strandedLegacyValue, currency) : `${fmtNum(m.strandedLegacyUnits)} units`,
      extrapolated: x.strandedLegacyValue !== null ? fmtMoney(x.strandedLegacyValue, currency) : `${fmtNum(x.strandedLegacyUnits)} units`,
      note: "Working capital to protect with transfers or a sell-through plan.",
    },
    {
      label: "Planner reconciliation time",
      measured: `${fmtNum(m.plannerHoursPerCycle)} h / cycle`,
      extrapolated: `${fmtNum(x.plannerHoursPerCycle)} h / cycle`,
      note: `Assumes ${PLANNER_HOURS_PER_TRANSITION_CYCLE} h of manual old/new reconciliation per transition per weekly cycle.`,
    },
  ];

  return (
    <div className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)]">
      <div className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,0.8fr)_minmax(0,0.9fr)] border-b border-[var(--border)] bg-[var(--surface-sunken)] px-5 py-2.5 text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--text-muted)]">
        <span />
        <span className="text-right">{fmtNum(m.transitions)} active transitions</span>
        <span className="text-right">
          All {fmtNum(impact.portfolioSize)} transitions
          <span className="ml-1 normal-case tracking-normal text-[var(--state-scenario)]">· illustrative</span>
        </span>
      </div>
      {rows.map((row) => (
        <div
          key={row.label}
          className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,0.8fr)_minmax(0,0.9fr)] items-baseline gap-x-4 border-b border-[var(--border)] px-5 py-3 last:border-b-0"
        >
          <div className="min-w-0">
            <div className="text-[13px] text-[var(--text-primary)]">{row.label}</div>
            {row.note ? <div className="mt-0.5 text-[11.5px] leading-snug text-[var(--text-muted)]">{row.note}</div> : null}
          </div>
          <div className="text-right text-[15px] font-semibold tabular-nums text-[var(--text-primary)]">{row.measured}</div>
          <div className="text-right text-[15px] font-medium tabular-nums text-[var(--text-secondary)]">{row.extrapolated}</div>
        </div>
      ))}
      <p className="border-t border-[var(--border)] bg-[var(--surface-sunken)] px-5 py-2.5 text-[11.5px] leading-snug text-[var(--text-muted)]">
        Illustrative extrapolation: today&rsquo;s per-transition rates applied to the whole portfolio. It is a sizing
        estimate for a business case, not realized value.
      </p>
    </div>
  );
}
