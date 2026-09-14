"use client";

/**
 * Load against capacity, one bar per production month.
 *
 * Shared by Overview (cumulative load on a line across every programme) and
 * Scenario Lab (the same, under a scenario). Presentational only: every hour
 * figure arrives already derived from `lib/situations/*`; the only maths here
 * is scaling hours to pixels and picking readable gridline steps.
 *
 * Per month, bottom to top: committed (in the formal plan), added (carried
 * forward / absent load), moved in (hours a scenario moved into the month).
 * A dashed line marks that month's capacity; anything above it is over.
 *
 * With `renderTooltip`, hovering (or tapping) a bar opens a small card beside
 * it with that month's figures — the same interaction as Overview's
 * missing-items chart — so figures elsewhere on the page can stay put.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { formatMonthLabel } from "@/lib/dataset/periods";
import { cn } from "@/lib/utils/cn";
import { fmtHours } from "@/lib/utils/format";
import type { MonthKey } from "@/types/dataset";

export interface LoadCapacityMonth {
  period: MonthKey;
  /** Already in the formal plan. */
  committedHours: number;
  /** Carried-forward / absent load in this month. */
  addedHours: number;
  /** Hours moved INTO this month by a scenario (pull forward / push back). */
  movedInHours?: number;
  /** Available hours — the ceiling. */
  capacityHours: number;
  /** True when a scenario changed this month's capacity — the line is drawn in the scenario colour. */
  capacityEdited?: boolean;
}

const Y_AXIS_W = "w-12";
const Y_AXIS_PL = "pl-12";

