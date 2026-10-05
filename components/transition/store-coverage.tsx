"use client";

/**
 * Store coverage — where network inventory is not where demand is.
 *
 * The network total can look healthy while individual stores run dry. This
 * shows which stores stock out before the next successor shipment reaches
 * them, which hold more than they will sell, and the moves that fix one with
 * the other before anything new is bought.
 */

import { useMemo, useState } from "react";
import { ArrowRight } from "lucide-react";
import type { StoreCoverageRow, StoreRecommendation, StoreStockState, TransitionView } from "@/types/transition";
import { DataTable, type Column } from "@/components/shared/data-table";
import { StoreStateBadge } from "@/components/shared/state-badge";
import { cn } from "@/lib/utils/cn";
import { DEFAULT_THRESHOLDS } from "@/lib/transitions/assumptions";
import { fmtDateShort, fmtNum, fmtNum1 } from "@/lib/utils/format";

type View = "risk" | "excess" | "all";

const REC: Record<StoreRecommendation, { label: string; className: string }> = {
  EXPEDITE: { label: "Expedite", className: "text-[var(--risk-critical)]" },
  TRANSFER_IN: { label: "Transfer in", className: "text-[var(--accent)]" },
  REPLENISH: { label: "Replenish", className: "text-[var(--accent)]" },
  TRANSFER_OUT: { label: "Transfer out", className: "text-[var(--lineage-legacy)]" },
  HOLD: { label: "Hold", className: "text-[var(--text-secondary)]" },
  OK: { label: "—", className: "text-[var(--text-muted)]" },
};

const STATE_ORDER: { state: StoreStockState; label: string; color: string }[] = [
  { state: "NEW_ONLY", label: "Fully transitioned", color: "bg-[var(--lineage-successor)]" },
  { state: "MIXED", label: "Selling both", color: "bg-[color-mix(in_oklch,var(--lineage-successor)_45%,var(--lineage-legacy))]" },
  { state: "LEGACY_ONLY", label: "Legacy only", color: "bg-[var(--lineage-legacy)]" },
  { state: "NO_STOCK", label: "No stock", color: "bg-[var(--risk-critical)]" },
];

