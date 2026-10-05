/**
 * Baseline against scenario, metric by metric, with the change between them.
 * The direction of "better" is stated per metric — fewer stores at risk is
 * good; a smaller order is neither good nor bad on its own.
 */

import type { ScenarioComparison, ScenarioMetrics } from "@/lib/transitions/scenario";
import { cn } from "@/lib/utils/cn";
import { fmtDateShort, fmtMoney, fmtNum, fmtNum1 } from "@/lib/utils/format";

type Better = "lower" | "higher" | "neutral";

interface MetricSpec {
  label: string;
  get: (m: ScenarioMetrics) => number | null;
  format: (n: number) => string;
  better: Better;
  /** Format for the delta, when it differs from the value. */
  delta?: (d: number) => string;
}

export function ComparisonTable({ comparison, currency }: { comparison: ScenarioComparison; currency: string }) {
  const b = comparison.baselineMetrics;
  const s = comparison.scenarioMetrics;
  const specs: MetricSpec[] = [
    { label: "Stores at stockout risk", get: (m) => m.storesAtRisk, format: fmtNum, better: "lower" },
    { label: "Still at risk after transfers + DC", get: (m) => m.storesAtRiskAfterPlan, format: fmtNum, better: "lower" },
    { label: "Successor units to order", get: (m) => m.successorOrder, format: fmtNum, better: "neutral" },
    { label: "Legacy units left after sell-through", get: (m) => m.legacyRemaining, format: fmtNum, better: "lower" },
    { label: "Excess inventory at horizon", get: (m) => m.excessUnits, format: fmtNum, better: "lower" },
    { label: "Units rebalanced between stores", get: (m) => m.transferUnits, format: fmtNum, better: "neutral" },
    {
      label: "Working capital (order + stranded legacy)",
      get: (m) => m.workingCapital,
      format: (n) => fmtMoney(n, currency),
      better: "lower",
    },
    {
      label: "Network cover",
      get: (m) => m.networkWeeksOfCover,
      format: (n) => `${fmtNum1(n)} wks`,
      better: "neutral",
      delta: (d) => `${d > 0 ? "+" : "−"}${fmtNum1(Math.abs(d))} wks`,
    },
  ];

  return (
    <div className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)]">
      <div className="grid grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,0.8fr))] border-b border-[var(--border)] bg-[var(--surface-sunken)] px-4 py-2 text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--text-muted)]">
        <span />
        <span className="text-right">Baseline</span>
        <span className="text-right text-[var(--state-scenario)]">Scenario</span>
        <span className="text-right">Change</span>
      </div>
      {specs.map((spec) => {
        const bv = spec.get(b);
        const sv = spec.get(s);
        const d = bv !== null && sv !== null ? sv - bv : null;
        return (
          <div key={spec.label} className="grid grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,0.8fr))] items-baseline border-b border-[var(--border)] px-4 py-2.5 text-[13px] last:border-b-0">
            <span className="text-[var(--text-secondary)]">{spec.label}</span>
            <span className="text-right tabular-nums text-[var(--text-primary)]">{bv === null ? "—" : spec.format(bv)}</span>
            <span className="text-right font-semibold tabular-nums text-[var(--text-primary)]">{sv === null ? "—" : spec.format(sv)}</span>
            <Delta d={d} better={spec.better} format={spec.delta ?? ((x) => `${x > 0 ? "+" : "−"}${spec.format(Math.abs(x))}`)} />
          </div>
        );
      })}
      <div className="grid grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,0.8fr))] items-baseline px-4 py-2.5 text-[13px]">
        <span className="text-[var(--text-secondary)]">Legacy stock sold through</span>
        <span className="text-right tabular-nums">{b.completionDate ? fmtDateShort(b.completionDate) : "Not selling"}</span>
        <span className="text-right font-semibold tabular-nums">{s.completionDate ? fmtDateShort(s.completionDate) : "Not selling"}</span>
        <span
          className={cn(
            "text-right tabular-nums",
            comparison.completionShiftDays === null || comparison.completionShiftDays === 0
              ? "text-[var(--text-muted)]"
              : comparison.completionShiftDays < 0
                ? "text-[var(--risk-positive)]"
                : "text-[var(--risk-critical)]"
          )}
        >
          {comparison.completionShiftDays === null || comparison.completionShiftDays === 0
            ? "—"
            : `${Math.abs(comparison.completionShiftDays)} days ${comparison.completionShiftDays < 0 ? "sooner" : "later"}`}
        </span>
      </div>
    </div>
  );
}

function Delta({ d, better, format }: { d: number | null; better: Better; format: (d: number) => string }) {
  if (d === null || Math.abs(d) < 0.05) return <span className="text-right text-[var(--text-muted)]">—</span>;
  const good = better === "neutral" ? null : better === "lower" ? d < 0 : d > 0;
  return (
    <span
      className={cn(
        "text-right font-medium tabular-nums",
        good === null ? "text-[var(--text-secondary)]" : good ? "text-[var(--risk-positive)]" : "text-[var(--risk-critical)]"
      )}
    >
      {format(d)}
    </span>
  );
}
