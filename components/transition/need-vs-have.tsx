/**
 * The whole transition in one picture: what you need against what you have.
 *
 * The top bar is the need — expected sales over the order horizon plus safety
 * stock. The bottom bar is what can meet it: old-logo stock (which JDA no
 * longer counts), new stock on hand, and new stock already on order. Where
 * the "have" bar falls short, the gap is the order. Toggle the old-logo stock
 * off and the gap grows to what an item-by-item plan would buy.
 */

"use client";

import { useState } from "react";
import type { TransitionView } from "@/types/transition";
import { productNoun, versionLabels } from "@/lib/transitions/names";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils/cn";
import { fmtDateShort, fmtNum } from "@/lib/utils/format";

export function NeedVsHave({ view }: { view: TransitionView }) {
  const { replenishment: rep, inventory: inv, demand, lineage } = view;
  const [countOld, setCountOld] = useState(true);
  const labels = versionLabels(lineage.reason, lineage.successors, lineage.predecessors);
  const nouns = productNoun(view.name);

  if (lineage.successors.length === 0) {
    return (
      <p className="text-[14px] text-[var(--text-secondary)]">
        No replacement is coming — the job is selling the {fmtNum(inv.legacyOnHand)} {labels.oldAdjective} {nouns} still in the
        shops.
      </p>
    );
  }

  const nextReceipt = inv.receipts.find((r) => r.eligible && lineage.successors.some((x) => x.skuId === r.skuId));
  const old = countOld ? rep.usableLegacy : 0;
  const have = old + rep.successorOnHand + rep.eligibleInbound;
  const gap = countOld ? rep.recommendedUnits : rep.ignoringLegacyUnits;
  const scale = Math.max(rep.requirement, have + gap, 1);
  const w = (n: number) => `${(Math.max(0, n) / scale) * 100}%`;

  return (
    <div className="rounded-[18px] border border-[var(--border)] bg-[var(--surface)] p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-[16px] font-semibold text-[var(--text-primary)]">
            What you need vs. what you have · next {rep.horizonWeeks} weeks
          </h3>
          <p className="mt-0.5 text-[12.5px] text-[var(--text-muted)]">
            {labels.old} and {labels.new} {nouns} are counted as one product.
          </p>
        </div>
        <label className="flex cursor-pointer select-none items-center gap-2 text-[12.5px] text-[var(--text-secondary)]">
          <span>Count {labels.oldAdjective} stock</span>
          <button
            type="button"
            role="switch"
            aria-checked={countOld}
            onClick={() => setCountOld((v) => !v)}
            className={cn(
              "relative h-5 w-9 rounded-full transition-colors",
              countOld ? "bg-[var(--accent)]" : "bg-[var(--border-strong)]"
            )}
          >
            <span
              className={cn(
                "absolute top-0.5 size-4 rounded-full bg-[var(--surface)] shadow transition-[left]",
                countOld ? "left-[18px]" : "left-0.5"
              )}
            />
          </button>
        </label>
      </div>

      {/* Need */}
      <div className="mt-5">
        <div className="mb-1.5 flex justify-between text-[12.5px]">
          <span className="font-medium text-[var(--text-primary)]">You need</span>
          <span className="tabular-nums text-[var(--text-secondary)]">{fmtNum(rep.requirement)}</span>
        </div>
        <div className="flex h-9 overflow-hidden rounded-[8px]">
          <Segment width={w(rep.horizonDemand)} className="bg-[var(--text-primary)]/80 text-[var(--text-on-accent)]" label={`${fmtNum(rep.horizonDemand)} expected sales`}
            tip={{ title: `${fmtNum(rep.horizonDemand)} ${nouns} expected to sell`, body: `Next ${rep.horizonWeeks} weeks at about ${fmtNum(demand.weeklyUnits)} a week — old-logo and new sales counted as one product, adjusted for the season.` }}
          />
          <Segment width={w(rep.safetyStockUnits)} className="bg-[var(--text-primary)]/35 text-[var(--text-on-accent)]" label={`${fmtNum(rep.safetyStockUnits)} safety`}
            tip={{ title: `${fmtNum(rep.safetyStockUnits)} safety stock`, body: `${rep.safetyStockWeeks} weeks of sales kept in reserve so a busy week does not empty the shelves.` }}
          />
        </div>
        <p className="mt-1 text-[11.5px] text-[var(--text-muted)]">
          {fmtNum(demand.weeklyUnits)} a week — built from {fmtNum(demand.legacyUnitsL52)} {labels.oldAdjective} and{" "}
          {fmtNum(demand.successorUnitsL52)} new {nouns} sold in the last year.
        </p>
      </div>

      {/* Have */}
      <div className="mt-4">
        <div className="mb-1.5 flex justify-between text-[12.5px]">
          <span className="font-medium text-[var(--text-primary)]">You have</span>
          <span className="tabular-nums text-[var(--text-secondary)]">{fmtNum(have)}</span>
        </div>
        <div className="flex h-9 overflow-hidden rounded-[8px] bg-[var(--chart-track)]">
          <Segment width={w(old)} className="bg-[var(--lineage-legacy)] text-[var(--text-on-accent)]" label={`${fmtNum(old)} ${labels.old.toLowerCase()}`}
            tip={{ title: `${fmtNum(old)} ${labels.oldAdjective} ${nouns} you can still sell`, body: `Sitting in Scout Shops and the DC. JDA no longer plans with them — they are counted toward new demand (${Math.round(inv.substitutabilityPct * 100)}% usable).` }}
          />
          <Segment width={w(rep.successorOnHand)} className="bg-[var(--lineage-successor)] text-[var(--text-on-accent)]" label={`${fmtNum(rep.successorOnHand)} new`}
            tip={{ title: `${fmtNum(rep.successorOnHand)} ${labels.new} ${nouns} on hand`, body: `${fmtNum(inv.stores.successor)} in Scout Shops and ${fmtNum(inv.dc.successor)} at the DC, ready to sell.` }}
          />
          <Segment width={w(rep.eligibleInbound)} className="bg-[var(--lineage-inbound)] text-[var(--text-on-accent)]" label={`${fmtNum(rep.eligibleInbound)} arriving`}
            tip={{ title: `${fmtNum(rep.eligibleInbound)} already on order`, body: nextReceipt ? `Next delivery ${fmtDateShort(nextReceipt.expectedDate)}${nextReceipt.purchaseOrderId ? ` (${nextReceipt.purchaseOrderId})` : ""}. Only deliveries landing in the next ${rep.horizonWeeks} weeks count.` : `Deliveries landing in the next ${rep.horizonWeeks} weeks.` }}
          />
          {gap > 0 ? (
            <Segment
              width={w(gap)}
              className="border-2 border-dashed border-[var(--risk-critical)] bg-[var(--risk-critical-soft)] text-[var(--risk-critical)]"
              tip={{
                title: `${fmtNum(gap)} still to order`,
                body: countOld
                  ? `The gap between what you need and what you have. Without counting old-logo stock it would be ${fmtNum(rep.ignoringLegacyUnits)}.`
                  : `This is what an SKU-by-SKU plan orders. Turn old-logo stock back on to see the recommended ${fmtNum(rep.recommendedUnits)}.`,
              }}
              label={`order ${fmtNum(gap)}`}
            />
          ) : null}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-[var(--text-muted)]">
          <Key className="bg-[var(--lineage-legacy)]" text={`${labels.old} in shops`} />
          <Key className="bg-[var(--lineage-successor)]" text={`${labels.new} on hand`} />
          <Key className="bg-[var(--lineage-inbound)]" text="Already on order" />
          <Key className="border border-dashed border-[var(--risk-critical)] bg-[var(--risk-critical-soft)]" text="Still to order" />
        </div>
      </div>

      {/* The answer */}
      <div className="mt-5 grid grid-cols-1 gap-3 border-t border-[var(--border)] pt-4 sm:grid-cols-3">
        <Answer
          label="Recommended order"
          value={fmtNum(rep.finalOrderUnits)}
          tone="accent"
          sub={rep.avoidedUnits > 0 ? `${fmtNum(rep.avoidedUnits)} fewer — the old-logo stock covers them` : "Old-logo stock doesn't change this"}
        />
        <Answer label="Ignoring old-logo stock" value={fmtNum(rep.ignoringLegacyUnits)} tone="muted" sub="what an SKU-by-SKU plan needs" />
        <Answer
          label="JDA plans to order"
          value={rep.jda?.plannedOrderUnits !== undefined ? fmtNum(rep.jda.plannedOrderUnits) : "—"}
          tone="muted"
          sub={rep.jda?.plannedOrderUnits !== undefined ? `treats ${lineage.successors.map((s) => s.skuId).join(" + ")} as brand new` : "Add Current_Plan to compare"}
        />
      </div>
    </div>
  );
}

