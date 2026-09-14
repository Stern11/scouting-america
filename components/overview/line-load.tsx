"use client";

/**
 * Factory load against capacity, one line at a time (or the plant total).
 *
 * Cumulative across every programme: committed hours are the formal plan,
 * added hours are what the carried-forward SKUs of every programme put on the
 * line. Opens on the line that goes furthest past capacity.
 *
 * The four tiles are the whole horizon on the chosen line and hold still;
 * hovering (or tapping) a month opens a card beside its bar with that month's
 * figures — the same interaction as the missing-items chart above.
 *
 * Every figure comes from `buildLineLoadSeries`; this component only draws.
 */

import Link from "next/link";
import { useMemo, useState } from "react";
import { LoadCapacityChart } from "@/components/shared/load-capacity-chart";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ALL_LINES,
  buildLineLoadSeries,
  listLoadLines,
  worstLoadLine,
  type LineLoadMonth,
  type LineLoadSeries,
} from "@/lib/situations/portfolio";
import { formatMonthLabel } from "@/lib/dataset/periods";
import { cn } from "@/lib/utils/cn";
import { fmtHours, fmtPct } from "@/lib/utils/format";
import type { PlanningSituation } from "@/types/situation";

export function LineLoad({ situations }: { situations: readonly PlanningSituation[] }) {
  const lines = useMemo(() => listLoadLines(situations), [situations]);
  const defaultLine = useMemo(() => worstLoadLine(situations) ?? ALL_LINES, [situations]);
  const [picked, setPicked] = useState<string | undefined>();
  // A pick that no longer exists (a changed dataset) falls back to the default.
  const lineId = picked === ALL_LINES || lines.some((l) => l.lineId === picked) ? picked! : defaultLine;

  const series = useMemo(() => buildLineLoadSeries(situations, lineId), [situations, lineId]);
  const byPeriod = useMemo(() => new Map(series.months.map((m) => [m.period, m])), [series]);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 text-[13px] text-[var(--text-secondary)]">
          {series.monthsOverCapacity > 0 ? (
            <>
              Peaks at{" "}
              <span className="font-semibold tabular-nums text-[var(--risk-critical)]">
                {fmtPct(series.peakUtilization)}
              </span>
              {series.peakPeriod ? ` in ${formatMonthLabel(series.peakPeriod)}` : ""} ·{" "}
              {series.monthsOverCapacity} month{series.monthsOverCapacity === 1 ? "" : "s"} over capacity
            </>
          ) : (
            "Stays within capacity once carried-forward SKUs count."
          )}
        </p>
        <Select value={lineId} onValueChange={setPicked}>
          <SelectTrigger className="w-full sm:w-[260px]" aria-label="Line">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_LINES}>All lines (plant total)</SelectItem>
            {lines.map((l) => (
              <SelectItem key={l.lineId} value={l.lineId}>
                {l.lineName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <TotalTiles series={series} />

      <div className="mt-5">
        <LoadCapacityChart
          months={series.months}
          labels={{ committed: "Committed (formal plan)", added: "Added by carried-forward SKUs" }}
          renderTooltip={(period) => {
            const month = byPeriod.get(period);
            return month ? <MonthCard month={month} /> : null;
          }}
        />
      </div>
    </div>
  );
}

/**
 * Four tiles for the whole horizon on the chosen line, one shape each — label,
 * figure, one quiet line — so they line up as a row and never move on hover.
 */
function TotalTiles({ series }: { series: LineLoadSeries }) {
  const { totals } = series;
  const first = series.months[0];
  const last = series.months[series.months.length - 1];
  const span = first && last ? `${formatMonthLabel(first.period)} – ${formatMonthLabel(last.period)}` : "";
  const over = series.overCapacityHours > 0.5;
  const programmes = totals.byProgramme;

  return (
    <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
      <Tile
        label={`Utilisation · ${span}`}
        shortLabel="Utilisation"
        critical={totals.effectiveUtilization > 1}
        value={
          <>
            <span className="text-[var(--text-muted)]">{fmtPct(totals.committedUtilization)}</span>
            <span className="mx-1 text-[14px] text-[var(--text-muted)]">→</span>
            {fmtPct(totals.effectiveUtilization)}
          </>
        }
        sub={`all months · ${fmtHours(totals.capacityHours)} available`}
      />
      <Tile
        label="Over capacity"
        critical={over}
        value={over ? fmtHours(series.overCapacityHours) : "None"}
        sub={
          over
            ? `across ${series.monthsOverCapacity} month${series.monthsOverCapacity === 1 ? "" : "s"}`
            : "every month fits within available hours"
        }
      />
      <Tile
        label="Added by carried-forward SKUs"
        shortLabel="Hours added"
        value={`+${fmtHours(totals.addedHours)}`}
        sub={`on ${fmtHours(totals.committedHours)} already planned`}
      />
      <Tile
        label="Programmes adding hours"
        shortLabel="Programmes"
        value={programmes.length === 0 ? "None" : String(programmes.length)}
        sub={
          programmes.length === 0 ? (
            "nothing carried forward lands here"
          ) : (
            <span className="flex flex-wrap gap-x-2">
              {programmes.map((p) => (
                <Link
                  key={p.situationId}
                  href={`/workspace/${p.situationId}/reconcile`}
                  className="whitespace-nowrap underline-offset-2 hover:text-[var(--text-primary)] hover:underline"
                >
                  {p.title} +{fmtHours(p.hours)}
                </Link>
              ))}
            </span>
          )
        }
      />
    </div>
  );
}

/** One month's figures, in the card beside its bar. Zero rows are left out. */
function MonthCard({ month }: { month: LineLoadMonth }) {
  const over = month.overCapacityHours > 0.5;
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="text-[12px] font-semibold text-[var(--text-primary)]">{formatMonthLabel(month.period)}</span>
        <span className={cn("whitespace-nowrap tabular-nums", over ? "font-semibold text-[var(--risk-critical)]" : "text-[var(--text-primary)]")}>
          {fmtPct(month.committedUtilization)} → {fmtPct(month.effectiveUtilization)}
        </span>
      </div>
      <dl className="space-y-1 tabular-nums">
        <CardRow label="Available" value={fmtHours(month.capacityHours)} strong />
        {month.committedHours > 0 ? (
          <CardRow label="Committed" value={fmtHours(month.committedHours)} color="var(--state-formal)" />
        ) : null}
        {month.addedHours > 0 ? (
          <CardRow label="Added" value={`+${fmtHours(month.addedHours)}`} color="var(--state-inferred)" />
        ) : null}
        {over ? <CardRow label="Over capacity" value={fmtHours(month.overCapacityHours)} critical /> : null}
        {month.byProgramme.map((p) => (
          <CardRow key={p.situationId} label={p.title} value={`+${fmtHours(p.hours)}`} indent />
        ))}
      </dl>
    </div>
  );
}

function CardRow({
  label,
  value,
  color,
  strong,
  critical,
  indent,
}: {
  label: string;
  value: string;
  color?: string;
  strong?: boolean;
  critical?: boolean;
  indent?: boolean;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-3", indent && "pl-3")}>
      <dt className="flex min-w-0 items-center gap-1.5">
        {color ? (
          <span className="size-2.5 flex-none rounded-[2px]" style={{ background: color }} aria-hidden />
        ) : null}
        <span
          className={cn(
            "whitespace-nowrap",
            strong && "font-medium text-[var(--text-primary)]",
            critical && "text-[var(--risk-critical)]"
          )}
        >
          {label}
        </span>
      </dt>
      <dd
        className={cn(
          "whitespace-nowrap",
          critical ? "font-semibold text-[var(--risk-critical)]" : "text-[var(--text-primary)]",
          strong && "font-semibold"
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function Tile({
  label,
  shortLabel,
  value,
  sub,
  critical,
}: {
  label: string;
  /** Shown while the tiles are two to a row, where the full label would truncate mid-word. */
  shortLabel?: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  critical?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col rounded-[var(--radius-sm)] border px-3 py-2.5",
        critical
          ? "border-[var(--risk-critical)]/30 bg-[var(--risk-critical)]/[0.06]"
          : "border-[var(--border)] bg-[var(--surface)]"
      )}
    >
      <div
        className="truncate text-[10.5px] font-medium uppercase leading-tight tracking-wide text-[var(--text-muted)]"
        title={label}
      >
        {shortLabel ? (
          <>
            <span className="lg:hidden">{shortLabel}</span>
            <span className="hidden lg:inline">{label}</span>
          </>
        ) : (
          label
        )}
      </div>
      <div
        className={cn(
          "mt-1.5 text-[19px] font-semibold leading-none tabular-nums",
          critical ? "text-[var(--risk-critical)]" : "text-[var(--text-primary)]"
        )}
      >
        {value}
      </div>
      {sub ? <div className="mt-1.5 text-[11.5px] leading-snug text-[var(--text-muted)]">{sub}</div> : null}
    </div>
  );
}