export function StoreCoverage({ view }: { view: TransitionView }) {
  const c = view.coverage;
  const [mode, setMode] = useState<View>(c.atRiskCount > 0 ? "risk" : "all");
  const storeName = useMemo(() => new Map(c.rows.map((r) => [r.store.storeId, r.store.storeName])), [c.rows]);
  const rows = useMemo(
    () =>
      mode === "risk"
        ? c.rows.filter((r) => r.atRisk)
        : mode === "excess"
          ? c.rows.filter((r) => r.recommendation === "TRANSFER_OUT" || r.recommendation === "HOLD")
          : c.rows,
    [c.rows, mode]
  );

  if (!c.available) {
    return <p className="text-[13px] text-[var(--text-muted)]">{c.unavailableReason}</p>;
  }

  const columns: Column<StoreCoverageRow>[] = [
    {
      key: "store",
      header: "Store",
      sortValue: (r) => r.store.storeName,
      render: (r) => (
        <div>
          <div className="font-medium text-[var(--text-primary)]">{r.store.storeName}</div>
          <div className="text-[11px] text-[var(--text-muted)]">
            {r.store.region}
            {r.onSuccessorProfile === false ? " · not in successor profile" : ""}
          </div>
        </div>
      ),
    },
    { key: "state", header: "State", sortValue: (r) => r.stockState, render: (r) => <StoreStateBadge state={r.stockState} /> },
    { key: "legacy", header: "Legacy", numeric: true, sortValue: (r) => r.legacyUnits, render: (r) => <span className="text-[var(--lineage-legacy)]">{fmtNum(r.legacyUnits)}</span> },
    { key: "new", header: "New", numeric: true, sortValue: (r) => r.successorUnits, render: (r) => <span className="text-[var(--lineage-successor)]">{fmtNum(r.successorUnits)}</span> },
    { key: "usable", header: "Usable", numeric: true, sortValue: (r) => r.usableUnits, render: (r) => fmtNum(r.usableUnits) },
    { key: "weekly", header: "Weekly sales", numeric: true, sortValue: (r) => r.weeklyDemand, render: (r) => (r.weeklyDemand > 0 ? fmtNum1(r.weeklyDemand) : <Muted>none</Muted>) },
    {
      key: "cover",
      header: "Wks cover",
      numeric: true,
      sortValue: (r) => r.weeksOfCover ?? 999,
      render: (r) =>
        r.weeksOfCover === null ? (
          <Muted>—</Muted>
        ) : (
          <span className={cn(r.atRisk && "font-semibold text-[var(--risk-critical)]")}>{fmtNum1(r.weeksOfCover)}</span>
        ),
    },
    {
      key: "stockout",
      header: "Runs out",
      sortValue: (r) => r.stockoutDate ?? "9999",
      render: (r) =>
        r.atRisk && r.stockoutDate ? (
          <span className="text-[var(--risk-critical)]">
            {fmtDateShort(r.stockoutDate)}
            <span className="ml-1 text-[11px] text-[var(--text-muted)]">{r.stockoutDays}d gap</span>
          </span>
        ) : (
          <Muted>—</Muted>
        ),
    },
    {
      key: "plan",
      header: "Recommendation",
      sortValue: (r) => r.recommendation,
      render: (r) => {
        const rec = REC[r.recommendation];
        const qty = r.transferIn || r.replenishFromDc || r.transferOut;
        return (
          <span className={cn("font-medium", rec.className)}>
            {rec.label}
            {qty > 0 ? <span className="ml-1 tabular-nums">{fmtNum(qty)}</span> : null}
            {r.weeksOfCoverAfterPlan !== null && (r.transferIn || r.replenishFromDc) ? (
              <span className="ml-1.5 text-[11px] font-normal text-[var(--text-muted)]">→ {fmtNum1(r.weeksOfCoverAfterPlan)} wks</span>
            ) : null}
          </span>
        );
      },
    },
  ];

  return (
    <div>
      {/* Summary band */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div>
          <div className="flex items-baseline justify-between">
            <span className="text-[13px] text-[var(--text-secondary)]">
              <span className="text-[20px] font-semibold tabular-nums text-[var(--text-primary)]">{c.storeCount}</span> stores carry this product
            </span>
          </div>
          <div className="mt-2 flex h-3 overflow-hidden rounded-[2px]">
            {STATE_ORDER.map((s) => (
              <div key={s.state} className={s.color} style={{ width: `${(c.stateCounts[s.state] / Math.max(1, c.storeCount)) * 100}%` }} />
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-[var(--text-secondary)]">
            {STATE_ORDER.filter((s) => c.stateCounts[s.state] > 0).map((s) => (
              <span key={s.state} className="inline-flex items-center gap-1.5">
                <span className={cn("size-2 rounded-[2px]", s.color)} />
                <span className="tabular-nums font-medium text-[var(--text-primary)]">{c.stateCounts[s.state]}</span> {s.label.toLowerCase()}
              </span>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <Figure value={c.atRiskCount} label="projected stockouts" tone={c.atRiskCount > 0 ? "critical" : "positive"} />
          <Figure value={c.atRiskAfterPlanCount} label="still at risk after plan" tone={c.atRiskAfterPlanCount > 0 ? "critical" : "positive"} />
          <Figure value={c.excessCount} label="hold excess cover" tone="neutral" />
        </div>
      </div>

      <p className="mt-4 text-[12.5px] leading-snug text-[var(--text-secondary)]">
        {c.resupplyWeeks !== null
          ? `The next successor shipment can reach stores in ${fmtNum1(c.resupplyWeeks)} weeks; a store with less cover than that runs out first.`
          : "No successor shipment is on order; stores are measured against the full horizon."}
        {c.atRiskOffProfile > 0
          ? ` ${c.atRiskOffProfile} of the at-risk stores aren't in ${view.lineage.successors[0]?.skuId ?? "the successor"}'s selling profile, so JDA won't replenish them on its own.`
          : ""}
      </p>

      {/* Transfers before purchases */}
      {c.transfers.length > 0 ? (
        <div className="mt-5">
          <div className="mb-1.5 flex items-baseline justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-secondary)]">
              Recommended transfers · {fmtNum(c.transferUnits)} units
            </span>
            <span className="text-[11.5px] text-[var(--text-muted)]">Donors keep at least {DEFAULT_THRESHOLDS.donorFloorWeeks} weeks of cover</span>
          </div>
          <ul className="divide-y divide-[var(--border)] border-y border-[var(--border)]">
            {c.transfers.slice(0, 8).map((t) => (
              <li key={t.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-4 py-2.5 text-[13px] sm:grid-cols-[110px_minmax(0,1fr)_minmax(0,1fr)_auto]">
                <span className="font-medium tabular-nums text-[var(--text-primary)]">
                  {fmtNum(t.units)} × <span className={cn("font-mono text-[12px]", t.skuRole === "legacy" ? "text-[var(--lineage-legacy)]" : "text-[var(--lineage-successor)]")}>{t.skuId}</span>
                </span>
                <span className="flex min-w-0 items-center gap-2 text-[var(--text-secondary)] sm:col-span-2">
                  <span className="truncate">
                    {storeName.get(t.fromStoreId)} <span className="text-[11.5px] text-[var(--text-muted)]">{fmtNum1(t.fromCoverBefore)} wks</span>
                  </span>
                  <ArrowRight className="size-3 flex-none text-[var(--text-muted)]" />
                  <span className="truncate">
                    {storeName.get(t.toStoreId)} <span className="text-[11.5px] text-[var(--risk-critical)]">{fmtNum1(t.toCoverBefore)} wks</span>
                  </span>
                </span>
                <span className="text-right text-[12px] text-[var(--text-muted)]">
                  {t.avoidedStockoutDays > 0 ? `avoids ${t.avoidedStockoutDays}-day stockout` : "tops up cover"}
                  {t.sameRegion ? "" : " · cross-region"}
                </span>
              </li>
            ))}
          </ul>
          {c.transfers.length > 8 ? (
            <p className="mt-1.5 text-[12px] text-[var(--text-muted)]">and {c.transfers.length - 8} more in the store table below.</p>
          ) : null}
        </div>
      ) : null}

      {/* Store table */}
      <div className="mb-2 mt-6 flex items-center gap-1">
        {(
          [
            ["risk", `At risk · ${c.atRiskCount}`],
            ["excess", "Excess & donors"],
            ["all", `All ${c.storeCount}`],
          ] as [View, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setMode(key)}
            className={cn(
              "rounded-full border px-3 py-1 text-[12px] transition-colors",
              mode === key
                ? "border-[var(--interaction-selected-border)] bg-[var(--interaction-selected)] font-medium text-[var(--text-primary)]"
                : "border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--interaction-hover)]"
            )}
            style={{ transitionDuration: "var(--duration-fast)" }}
          >
            {label}
          </button>
        ))}
      </div>
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.store.storeId}
        maxHeight={420}
        minWidth={940}
        rowClassName={(r) => (r.atRisk ? "bg-[var(--risk-critical-soft)]/40" : undefined)}
        empty={mode === "risk" ? "No store runs out before the next shipment reaches it." : "No stores in this view."}
        card={(r) => (
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-medium">{r.store.storeName}</div>
              <div className="text-[12px] text-[var(--text-muted)]">
                {fmtNum(r.legacyUnits)} legacy · {fmtNum(r.successorUnits)} new · {r.weeksOfCover === null ? "no sales" : `${fmtNum1(r.weeksOfCover)} wks`}
              </div>
            </div>
            <span className={cn("text-[12px] font-medium", REC[r.recommendation].className)}>{REC[r.recommendation].label}</span>
          </div>
        )}
      />
    </div>
  );
}

function Figure({ value, label, tone }: { value: number; label: string; tone: "critical" | "positive" | "neutral" }) {
  return (
    <div>
      <div
        className={cn(
          "text-[24px] font-semibold leading-none tabular-nums",
          tone === "critical" ? "text-[var(--risk-critical)]" : tone === "positive" ? "text-[var(--risk-positive)]" : "text-[var(--text-primary)]"
        )}
      >
        {value}
      </div>
      <div className="mt-1 text-[11.5px] leading-snug text-[var(--text-muted)]">{label}</div>
    </div>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <span className="text-[var(--text-muted)]">{children}</span>;
}