export function LoadCapacityChart({
  months,
  selected,
  onSelect,
  height = 240,
  labels,
  renderTooltip,
}: {
  months: LoadCapacityMonth[];
  selected?: MonthKey;
  onSelect?: (period: MonthKey) => void;
  height?: number;
  labels?: { committed?: string; added?: string; movedIn?: string };
  /** Content for the card shown while a month is hovered or tapped. Omit for no card. */
  renderTooltip?: (period: MonthKey) => ReactNode;
}) {
  const [hovered, setHovered] = useState<MonthKey | undefined>();
  // A tap on a touch screen pins the card until the next tap elsewhere.
  const [pinned, setPinned] = useState<MonthKey | undefined>();
  const plotRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pinned) return;
    const close = (e: PointerEvent) => {
      if (!plotRef.current?.contains(e.target as Node)) setPinned(undefined);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [pinned]);

  const shown = renderTooltip ? (hovered ?? pinned) : undefined;

  if (months.length === 0) {
    return <p className="text-[12.5px] text-[var(--text-muted)]">No capacity data to show.</p>;
  }

  const peak = Math.max(
    1,
    ...months.map((m) => Math.max(m.capacityHours, m.committedHours + m.addedHours + (m.movedInHours ?? 0)))
  );
  const { max, ticks } = hourScale(peak * 1.08);
  const hasMovedIn = months.some((m) => (m.movedInHours ?? 0) > 0.5);

  return (
    <div>
      <div className="overflow-x-auto">
        <div className="min-w-[340px]">
          <div
            ref={plotRef}
            className="relative mt-3"
            style={{ height }}
            onPointerLeave={(e) => {
              if (e.pointerType === "mouse") setHovered(undefined);
            }}
          >
            {/* Y-axis and its gridlines. */}
            <div className={cn("pointer-events-none absolute inset-y-0 left-0", Y_AXIS_W)}>
              {ticks.map((t) => (
                <span
                  key={t}
                  className="absolute right-2 translate-y-1/2 text-[10px] tabular-nums text-[var(--text-muted)]"
                  style={{ bottom: `${(t / max) * 100}%` }}
                >
                  {fmtHours(t)}
                </span>
              ))}
            </div>
            <div className={cn("pointer-events-none absolute inset-y-0 right-0", "left-12")}>
              {ticks.map((t) => (
                <div
                  key={t}
                  className={cn(
                    "absolute inset-x-0 border-t",
                    t === 0 ? "border-[var(--border-strong)]" : "border-[var(--border)]"
                  )}
                  style={{ bottom: `${(t / max) * 100}%` }}
                />
              ))}
            </div>

            <div className={cn("flex h-full gap-1 sm:gap-2", Y_AXIS_PL)}>
              {months.map((m, index) => {
                const position = index / Math.max(1, months.length - 1);
                return (
                  <MonthColumn
                    key={m.period}
                    month={m}
                    max={max}
                    selected={m.period === selected || m.period === shown}
                    onSelect={(period) => {
                      if (renderTooltip) setPinned((p) => (p === period ? undefined : period));
                      onSelect?.(period);
                    }}
                    onHover={renderTooltip ? setHovered : undefined}
                    tooltip={m.period === shown && renderTooltip ? renderTooltip(m.period) : undefined}
                    align={position > 0.6 ? "end" : "start"}
                  />
                );
              })}
            </div>

            {/* Phones: one card across the top of the plot, inside the chart's width. */}
            {shown && renderTooltip ? (
              <div
                role="tooltip"
                className="pointer-events-none absolute left-12 right-0 top-0 z-30 mx-auto max-w-[260px] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2.5 text-[11.5px] leading-tight text-[var(--text-secondary)] shadow-lg sm:hidden"
              >
                {renderTooltip(shown)}
              </div>
            ) : null}
          </div>

          <div className={cn("flex gap-1 sm:gap-2", Y_AXIS_PL)}>
            {months.map((m) => (
              <button
                key={m.period}
                type="button"
                onClick={() => onSelect?.(m.period)}
                className={cn(
                  "min-w-0 flex-1 truncate pt-1.5 text-center text-[10.5px] tabular-nums",
                  m.period === selected
                    ? "font-semibold text-[var(--text-primary)]"
                    : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                )}
              >
                {/* A phone has ~30px per month: the month alone fits, "Apr 27" truncates. */}
                <span className="sm:hidden">{formatMonthLabel(m.period).slice(0, 3)}</span>
                <span className="hidden sm:inline">{formatMonthLabel(m.period)}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] text-[var(--text-muted)]">
        <Swatch color="var(--state-formal)" label={labels?.committed ?? "Committed"} />
        <Swatch color="var(--state-inferred)" label={labels?.added ?? "Added by carried-forward SKUs"} />
        {hasMovedIn ? <Swatch color="var(--state-scenario)" label={labels?.movedIn ?? "Moved in"} /> : null}
        <span className="flex items-center gap-1.5">
          <span className="h-px w-6 border-t border-dashed border-[var(--risk-critical)]" aria-hidden />
          Line capacity — anything above is over
        </span>
      </div>
    </div>
  );
}

function MonthColumn({
  month,
  max,
  selected,
  onSelect,
  onHover,
  tooltip,
  align,
}: {
  month: LoadCapacityMonth;
  max: number;
  selected: boolean;
  onSelect?: (period: MonthKey) => void;
  onHover?: (period: MonthKey | undefined) => void;
  tooltip?: ReactNode;
  align: "start" | "end";
}) {
  const pct = (hours: number) => Math.max(0, (hours / max) * 100);
  const movedIn = month.movedInHours ?? 0;
  const total = month.committedHours + month.addedHours + movedIn;
  const over = total - month.capacityHours;
  const label = formatMonthLabel(month.period);

  return (
    <div className="relative flex h-full min-w-0 flex-1">
    <button
      type="button"
      onClick={() => onSelect?.(month.period)}
      onPointerEnter={(e) => {
        if (e.pointerType === "mouse") onHover?.(month.period);
      }}
      onFocus={() => onHover?.(month.period)}
      onBlur={() => onHover?.(undefined)}
      aria-pressed={selected}
      aria-label={`${label}: ${fmtHours(total)} of ${fmtHours(month.capacityHours)} capacity${
        over > 0.5 ? `, ${fmtHours(over)} over` : ""
      }`}
      className="group relative flex h-full w-full min-w-0 flex-col items-center justify-end outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
    >
      <span
        className={cn(
          "pointer-events-none absolute inset-0 rounded-t-[3px] transition-colors",
          selected ? "bg-[var(--interaction-selected)] opacity-60" : "group-hover:bg-[var(--interaction-hover)]"
        )}
        style={{ transitionDuration: "var(--duration-fast)" }}
        aria-hidden
      />

      {over > 0.5 ? (
        <span
          className="absolute left-1/2 z-10 -translate-x-1/2 whitespace-nowrap text-[8.5px] font-medium tabular-nums text-[var(--risk-critical)] sm:text-[10px]"
          style={{ bottom: `calc(${pct(total)}% + 3px)` }}
        >
          {/* The word only fits beside the number from sm up; the red already says "over". */}
          +{fmtHours(over)}
          <span className="hidden sm:inline"> over</span>
        </span>
      ) : null}

      <span
        className={cn(
          "pointer-events-none absolute inset-x-0 z-10 border-dashed",
          month.capacityEdited ? "border-t-2 border-[var(--state-scenario)]" : "border-t border-[var(--risk-critical)]"
        )}
        style={{ bottom: `${pct(month.capacityHours)}%` }}
        title={month.capacityEdited ? "Capacity changed in this scenario" : undefined}
        aria-hidden
      />

      {/* Bottom to top: committed, added, moved in. */}
      <div
        className="relative z-[1] flex w-[72%] max-w-[44px] flex-col-reverse overflow-hidden rounded-t-[2px]"
        style={{ height: `${pct(total)}%` }}
        aria-hidden
      >
        {month.committedHours > 0 ? (
          <span style={{ flexGrow: month.committedHours, flexBasis: 0, background: "var(--state-formal)" }} />
        ) : null}
        {month.addedHours > 0 ? (
          <span style={{ flexGrow: month.addedHours, flexBasis: 0, background: "var(--state-inferred)" }} />
        ) : null}
        {movedIn > 0 ? (
          <span style={{ flexGrow: movedIn, flexBasis: 0, background: "var(--state-scenario)" }} />
        ) : null}
      </div>
    </button>
    {tooltip ? (
      <div
        role="tooltip"
        className={cn(
          // Anchored to the top of the plot beside its bar, so it never covers
          // the figures above the chart. A phone column is too narrow to sit
          // beside — the plot-wide card below takes over there.
          "pointer-events-none absolute top-0 z-30 hidden w-[236px] rounded-[var(--radius-md)] sm:block border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2.5 text-[11.5px] leading-tight text-[var(--text-secondary)] shadow-lg",
          align === "end" ? "right-full mr-1.5" : "left-full ml-1.5"
        )}
      >
        {tooltip}
      </div>
    ) : null}
    </div>
  );
}

/** A ceiling and 3–4 gridlines at a readable hour step (1, 2, 2.5 or 5 × a power of ten). */
function hourScale(value: number): { max: number; ticks: number[] } {
  const raw = Math.max(1, value) / 4;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].find((s) => s * magnitude >= raw) ?? 10) * magnitude;
  const count = Math.max(3, Math.ceil(value / step));
  const ticks = Array.from({ length: count + 1 }, (_, i) => i * step);
  return { max: count * step, ticks };
}

function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="size-2.5 rounded-[2px]" style={{ background: color }} aria-hidden />
      {label}
    </span>
  );
}
