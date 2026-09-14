"use client";

/**
 * Every supplier of one material, on the record procurement awards an order
 * on: lead time and its spread, on-time-in-full, and whether an order placed
 * now still lands before production.
 *
 * One component for both places a planner meets suppliers — the material
 * drawer (read) and the release dialog (choose) — reading one derivation
 * (`lib/situations/suppliers.ts`), so the two cannot disagree.
 */

import { DataTable, type Column } from "@/components/shared/data-table";
import {
  MIN_RECORD,
  type SupplierComparison,
  type SupplierPerformance,
} from "@/lib/situations/suppliers";
import { deadlineTone, weeksLeftLabel } from "@/lib/situations/deadline";
import { cn } from "@/lib/utils/cn";
import { fmtDateShort, fmtPct } from "@/lib/utils/format";

const TONE_TEXT = {
  critical: "text-[var(--risk-critical)]",
  warning: "text-[var(--risk-warning)]",
  positive: "text-[var(--risk-positive)]",
  muted: "text-[var(--text-muted)]",
} as const;

export function SupplierTable({
  comparison,
  selectedId,
  onSelect,
  layout = "table",
}: {
  comparison: SupplierComparison;
  /** Given with `onSelect`, rows become a single choice. */
  selectedId?: string;
  onSelect?: (supplier: SupplierPerformance) => void;
  /**
   * `list` stacks each supplier as a card at every width — for narrow homes
   * like the material drawer, where a four-column table can only scroll
   * sideways.
   */
  layout?: "table" | "list";
}) {
  const recommendedId = comparison.recommended?.supplierId;
  const selectable = onSelect !== undefined;

  const columns: Column<SupplierPerformance>[] = [
    {
      key: "supplier",
      header: "Supplier",
      render: (s) => (
        <div className="flex min-w-0 items-start gap-2.5">
          {selectable ? <Radio checked={s.supplierId === selectedId} /> : null}
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate font-medium text-[var(--text-primary)]">{s.supplierName}</span>
              {s.supplierId === recommendedId ? <RecommendedTag /> : null}
            </div>
            <div className="truncate text-[11.5px] text-[var(--text-muted)]">
              <SupplierRecord supplier={s} />
            </div>
          </div>
        </div>
      ),
    },
    {
      key: "lead",
      header: <span title="Median ± half the P10–P90 range. P80 is what a date is planned on.">Lead time</span>,
      numeric: true,
      width: "112px",
      render: (s) => <LeadTime supplier={s} />,
    },
    {
      key: "otif",
      header: <span title="On time in full: received by the promised date and at least the ordered quantity, per receipt.">OTIF</span>,
      numeric: true,
      width: "132px",
      render: (s) => <Otif supplier={s} comparison={comparison} />,
    },
    {
      key: "orderBy",
      header: <span title="Latest order date that lands before production starts, on this supplier's P80.">Order by</span>,
      numeric: true,
      width: "104px",
      render: (s) => <OrderBy supplier={s} />,
    },
  ];

  const renderCard = (s: SupplierPerformance) => (
    <div className="flex items-start gap-2.5">
      {selectable ? <Radio checked={s.supplierId === selectedId} /> : null}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-medium text-[var(--text-primary)]">{s.supplierName}</span>
          {s.supplierId === recommendedId ? <RecommendedTag /> : null}
        </div>
        <div className="mt-0.5 text-[11.5px] text-[var(--text-muted)]">
          <SupplierRecord supplier={s} />
        </div>
        <div className="mt-2 grid grid-cols-3 gap-3 text-left">
          <MobileStat label="Lead time">
            <LeadTime supplier={s} />
          </MobileStat>
          <MobileStat label="OTIF">
            <Otif supplier={s} comparison={comparison} />
          </MobileStat>
          <MobileStat label="Order by">
            <OrderBy supplier={s} />
          </MobileStat>
        </div>
      </div>
    </div>
  );

  return (
    <div>
      {layout === "list" ? (
        comparison.suppliers.length === 0 ? (
          <p className="text-[12.5px] text-[var(--text-muted)]">{comparison.unavailableReason}</p>
        ) : (
          <div className="divide-y divide-[var(--border)] border-y border-[var(--border)]">
            {comparison.suppliers.map((s) => (
              <div
                key={s.supplierId}
                onClick={onSelect ? () => onSelect(s) : undefined}
                className={cn("py-3", onSelect && "cursor-pointer")}
              >
                {renderCard(s)}
              </div>
            ))}
          </div>
        )
      ) : (
      <DataTable
        rows={comparison.suppliers}
        columns={columns}
        rowKey={(s) => s.supplierId}
        onRowClick={onSelect}
        isRowActive={selectable ? (s) => s.supplierId === selectedId : undefined}
        minWidth={560}
        card={renderCard}
        empty={comparison.unavailableReason}
      />
      )}
      {comparison.suppliers.length > 0 ? (
        <p className="mt-2 text-[11.5px] leading-snug text-[var(--text-muted)]">
          Lead time is median ± half the P10–P90 range. OTIF counts receipts that arrived by the
          promised date and in full.
          {comparison.onTimeUnavailable ? ` ${comparison.onTimeUnavailable}` : ""}
          {comparison.inFullUnavailable ? ` ${comparison.inFullUnavailable}` : ""}
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Cells                                                               */
/* ------------------------------------------------------------------ */

function SupplierRecord({ supplier: s }: { supplier: SupplierPerformance }) {
  return (
    <>
      {s.receipts} receipt{s.receipts === 1 ? "" : "s"} · {fmtPct(s.quantityShare)} of qty
      {s.lastReceiptDate ? (
        <>
          {" · last "}
          <span className="tabular-nums">{fmtDateShort(s.lastReceiptDate)}</span>
          {s.servedLatestOrder ? (
            <span className="text-[var(--text-secondary)]"> · served the latest order</span>
          ) : null}
        </>
      ) : null}
    </>
  );
}

function LeadTime({ supplier: s }: { supplier: SupplierPerformance }) {
  return (
    <div>
      <div className="tabular-nums text-[var(--text-primary)]">
        {Math.round(s.medianLeadTimeDays)}d
        {s.spreadDays !== undefined ? (
          <span className="text-[var(--text-muted)]"> ± {Math.round(s.spreadDays)}</span>
        ) : null}
      </div>
      <div
        className="text-[11px] tabular-nums text-[var(--text-muted)]"
        title={s.thinRecord ? `Fewer than ${MIN_RECORD} receipts — too few for a spread.` : undefined}
      >
        P80 {Math.round(s.p80LeadTimeDays)}d{s.thinRecord ? " · thin" : ""}
      </div>
    </div>
  );
}

function Otif({ supplier: s, comparison }: { supplier: SupplierPerformance; comparison: SupplierComparison }) {
  return (
    <div>
      <div className="tabular-nums text-[var(--text-primary)]" title={s.otifReason}>
        {s.otifPct !== undefined ? fmtPct(s.otifPct) : "—"}
      </div>
      <div className="whitespace-nowrap text-[11px] tabular-nums text-[var(--text-muted)]">
        <span title={comparison.onTimeUnavailable ?? `On time, over ${s.onTimeSample} receipts`}>
          OT {s.onTimePct !== undefined ? fmtPct(s.onTimePct) : "—"}
        </span>
        {" · "}
        <span title={comparison.inFullUnavailable ?? `In full, over ${s.inFullSample} receipts`}>
          IF {s.inFullPct !== undefined ? fmtPct(s.inFullPct) : "—"}
        </span>
      </div>
    </div>
  );
}

function OrderBy({ supplier: s }: { supplier: SupplierPerformance }) {
  if (s.orderByDate === undefined || s.weeksToOrderBy === undefined) {
    return (
      <span className="text-[var(--text-muted)]" title="No production window, so no order-by date.">
        —
      </span>
    );
  }
  return (
    <div>
      <div className="tabular-nums text-[var(--text-primary)]">{fmtDateShort(s.orderByDate)}</div>
      <div
        className={cn(
          "text-[11px] font-medium tabular-nums",
          s.landsInTime === false ? TONE_TEXT.critical : TONE_TEXT[deadlineTone(s.weeksToOrderBy)]
        )}
      >
        {s.landsInTime === false ? "too late on P80" : weeksLeftLabel(s.weeksToOrderBy)}
      </div>
    </div>
  );
}

function RecommendedTag() {
  return (
    <span className="flex-none rounded-[3px] bg-[var(--accent-soft)] px-1.5 py-px text-[10.5px] font-medium text-[var(--accent)]">
      Recommended
    </span>
  );
}

function Radio({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "mt-[3px] flex size-3.5 flex-none items-center justify-center rounded-full border",
        checked ? "border-[var(--accent)]" : "border-[var(--border-strong)]"
      )}
    >
      {checked ? <span className="size-1.5 rounded-full bg-[var(--accent)]" /> : null}
    </span>
  );
}

function MobileStat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 text-[12.5px]">
      <div className="text-[10.5px] uppercase tracking-[0.06em] text-[var(--text-muted)]">{label}</div>
      {children}
    </div>
  );
}
