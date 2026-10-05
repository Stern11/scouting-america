"use client";

/**
 * Simulator levers. Each shows where the baseline sits, what the scenario has
 * moved it to, and resets on its own — a planner should always be able to
 * see which assumption is doing the work.
 */

import { RotateCcw } from "lucide-react";
import type { ScenarioAdjustments, TransitionView } from "@/types/transition";
import type { LeverKey } from "@/stores/scenario-store";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils/cn";
import { addDaysTo } from "@/lib/transitions/time";
import { fmtDateShort, fmtNum, fmtNum1, fmtPct } from "@/lib/utils/format";

interface LeverSpec {
  key: LeverKey;
  label: string;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  /** One line under the slider explaining what the value means now. */
  explain?: (v: number, baseline: TransitionView) => string | null;
  applies?: (v: TransitionView) => boolean;
}

const pct = (v: number) => fmtPct(v);
const signed = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${fmtPct(Math.abs(v))}`;
const weeks = (v: number) => `${fmtNum1(v)} wks`;

export const LEVERS: LeverSpec[] = [
  {
    key: "demandAdjustmentPct",
    label: "Expected demand",
    min: -0.2,
    max: 0.2,
    step: 0.05,
    format: signed,
    explain: (v, b) => `${fmtNum((b.demand.weeklyUnits / (1 + b.assumptions.demandAdjustmentPct)) * (1 + v))} units a week`,
  },
  {
    key: "inboundDelayWeeks",
    label: "Supplier delay",
    min: 0,
    max: 6,
    step: 1,
    format: (v) => (v === 0 ? "On time" : `${v} wk${v === 1 ? "" : "s"} late`),
    explain: (v, b) => {
      const next = b.inventory.receipts.find((r) => b.lineage.successors.some((s) => s.skuId === r.skuId));
      if (!next) return "No successor shipment on order";
      const moved = addDaysTo(next.expectedDate, v * 7);
      return `${next.purchaseOrderId ?? "Next shipment"} arrives ${fmtDateShort(moved)}${v > 0 ? ` (was ${fmtDateShort(next.expectedDate)})` : ""}`;
    },
    applies: (b) => b.inventory.receipts.length > 0,
  },
  {
    key: "substitutabilityPct",
    label: "Legacy substitutability",
    min: 0,
    max: 1,
    step: 0.05,
    format: pct,
    explain: (v, b) => `${fmtNum1(b.inventory.legacyOnHand * v)} of ${fmtNum1(b.inventory.legacyOnHand)} legacy units usable`.replace(/\.0(?= )/g, ""),
    applies: (b) => b.lineage.predecessors.length > 0 && b.lineage.successors.length > 0,
  },
  {
    key: "safetyStockWeeks",
    label: "Safety stock",
    min: 1,
    max: 8,
    step: 0.5,
    format: weeks,
    applies: (b) => b.lineage.successors.length > 0,
  },
  {
    key: "sellThroughWeeks",
    label: "Legacy sell-through period",
    min: 2,
    max: 20,
    step: 1,
    format: weeks,
    explain: (v, b) => `Legacy given until ${fmtDateShort(addDaysTo(b.planningNow, v * 7))} to sell`,
    applies: (b) => b.lineage.predecessors.length > 0,
  },
  {
    key: "transferredDemandPct",
    label: "Legacy demand that transfers",
    min: 0.5,
    max: 1,
    step: 0.05,
    format: pct,
    applies: (b) => b.lineage.predecessors.length > 0 && b.lineage.successors.length > 0,
  },
];

export function Levers({
  baseline,
  adjustments,
  onChange,
}: {
  baseline: TransitionView;
  adjustments: ScenarioAdjustments;
  onChange: (key: LeverKey, value: number | undefined) => void;
}) {
  return (
    <div className="space-y-5">
      {LEVERS.filter((l) => !l.applies || l.applies(baseline)).map((lever) => {
        const base = baseline.assumptions[lever.key];
        const set = adjustments[lever.key];
        const value = set ?? base;
        const moved = set !== undefined && Math.abs(set - base) > 1e-9;
        const min = Math.min(lever.min, base);
        const max = Math.max(lever.max, base);
        const basePct = ((base - min) / (max - min)) * 100;
        return (
          <div key={lever.key}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[13px] font-medium text-[var(--text-primary)]">{lever.label}</span>
              <span className="flex items-center gap-2">
                <span className={cn("text-[13px] font-semibold tabular-nums", moved ? "text-[var(--state-scenario)]" : "text-[var(--text-secondary)]")}>
                  {lever.format(value)}
                </span>
                {moved ? (
                  <button
                    type="button"
                    aria-label={`Reset ${lever.label}`}
                    title="Back to baseline"
                    onClick={() => onChange(lever.key, undefined)}
                    className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  >
                    <RotateCcw className="size-3" />
                  </button>
                ) : null}
              </span>
            </div>
            <div className="relative mt-2.5">
              <Slider
                min={min}
                max={max}
                step={lever.step}
                value={[value]}
                onValueChange={([v]) => onChange(lever.key, v === undefined || Math.abs(v - base) < 1e-9 ? undefined : round(v))}
                aria-label={lever.label}
              />
              {/* Where the baseline sits, so a moved lever always shows how far. */}
              <span
                className="pointer-events-none absolute top-1/2 h-3 w-px -translate-y-1/2 bg-[var(--text-muted)]"
                style={{ left: `${basePct}%` }}
                aria-hidden
              />
            </div>
            <div className="mt-1.5 flex justify-between text-[11px] text-[var(--text-muted)]">
              <span>{lever.explain?.(value, baseline) ?? ""}</span>
              <span className="flex-none">baseline {lever.format(base)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}
