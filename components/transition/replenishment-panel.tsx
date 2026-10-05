"use client";

/**
 * Replenishment — how much successor to actually order once legacy stock is
 * counted, with the arithmetic in full.
 *
 * The comparison beneath it is the value in one line: what an item-level view
 * would order, what Heizen recommends, and the difference — described as
 * deferred or avoided, never as savings.
 */

import { useState } from "react";
import type { TransitionView } from "@/types/transition";
import { replenishmentLines } from "@/lib/transitions/explain";
import { linearAxis, pctOfAxis } from "@/lib/charts/axis";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils/cn";
import { fmtCompact, fmtDateShort, fmtMoney, fmtNum } from "@/lib/utils/format";
import { CalcLines } from "./calc-lines";
import { useDecisions } from "./use-decisions";

export function ReplenishmentPanel({ view }: { view: TransitionView }) {
  const rep = view.replenishment;
  const decisions = useDecisions(view.id);
  const [draft, setDraft] = useState("");

  if (view.lineage.successors.length === 0) {
    return (
      <p className="text-[13px] text-[var(--text-secondary)]">
        Discontinued without a successor — nothing is reordered. The task is selling through the{" "}
        {fmtNum(view.inventory.legacyOnHand)} legacy units still in the network.
      </p>
    );
  }
  if (!rep.available) {
    return <p className="text-[13px] text-[var(--text-muted)]">Add sales history to calculate a replenishment requirement.</p>;
  }

  const cost = rep.unitCost;
  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      <div>
        <CalcLines lines={replenishmentLines(rep)} />

        <div className="mt-5 grid grid-cols-3 divide-x divide-[var(--border)] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)]">
          <Compare label="Ignoring legacy stock" value={fmtNum(rep.ignoringLegacyUnits)} muted />
          <Compare label="Heizen recommends" value={fmtNum(rep.finalOrderUnits)} accent />
          <Compare
            label="Deferred or avoided"
            value={fmtNum(rep.avoidedUnits)}
            sub={cost !== undefined && rep.avoidedUnits > 0 ? `${fmtMoney(rep.avoidedUnits * cost, view.currency)} working capital` : undefined}
          />
        </div>
        {rep.jda?.plannedOrderUnits !== undefined ? (
          <p className="mt-2 text-[12px] text-[var(--text-muted)]">
            JDA currently plans to order {fmtNum(rep.jda.plannedOrderUnits)} units of this successor.
          </p>
        ) : null}

        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-4">
          <span className="mr-auto text-[13px] text-[var(--text-secondary)]">Your order quantity</span>
          <Input
            inputMode="numeric"
            value={draft}
            onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, ""))}
            placeholder={fmtNum(rep.finalOrderUnits)}
            className="w-[100px] text-right"
            aria-label="Order quantity override"
          />
          <Button
            size="sm"
            variant="outline"
            disabled={draft === ""}
            onClick={() => {
              decisions.override(
                { orderOverrideUnits: Number(draft) },
                `Order set to ${fmtNum(Number(draft))} units (recommended ${fmtNum(rep.recommendedUnits)})`
              );
              setDraft("");
            }}
          >
            Set
          </Button>
          {rep.orderOverrideUnits !== undefined ? (
            <button
              type="button"
              className="text-[12px] text-[var(--text-muted)] underline underline-offset-4 hover:text-[var(--text-primary)]"
              onClick={() => decisions.clear(["orderOverrideUnits"], "Order reset to Heizen's recommendation")}
            >
              Use recommendation
            </button>
          ) : null}
        </div>
      </div>

      <Projection view={view} />
    </div>
  );
}

