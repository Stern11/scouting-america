/**
 * The sales mix between a product's old and new SKU.
 *
 * Two segments of one bar: the legacy SKU's share of recent sales in khaki,
 * the new SKU's in navy, each labelled above its own end. Deliberately no
 * knob or dashed track — it is a reading, not a control.
 */

import type { SkuRow } from "@/types/dataset";
import { cn } from "@/lib/utils/cn";
import { fmtPct } from "@/lib/utils/format";

export function Trail({
  from,
  to,
  progress,
  labels,
  className,
}: {
  from: readonly Pick<SkuRow, "skuId">[];
  to: readonly Pick<SkuRow, "skuId">[];
  progress: number;
  /** Plain words for each side, e.g. "Old logo" / "Scouting America". SKU codes show on hover. */
  labels?: { old: string; new: string };
  className?: string;
}) {
  const share = Math.max(0, Math.min(1, progress));
  const fromCodes = from.map((s) => s.skuId).join(" + ");
  const toCodes = to.map((s) => s.skuId).join(" + ");
  const fromLabel = from.length ? (labels?.old ?? fromCodes) : "No legacy SKU";
  const toLabel = to.length ? (labels?.new ?? toCodes) : "No replacement";
  // A discontinuation has no new SKU: the bar shows legacy sold vs. left.
  const retiring = to.length === 0;
  const caption = retiring ? "Legacy stock sold through" : from.length === 0 ? "New product" : "Share of recent sales";

  return (
    <div className={cn("w-full", className)}>
      <div className="flex items-end justify-between gap-3 text-[11.5px]">
        <span className="min-w-0 truncate">
          <span className={cn("font-semibold text-[var(--lineage-legacy)]", !labels && "font-mono")} title={fromCodes}>
            {fromLabel}
          </span>
          <span className="ml-1.5 tabular-nums text-[var(--text-muted)]">
            {fmtPct(1 - share)}
            {retiring ? " left" : ""}
          </span>
        </span>
        <span className="min-w-0 truncate text-right">
          {retiring ? (
            <span className="tabular-nums text-[var(--text-muted)]">{fmtPct(share)} sold · no replacement</span>
          ) : (
            <>
              <span className="tabular-nums text-[var(--text-muted)]">{fmtPct(share)}</span>
              <span className={cn("ml-1.5 font-semibold text-[var(--lineage-successor)]", !labels && "font-mono")} title={toCodes}>
                {toLabel}
              </span>
            </>
          )}
        </span>
      </div>
      <div className="mt-1.5 flex h-2 gap-[3px]" aria-label={`${caption}: ${fmtPct(share)}`}>
        <div
          className="rounded-full bg-[var(--lineage-legacy)] transition-[width]"
          style={{ width: `${(1 - share) * 100}%`, transitionDuration: "var(--duration-slow)" }}
        />
        <div
          className={cn("rounded-full transition-[width]", retiring ? "bg-[var(--state-unknown)]" : "bg-[var(--lineage-successor)]")}
          style={{ width: `${share * 100}%`, transitionDuration: "var(--duration-slow)" }}
        />
      </div>
      <div className="mt-1 text-[11px] text-[var(--text-muted)]">{caption}</div>
    </div>
  );
}
