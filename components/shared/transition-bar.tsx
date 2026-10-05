/**
 * The transition's signature visuals.
 *
 * `LineageChain` says in one glance that several SKU records are one product:
 * legacy on the left in tan, successor on the right in navy, joined by an
 * arrow. `TransitionBar` says how far the demand has moved across. Both use
 * the lineage palette only — never a risk colour, which belongs to status.
 */

import { ArrowRight } from "lucide-react";
import type { SkuRow } from "@/types/dataset";
import { cn } from "@/lib/utils/cn";
import { fmtPct } from "@/lib/utils/format";

export function SkuChip({ sku, role, className }: { sku: Pick<SkuRow, "skuId">; role: "legacy" | "successor"; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-[var(--radius-sm)] px-1.5 py-0.5 font-mono text-[11.5px] font-medium leading-none",
        role === "legacy"
          ? "bg-[var(--lineage-legacy-soft)] text-[var(--lineage-legacy)]"
          : "bg-[var(--lineage-successor-soft)] text-[var(--lineage-successor)]",
        className
      )}
    >
      {sku.skuId}
    </span>
  );
}

export function LineageChain({
  predecessors,
  successors,
  size = "sm",
}: {
  predecessors: readonly Pick<SkuRow, "skuId">[];
  successors: readonly Pick<SkuRow, "skuId">[];
  size?: "sm" | "md";
}) {
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1", size === "md" && "gap-1.5")}>
      {predecessors.length === 0 ? (
        <span className="text-[11.5px] text-[var(--text-muted)]">New product</span>
      ) : (
        predecessors.map((s, i) => (
          <span key={s.skuId} className="inline-flex items-center gap-1">
            {i > 0 ? <span className="text-[11px] text-[var(--text-muted)]">+</span> : null}
            <SkuChip sku={s} role="legacy" />
          </span>
        ))
      )}
      <ArrowRight className={cn("flex-none text-[var(--text-muted)]", size === "md" ? "size-3.5" : "size-3")} />
      {successors.length === 0 ? (
        <span className="text-[11.5px] text-[var(--text-muted)]">No successor</span>
      ) : (
        successors.map((s, i) => (
          <span key={s.skuId} className="inline-flex items-center gap-1">
            {i > 0 ? <span className="text-[11px] text-[var(--text-muted)]">+</span> : null}
            <SkuChip sku={s} role="successor" />
          </span>
        ))
      )}
    </span>
  );
}

/**
 * Legacy-to-successor progress: the successor's share of recent sales. The
 * filled part is successor (navy), the rest legacy (tan) — read left to right
 * the way the transition runs.
 */
export function TransitionBar({
  progress,
  className,
  showLabel = true,
  height = 6,
}: {
  progress: number;
  className?: string;
  showLabel?: boolean;
  height?: number;
}) {
  const pct = Math.max(0, Math.min(1, progress));
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div
        className="relative flex-1 overflow-hidden rounded-full bg-[var(--lineage-legacy-soft)]"
        style={{ height }}
        role="meter"
        aria-valuenow={Math.round(pct * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Share of recent sales on the successor"
      >
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-[var(--lineage-successor)] transition-[width]"
          style={{ width: `${pct * 100}%`, transitionDuration: "var(--duration-slow)" }}
        />
      </div>
      {showLabel ? (
        <span className="w-9 flex-none text-right text-[12px] font-medium tabular-nums text-[var(--text-secondary)]">
          {fmtPct(pct)}
        </span>
      ) : null}
    </div>
  );
}

/** A two-part stacked bar: legacy | successor (| inbound), for unit splits. */
export function SplitBar({
  legacy,
  successor,
  inbound = 0,
  max,
  height = 8,
  className,
}: {
  legacy: number;
  successor: number;
  inbound?: number;
  /** Scale to share across rows; defaults to this row's own total. */
  max?: number;
  height?: number;
  className?: string;
}) {
  const total = Math.max(1, max ?? legacy + successor + inbound);
  const w = (n: number) => `${(Math.max(0, n) / total) * 100}%`;
  return (
    <div className={cn("flex overflow-hidden rounded-[2px] bg-[var(--chart-track)]", className)} style={{ height }}>
      <div className="bg-[var(--lineage-legacy)]" style={{ width: w(legacy) }} />
      <div className="bg-[var(--lineage-successor)]" style={{ width: w(successor) }} />
      {inbound > 0 ? (
        <div
          className="bg-[var(--lineage-inbound)]"
          style={{
            width: w(inbound),
            backgroundImage:
              "repeating-linear-gradient(135deg, transparent 0 3px, color-mix(in oklch, var(--surface) 45%, transparent) 3px 5px)",
          }}
        />
      ) : null}
    </div>
  );
}

export function LineageLegend({ inbound = false, className }: { inbound?: boolean; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-[var(--text-muted)]", className)}>
      <span className="inline-flex items-center gap-1.5">
        <span className="size-2 rounded-[2px] bg-[var(--lineage-legacy)]" /> Legacy SKU
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="size-2 rounded-[2px] bg-[var(--lineage-successor)]" /> Successor SKU
      </span>
      {inbound ? (
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-[2px] bg-[var(--lineage-inbound)]" /> Inbound
        </span>
      ) : null}
    </div>
  );
}