function Compare({ label, value, sub, accent, muted }: { label: string; value: string; sub?: string; accent?: boolean; muted?: boolean }) {
  return (
    <div className="px-3 py-3">
      <div className="text-[11px] leading-tight text-[var(--text-muted)]">{label}</div>
      <div
        className={cn(
          "mt-1 text-[22px] font-semibold leading-none tabular-nums",
          accent ? "text-[var(--accent)]" : muted ? "text-[var(--text-muted)] line-through decoration-1" : "text-[var(--risk-positive)]"
        )}
      >
        {value}
      </div>
      {sub ? <div className="mt-1 text-[11px] text-[var(--text-muted)]">{sub}</div> : null}
    </div>
  );
}

/** Usable stock week by week with no new order, against safety stock. */
function Projection({ view }: { view: TransitionView }) {
  const rep = view.replenishment;
  const points = rep.projection;
  const axis = linearAxis(Math.max(rep.safetyStockUnits * 1.2, ...points.map((p) => p.usableUnits + p.receipts)), 4, true);
  const safetyPct = pctOfAxis(rep.safetyStockUnits, axis.max);
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[12px] font-medium text-[var(--text-secondary)]">Usable stock by week, before any new order</span>
        <span className="text-[11.5px] text-[var(--text-muted)]">
          {rep.neededByDate ? (
            <>
              Below safety stock {fmtDateShort(rep.neededByDate)}
              {rep.orderByDate ? (
                <span className={cn("ml-1 font-medium", rep.orderByDate <= view.planningNow ? "text-[var(--risk-critical)]" : "text-[var(--text-secondary)]")}>
                  · order by {rep.orderByDate <= view.planningNow ? "now" : fmtDateShort(rep.orderByDate)}
                </span>
              ) : null}
            </>
          ) : (
            "Stays above safety stock through the horizon"
          )}
        </span>
      </div>
      <div className="relative h-[170px] pl-9">
        {axis.ticks.map((t) => (
          <div key={t} className="absolute left-9 right-0 border-t border-[var(--chart-gridline-color)]" style={{ bottom: `${pctOfAxis(t, axis.max)}%` }}>
            <span className="absolute -left-9 -translate-y-1/2 text-[10.5px] tabular-nums text-[var(--chart-label-color)]">{fmtCompact(t)}</span>
          </div>
        ))}
        <div className="absolute left-9 right-0 z-10 border-t-2 border-dashed border-[var(--risk-warning)]" style={{ bottom: `${safetyPct}%` }}>
          <span className="absolute right-0 -translate-y-full pb-0.5 text-[10.5px] font-medium text-[var(--risk-warning)]">safety stock</span>
        </div>
        <div className="relative flex h-full items-end gap-[3px]">
          {points.map((p) => (
            <div
              key={p.week}
              className="flex h-full flex-1 flex-col justify-end"
              title={`Week of ${fmtDateShort(p.date)}: ${fmtNum(p.usableUnits)} usable${p.receipts ? `, +${fmtNum(p.receipts)} arriving` : ""}`}
            >
              {p.receipts > 0 ? (
                <div className="bg-[var(--lineage-inbound)]" style={{ height: `${pctOfAxis(p.receipts, axis.max)}%` }} />
              ) : null}
              <div
                className={cn(p.usableUnits < rep.safetyStockUnits ? "bg-[var(--risk-critical)]/70" : "bg-[var(--lineage-successor)]/80")}
                style={{ height: `${pctOfAxis(p.usableUnits, axis.max)}%` }}
              />
            </div>
          ))}
        </div>
      </div>
      <div className="mt-1 flex gap-[3px] pl-9">
        {points.map((p, i) => (
          <span key={p.week} className="flex-1 text-center text-[10px] text-[var(--chart-label-color)]">
            {i % 2 === 0 ? fmtDateShort(p.date).replace(/ \d\d$/, "") : ""}
          </span>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 text-[11.5px] text-[var(--text-muted)]">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-[2px] bg-[var(--lineage-successor)]/80" /> Usable stock (legacy + successor)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-[2px] bg-[var(--lineage-inbound)]" /> Receipt arriving
        </span>
      </div>
    </div>
  );
}