function Segment({
  width,
  className,
  label,
  tip,
}: {
  width: string;
  className: string;
  label: string;
  tip: { title: string; body: string };
}) {
  return (
    <Tooltip delayDuration={80}>
      <TooltipTrigger asChild>
        <div
          tabIndex={0}
          className={cn(
            "flex min-w-0 cursor-default items-center overflow-hidden px-2 text-[11.5px] font-medium outline-none transition-[width,filter] hover:brightness-110 focus-visible:brightness-110",
            className
          )}
          style={{ width, transitionDuration: "var(--duration-slow)" }}
        >
          <span className="truncate">{label}</span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[280px] px-3 py-2">
        <div className="text-[12.5px] font-semibold text-[var(--text-primary)]">{tip.title}</div>
        <div className="mt-0.5 text-[12px] leading-snug text-[var(--text-secondary)]">{tip.body}</div>
      </TooltipContent>
    </Tooltip>
  );
}

function Key({ className, text }: { className: string; text: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("size-2.5 rounded-[3px]", className)} />
      {text}
    </span>
  );
}

function Answer({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: "accent" | "muted" }) {
  return (
    <div>
      <div className="text-[11.5px] font-medium uppercase tracking-[0.07em] text-[var(--text-muted)]">{label}</div>
      <div
        className={cn(
          "mt-1 text-[28px] font-semibold leading-none tabular-nums",
          tone === "accent" ? "text-[var(--accent)]" : "text-[var(--text-muted)]"
        )}
      >
        {value}
      </div>
      <div className="mt-1 text-[12px] text-[var(--text-secondary)]">{sub}</div>
    </div>
  );
}
