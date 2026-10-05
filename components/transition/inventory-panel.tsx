"use client";

/**
 * Network inventory — what exists on both sides, and how much of it can
 * actually serve the same demand.
 *
 * The combined column is shown and deliberately not what supply is built on:
 * legacy stock is first discounted by substitutability. The planner owns that
 * percentage, and it is the most consequential number on this page.
 */

import type { TransitionView } from "@/types/transition";
import { inventoryTable } from "@/lib/transitions/explain";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils/cn";
import { fmtDateShort, fmtNum, fmtNum1, fmtPct } from "@/lib/utils/format";
import { useDecisions } from "./use-decisions";

const SUBST_OPTIONS = [1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.25, 0];

export function InventoryPanel({ view }: { view: TransitionView }) {
  const rows = inventoryTable(view);
  const inv = view.inventory;
  const decisions = useDecisions(view.id);
  const hasLegacy = view.lineage.predecessors.length > 0;
  const subst = inv.legacyBlocked ? 0 : inv.substitutabilityPct;
  const verdict =
    !hasLegacy ? null : subst >= 1 ? "Fully interchangeable" : subst >= 0.5 ? "Partially interchangeable" : subst > 0 ? "Mostly not interchangeable" : "Not interchangeable";

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
      <div>
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-[var(--border-strong)] text-[11px] uppercase tracking-[0.06em] text-[var(--text-muted)]">
              <th className="pb-2 text-left font-medium">Location</th>
              <th className="pb-2 text-right font-medium text-[var(--lineage-legacy)]">Legacy</th>
              <th className="pb-2 text-right font-medium text-[var(--lineage-successor)]">Successor</th>
              <th className="pb-2 text-right font-medium">Combined</th>
              <th className="pb-2 text-right font-medium text-[var(--accent)]">Usable</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const total = r.location === "Total";
              return (
                <tr key={r.location} className={cn("border-b border-[var(--border)]", total && "border-b-0 border-t-2 border-t-[var(--border-strong)] font-semibold")}>
                  <td className="py-2 pr-3 text-[var(--text-secondary)]">
                    {r.location}
                    {r.note ? <div className="text-[11px] font-normal text-[var(--text-muted)]">{r.note}</div> : null}
                  </td>
                  <td className="py-2 text-right tabular-nums">{fmtNum(r.legacy)}</td>
                  <td className="py-2 text-right tabular-nums">{fmtNum(r.successor)}</td>
                  <td className="py-2 text-right tabular-nums text-[var(--text-muted)]">{fmtNum(r.combined)}</td>
                  <td className={cn("py-2 text-right tabular-nums", total ? "text-[15px] text-[var(--accent)]" : "text-[var(--text-primary)]")}>
                    {fmtNum(r.usable)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-2 text-[12px] leading-snug text-[var(--text-muted)]">
          Usable = legacy × substitutability + successor. Combined is shown for reference only — it is not what the plan uses
          against.
          {inv.networkWeeksOfCover !== null ? ` On-hand usable stock covers ${fmtNum1(inv.networkWeeksOfCover)} weeks of demand.` : ""}
        </p>

        {inv.receipts.length > 0 ? (
          <div className="mt-5">
            <div className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-muted)]">Inbound supply</div>
            <ul className="divide-y divide-[var(--border)] border-y border-[var(--border)]">
              {inv.receipts.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 py-2 text-[13px]">
                  <span className="min-w-0 truncate text-[var(--text-secondary)]">
                    <span className="font-mono text-[12px] text-[var(--text-primary)]">{r.purchaseOrderId ?? "Receipt"}</span> · {r.skuId}
                    {r.source ? ` · ${r.source}` : ""}
                  </span>
                  <span className="flex flex-none items-center gap-3 tabular-nums">
                    <span className="font-medium">{fmtNum(r.quantity)}</span>
                    <span className={cn("w-[120px] text-right", r.eligible ? "text-[var(--text-secondary)]" : "text-[var(--text-muted)]")}>
                      {fmtDateShort(r.expectedDate)}
                      {r.expectedDate !== r.plannedDate ? <span className="text-[var(--state-scenario)]"> (moved)</span> : null}
                    </span>
                    <span className={cn("w-[96px] text-right text-[11.5px]", r.eligible ? "text-[var(--risk-positive)]" : "text-[var(--text-muted)]")}>
                      {r.eligible ? "In horizon" : "After horizon"}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="mt-5 text-[12.5px] text-[var(--text-muted)]">No inbound supply on order for these SKUs.</p>
        )}
      </div>

      {hasLegacy ? (
        <aside className="space-y-4 border-t border-[var(--border)] pt-5 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
          <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-muted)]">Can legacy stock serve successor demand?</div>
          <dl className="space-y-2 text-[13px]">
            <Row label="Legacy still sellable" value={inv.legacyBlocked ? "No — blocked" : "Yes"} tone={inv.legacyBlocked ? "critical" : "positive"} />
            <Row label="Satisfies successor demand" value={verdict ?? "—"} tone={subst >= 1 ? "positive" : subst > 0 ? "warning" : "critical"} />
          </dl>
          <div className="flex items-center justify-between gap-3 border-t border-[var(--border)] pt-3">
            <span className="text-[13px] text-[var(--text-secondary)]">Substitutability</span>
            <Select
              value={String(view.assumptions.substitutabilityPct)}
              disabled={inv.legacyBlocked}
              onValueChange={(v) =>
                decisions.override({ substitutabilityPct: Number(v) }, `Legacy substitutability set to ${fmtPct(Number(v))}`)
              }
            >
              <SelectTrigger className="w-[92px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[...new Set([view.assumptions.substitutabilityPct, ...SUBST_OPTIONS])]
                  .sort((a, b) => b - a)
                  .map((o) => (
                    <SelectItem key={o} value={String(o)}>
                      {fmtPct(o)}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <p className="text-[12.5px] leading-snug text-[var(--text-secondary)]">
            {fmtNum(inv.legacyOnHand)} legacy units × {fmtPct(subst)} ={" "}
            <span className="font-semibold text-[var(--text-primary)]">{fmtNum(inv.usableLegacy)} usable</span>.{" "}
            {subst < 1 && subst > 0 ? "Some sizes or variants no longer map directly to the successor." : null}
            {subst >= 1 ? "A rebrand of the same garment: every legacy unit can meet successor demand." : null}
          </p>
        </aside>
      ) : null}
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone: "positive" | "warning" | "critical" }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[var(--text-secondary)]">{label}</dt>
      <dd
        className={cn(
          "font-medium",
          tone === "positive" && "text-[var(--risk-positive)]",
          tone === "warning" && "text-[var(--risk-warning)]",
          tone === "critical" && "text-[var(--risk-critical)]"
        )}
      >
        {value}
      </dd>
    </div>
  );
}
