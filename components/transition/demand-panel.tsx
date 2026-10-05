"use client";

/**
 * Demand continuity — the demand did not begin when the SKU number changed.
 *
 * Left: the lineage's sales month by month, legacy fading into successor, so
 * the planner sees one stream. Right: how that stream becomes the horizon
 * demand, line by line, with the assumptions the planner owns beneath it.
 */

import { useState } from "react";
import type { TransitionView } from "@/types/transition";
import { linearAxis, pctOfAxis } from "@/lib/charts/axis";
import { demandLines } from "@/lib/transitions/explain";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LineageLegend } from "@/components/shared/transition-bar";
import { fmtCompact, fmtNum, fmtPct } from "@/lib/utils/format";
import { CalcLines } from "./calc-lines";
import { useDecisions } from "./use-decisions";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function DemandPanel({ view }: { view: TransitionView }) {
  const d = view.demand;
  if (!d.available) {
    return (
      <p className="text-[13px] text-[var(--text-muted)]">
        No sales history for these SKUs. Add Sales_History rows to carry legacy demand forward.
      </p>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
      <div>
        <MonthlyChart view={view} />
        <YearlyTable view={view} />
        <p className="mt-3 text-[12px] leading-snug text-[var(--text-muted)]">
          Legacy and successor sales are one stream: each sale is counted once, in the month it happened. The successor
          is never forecast on top of the legacy history it inherits.
        </p>
      </div>
      <div>
        <CalcLines lines={demandLines(view)} />
        <DemandControls view={view} />
      </div>
    </div>
  );
}

function MonthlyChart({ view }: { view: TransitionView }) {
  const points = view.demand.monthly;
  const axis = linearAxis(Math.max(1, ...points.map((p) => p.legacyUnits + p.successorUnits)), 4, true);
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[12px] font-medium text-[var(--text-secondary)]">Units sold per month, last 24 months</span>
        <LineageLegend />
      </div>
      <div className="relative h-[150px] pl-9">
        {axis.ticks.map((t) => (
          <div key={t} className="absolute left-9 right-0 border-t border-[var(--chart-gridline-color)]" style={{ bottom: `${pctOfAxis(t, axis.max)}%` }}>
            <span className="absolute -left-9 -translate-y-1/2 text-[10.5px] tabular-nums text-[var(--chart-label-color)]">
              {fmtCompact(t)}
            </span>
          </div>
        ))}
        <div className="relative flex h-full items-end gap-[3px]">
          {points.map((p, i) => {
            const isCurrent = i === points.length - 1;
            return (
              <div
                key={p.month}
                className="group relative flex h-full flex-1 flex-col justify-end"
                title={`${MONTHS[Number(p.month.slice(5, 7)) - 1]} ${p.month.slice(0, 4)}${isCurrent ? " (to date)" : ""}: ${fmtNum(p.legacyUnits)} legacy · ${fmtNum(p.successorUnits)} successor`}
              >
                <div className="bg-[var(--lineage-successor)] group-hover:opacity-85" style={{ height: `${pctOfAxis(p.successorUnits, axis.max)}%`, opacity: isCurrent ? 0.55 : 1 }} />
                <div className="bg-[var(--lineage-legacy)] group-hover:opacity-85" style={{ height: `${pctOfAxis(p.legacyUnits, axis.max)}%`, opacity: isCurrent ? 0.55 : 1 }} />
              </div>
            );
          })}
        </div>
      </div>
      <div className="mt-1 flex gap-[3px] pl-9">
        {points.map((p, i) => (
          <span key={p.month} className="flex-1 text-center text-[10px] text-[var(--chart-label-color)]">
            {i % 3 === 0 ? `${MONTHS[Number(p.month.slice(5, 7)) - 1]} ${p.month.slice(2, 4)}` : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

function YearlyTable({ view }: { view: TransitionView }) {
  return (
    <table className="mt-4 w-full border-collapse text-[13px]">
      <thead>
        <tr className="border-b border-[var(--border-strong)] text-[11px] uppercase tracking-[0.06em] text-[var(--text-muted)]">
          <th className="pb-1.5 text-left font-medium">Year</th>
          <th className="pb-1.5 text-right font-medium text-[var(--lineage-legacy)]">Legacy SKU</th>
          <th className="pb-1.5 text-right font-medium text-[var(--lineage-successor)]">Successor SKU</th>
          <th className="pb-1.5 text-right font-medium">Combined</th>
        </tr>
      </thead>
      <tbody>
        {view.demand.yearly.map((y) => (
          <tr key={y.year} className="border-b border-[var(--border)] last:border-b-0">
            <td className="py-1.5 text-[var(--text-secondary)]">
              {y.year}
              {y.ytd ? " YTD" : ""}
            </td>
            <td className="py-1.5 text-right tabular-nums">{y.legacyUnits > 0 ? fmtNum(y.legacyUnits) : "—"}</td>
            <td className="py-1.5 text-right tabular-nums">{y.successorUnits > 0 ? fmtNum(y.successorUnits) : "—"}</td>
            <td className="py-1.5 text-right font-medium tabular-nums">{fmtNum(y.legacyUnits + y.successorUnits)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const TRANSFER_OPTIONS = [1, 0.95, 0.9, 0.85, 0.8, 0.7, 0.6, 0.5];
const ADJUST_OPTIONS = [-0.2, -0.1, -0.05, 0, 0.05, 0.1, 0.2];

function DemandControls({ view }: { view: TransitionView }) {
  const decisions = useDecisions(view.id);
  const a = view.assumptions;
  const [draft, setDraft] = useState("");
  const hasLegacy = view.lineage.predecessors.length > 0 && view.lineage.successors.length > 0;

  return (
    <div className="mt-5 space-y-3 border-t border-[var(--border)] pt-4">
      <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-muted)]">Your assumptions</div>
      {hasLegacy ? (
        <ControlRow label="Legacy demand that transfers">
          <Select
            value={String(a.transferredDemandPct)}
            onValueChange={(v) =>
              decisions.override({ transferredDemandPct: Number(v) }, `Transferred demand set to ${fmtPct(Number(v))}`)
            }
          >
            <SelectTrigger className="w-[92px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[...new Set([a.transferredDemandPct, ...TRANSFER_OPTIONS])]
                .sort((x, y) => y - x)
                .map((o) => (
                  <SelectItem key={o} value={String(o)}>
                    {fmtPct(o)}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </ControlRow>
      ) : null}
      <ControlRow label="Demand adjustment">
        <Select
          value={String(a.demandAdjustmentPct)}
          onValueChange={(v) =>
            decisions.override(
              { demandAdjustmentPct: Number(v) },
              `Demand adjustment set to ${Number(v) >= 0 ? "+" : ""}${fmtPct(Number(v))}`
            )
          }
        >
          <SelectTrigger className="w-[92px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[...new Set([a.demandAdjustmentPct, ...ADJUST_OPTIONS])]
              .sort((x, y) => x - y)
              .map((o) => (
                <SelectItem key={o} value={String(o)}>
                  {o > 0 ? "+" : ""}
                  {fmtPct(o)}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </ControlRow>
      <ControlRow label={`Demand, next ${view.demand.horizonWeeks} weeks`}>
        <div className="flex items-center gap-1.5">
          <Input
            inputMode="numeric"
            value={draft}
            onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, ""))}
            placeholder={fmtNum(view.demand.horizonUnits)}
            className="w-[92px] text-right"
            aria-label="Override horizon demand"
          />
          <Button
            size="sm"
            variant="outline"
            disabled={draft === ""}
            onClick={() => {
              decisions.override(
                { demandOverrideUnits: Number(draft) },
                `Demand for the next ${view.demand.horizonWeeks} weeks set to ${fmtNum(Number(draft))} (calculated ${fmtNum(view.demand.calculatedHorizonUnits)})`
              );
              setDraft("");
            }}
          >
            Set
          </Button>
        </div>
      </ControlRow>
      {view.demand.overridden || a.demandAdjustmentPct !== 0 ? (
        <button
          type="button"
          onClick={() =>
            decisions.clear(["demandOverrideUnits", "demandAdjustmentPct", "transferredDemandPct"], "Demand reset to the calculated figure")
          }
          className="text-[12px] text-[var(--text-muted)] underline underline-offset-4 hover:text-[var(--text-primary)]"
        >
          Reset to calculated demand
        </button>
      ) : null}
    </div>
  );
}

function ControlRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[13px] text-[var(--text-secondary)]">{label}</span>
      {children}
    </div>
  );
}
