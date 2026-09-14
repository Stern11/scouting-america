"use client";

/**
 * What is missing, when, and how much — the headline of Overview.
 *
 * A sentence title carries both figures a planner quotes (how many SKUs, and
 * the revenue), one line says what that means for the formal plan, and one
 * more splits it into carrying forward and still to decide. Beneath, one
 * stacked bar per production month on a labelled y-axis: planned today at the
 * bottom, the absent segments above it. Hovering (or tapping) a bar opens a
 * small card beside it with that month's figures; nothing else on the page
 * changes. Labelled "by production month" so it is never read as sales timing.
 *
 * Every figure comes from `buildPlanningHorizon`; this component only draws.
 */

import { useEffect, useId, useRef, useState } from "react";
import {
  expectedItems,
  missingItems,
  stackTotal,
  type HorizonMeasure,
  type HorizonMonth,
  type HorizonSlice,
  type HorizonStack,
  type PlanningHorizon,
} from "@/lib/situations/horizon";
import { formatMonthLabel } from "@/lib/dataset/periods";
import { cn } from "@/lib/utils/cn";
import { fmtMoney, fmtNum, fmtUnits } from "@/lib/utils/format";
import type { MonthKey } from "@/types/dataset";

type SeriesKey = keyof HorizonStack;

/** Bottom to top. Planning-state tokens: these are data series, not statuses. */
const SERIES: { key: SeriesKey; label: string; color: string }[] = [
  { key: "planned", label: "Planned today", color: "var(--state-formal)" },
  { key: "carryingForward", label: "Absent — carrying forward", color: "var(--state-validated)" },
  { key: "toDecide", label: "Absent — still to decide", color: "var(--state-inferred)" },
  { key: "unexplained", label: "Absent — unexplained", color: "var(--state-unknown)" },
  { key: "exited", label: "Absent — intentional exit", color: "var(--state-historical-soft)" },
];

const SERIES_COLOR = Object.fromEntries(SERIES.map((s) => [s.key, s.color])) as Record<SeriesKey, string>;

const MEASURES: { key: HorizonMeasure; label: string }[] = [
  { key: "value", label: "Revenue" },
  { key: "units", label: "Units" },
  { key: "items", label: "SKUs" },
];

const CHART_H = 220;

export function MissingTimeline({ horizon }: { horizon: PlanningHorizon }) {
  const [measure, setMeasure] = useState<HorizonMeasure>(horizon.valuesComparable ? "value" : "items");
  const [hovered, setHovered] = useState<MonthKey | undefined>();
  // A tap on a touch screen pins the card until the next tap.
  const [pinned, setPinned] = useState<MonthKey | undefined>();
  const chartRef = useRef<HTMLDivElement>(null);
  const tooltipId = useId();
  const active: HorizonMeasure = measure === "value" && !horizon.valuesComparable ? "units" : measure;

  useEffect(() => {
    if (!pinned) return;
    const close = (e: PointerEvent) => {
      if (!chartRef.current?.contains(e.target as Node)) setPinned(undefined);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [pinned]);

  const slice = horizon.total;
  const missing = missingItems(slice);

  const first = horizon.months[0];
  const last = horizon.months[horizon.months.length - 1];
  const span = first && last ? `${formatMonthLabel(first.period)} – ${formatMonthLabel(last.period)}` : undefined;

  const format = (n: number) =>
    active === "items" ? fmtNum(n) : active === "units" ? fmtUnits(n, true) : fmtMoney(n, horizon.currency);

  const series = SERIES.filter((s) => active !== "items" || s.key !== "unexplained");
  const { max, ticks } = axisScale(Math.max(1, ...horizon.months.map((m) => stackTotal(m[active]))));

  const shown = hovered ?? pinned;

  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] px-4 py-5 sm:px-7 sm:py-6">
      <h2 className="text-[19px] font-semibold leading-snug tracking-[-0.01em] text-[var(--text-primary)] sm:text-[23px]">
        <span className={missing > 0 ? "text-[var(--risk-critical)]" : undefined}>{fmtNum(missing)}</span> expected SKU
        {missing === 1 ? " is" : "s are"} missing from the plan
        {horizon.valuesComparable ? (
          <>
            {" — "}
            <span className={slice.missingValue > 0 ? "text-[var(--risk-critical)]" : undefined}>
              {fmtMoney(slice.missingValue, horizon.currency)}
            </span>{" "}
            of revenue
          </>
        ) : null}
      </h2>
      <p className="mt-1 text-[13px] leading-snug text-[var(--text-secondary)]">
        {fmtUnits(slice.missingUnits, true)} the formal plan currently counts as zero · by production month
        {span ? `, ${span}` : ""}
      </p>
      {missing > 0 ? (
        <p className="mt-2 text-[13px] tabular-nums text-[var(--text-secondary)]">
          Of these {fmtNum(missing)}:{" "}
          <span className="font-semibold text-[var(--state-validated)]">{fmtNum(slice.items.carryingForward)}</span>{" "}
          carrying forward ·{" "}
          <span className="font-semibold text-[var(--state-inferred)]">{fmtNum(slice.items.toDecide)}</span> still to
          decide
        </p>
      ) : null}

      {horizon.months.length === 0 ? (
        <p className="mt-5 text-[12.5px] text-[var(--text-muted)]">
          No programme has a production window, so nothing can be placed in a month.
        </p>
      ) : (
        <>
          <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-[var(--border)] pt-4">
            <div className="flex items-center gap-1" role="group" aria-label="Measure">
              {MEASURES.map((m) => {
                const disabled = m.key === "value" && !horizon.valuesComparable;
                return (
                  <button
                    key={m.key}
                    type="button"
                    disabled={disabled}
                    aria-pressed={active === m.key}
                    onClick={() => setMeasure(m.key)}
                    aria-label={disabled ? `${m.label} — programmes are planned in more than one currency` : undefined}
                    className={cn(
                      "inline-flex h-8 items-center rounded-full border px-3 text-[12px] transition-colors disabled:opacity-[var(--interaction-disabled-opacity)]",
                      active === m.key
                        ? "border-[var(--interaction-selected-border)] bg-[var(--interaction-selected)] font-medium text-[var(--text-primary)]"
                        : "border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                    )}
                    style={{ transitionDuration: "var(--duration-fast)" }}
                  >
                    {m.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11.5px] text-[var(--text-secondary)]">
            {series.map((s) => (
              <span key={s.key} className="flex items-center gap-1.5">
                <Swatch color={s.color} />
                {s.label}
              </span>
            ))}
          </div>

          {/* Static: the all-months figures never change with hover. */}
          <div className="mt-4 min-h-[18px] text-[12px] tabular-nums text-[var(--text-secondary)]">
            <span className="font-medium text-[var(--text-primary)]">All months</span> ·{" "}
            {annotation(horizon.total, active, format)}
          </div>

          {/* No horizontal scroller here: it would clip the card above tall bars. */}
          <div ref={chartRef} className="mt-3">
            <div
              className="relative mt-3"
              style={{ height: CHART_H }}
              onPointerLeave={(e) => {
                if (e.pointerType === "mouse") setHovered(undefined);
              }}
            >
              <div className="pointer-events-none absolute inset-y-0 left-0 w-14">
                {ticks.map((t) => (
                  <span
                    key={t}
                    className="absolute right-2 translate-y-1/2 whitespace-nowrap text-[10px] tabular-nums text-[var(--text-muted)]"
                    style={{ bottom: `${(t / max) * 100}%` }}
                  >
                    {format(t)}
                  </span>
                ))}
              </div>
              <div className="pointer-events-none absolute inset-y-0 left-14 right-0">
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

              <div className="flex h-full gap-1 pl-14 sm:gap-2">
                {horizon.months.map((month, index) => {
                  const isShown = month.period === shown;
                  const heightPct = (stackTotal(month[active]) / max) * 100;
                  const position = index / Math.max(1, horizon.months.length - 1);
                  return (
                    <div key={month.period} className="relative flex h-full min-w-0 flex-1 flex-col items-center justify-end">
                      <button
                        type="button"
                        aria-label={`${formatMonthLabel(month.period)}: ${annotation(month, active, format)}`}
                        aria-describedby={isShown ? tooltipId : undefined}
                        aria-expanded={isShown}
                        onPointerEnter={(e) => {
                          if (e.pointerType === "mouse") setHovered(month.period);
                        }}
                        onClick={() => setPinned((p) => (p === month.period ? undefined : month.period))}
                        onFocus={() => setHovered(month.period)}
                        onBlur={() => setHovered(undefined)}
                        className="group flex h-full w-full flex-col items-center justify-end rounded-t-[3px] outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                      >
                        <div
                          className={cn(
                            "flex w-[80%] flex-col-reverse overflow-hidden rounded-t-[3px] transition-opacity",
                            shown !== undefined && !isShown && "opacity-55"
                          )}
                          style={{ height: `${heightPct}%`, transitionDuration: "var(--duration-fast)" }}
                        >
                          {series.map((s) => {
                            const v = month[active][s.key];
                            return v > 0 ? (
                              <div key={s.key} style={{ flexGrow: v, flexBasis: 0, background: s.color }} />
                            ) : null;
                          })}
                        </div>
                      </button>

                      {isShown ? (
                        <MonthCard
                          id={tooltipId}
                          month={month}
                          measure={active}
                          format={format}
                          align={position < 0.34 ? "start" : position > 0.66 ? "end" : "center"}
                        />
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex gap-1 pl-14 pt-2 sm:gap-2" aria-hidden>
              {horizon.months.map((month) => (
                <span
                  key={month.period}
                  className={cn(
                    "min-w-0 flex-1 truncate text-center text-[10.5px] tabular-nums",
                    month.period === shown ? "font-semibold text-[var(--text-primary)]" : "text-[var(--text-muted)]"
                  )}
                >
                  {/* A phone has ~30px per month: the month alone fits, "Apr 27" truncates. */}
                  <span className="sm:hidden">{formatMonthLabel(month.period).slice(0, 3)}</span>
                  <span className="hidden sm:inline">{formatMonthLabel(month.period)}</span>
                </span>
              ))}
            </div>
          </div>

          {horizon.unphased.length > 0 ? (
            <p className="mt-2 text-[11.5px] text-[var(--text-muted)]">
              {horizon.unphased.map((u) => u.title).join(", ")} ha{horizon.unphased.length === 1 ? "s" : "ve"} no
              production window, so {horizon.unphased.length === 1 ? "it is" : "they are"} in the total but in no month.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

/**
 * The hovered month's figures, sitting just above its bar. Aligned to the
 * bar's left edge near the start of the axis and its right edge near the end,
 * so it never runs outside the chart.
 */
function MonthCard({
  id,
  month,
  measure,
  format,
  align,
}: {
  id: string;
  month: HorizonMonth;
  measure: HorizonMeasure;
  format: (n: number) => string;
  align: "start" | "center" | "end";
}) {
  const { expected, missing } = totals(month, measure);
  const stack = month[measure];

  return (
    <div
      id={id}
      role="tooltip"
      className={cn(
        "pointer-events-none absolute top-0 z-20 w-[244px] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2.5 text-[11.5px] leading-tight text-[var(--text-secondary)] shadow-lg",
        // Anchored to the top of the plot at every width, so it can never
        // climb over the legend or the totals line above the chart. A phone
        // column is too narrow to sit beside, so there it spans from its bar's
        // edge; from sm up it sits beside the bar.
        align === "start" && "left-0",
        align === "center" && "left-1/2 -translate-x-1/2",
        align === "end" && "right-0",
        "sm:translate-x-0",
        align === "end" ? "sm:left-auto sm:right-full sm:mr-1.5" : "sm:left-full sm:right-auto sm:ml-1.5"
      )}
    >
      <div className="mb-1.5 text-[12px] font-semibold text-[var(--text-primary)]">{formatMonthLabel(month.period)}</div>
      {/* Only what the month actually has: a column of zeros is noise to read past. */}
      <dl className="space-y-1 tabular-nums">
        <Row label="Expected" value={format(expected)} strong />
        {stack.planned > 0 ? <Row label="Planned" value={format(stack.planned)} color={SERIES_COLOR.planned} /> : null}
        {missing > 0 ? <Row label="Missing" value={format(missing)} strong /> : null}
        {stack.carryingForward > 0 ? (
          <Row label="Carrying forward" value={format(stack.carryingForward)} color={SERIES_COLOR.carryingForward} indent />
        ) : null}
        {stack.toDecide > 0 ? (
          <Row label="Still to decide" value={format(stack.toDecide)} color={SERIES_COLOR.toDecide} indent />
        ) : null}
        {measure !== "items" && stack.unexplained > 0 ? (
          <Row label="Unexplained" value={format(stack.unexplained)} color={SERIES_COLOR.unexplained} indent />
        ) : null}
        {stack.exited > 0 ? <Row label="Exited" value={format(stack.exited)} color={SERIES_COLOR.exited} /> : null}
      </dl>
    </div>
  );
}

function Row({
  label,
  value,
  color,
  strong,
  indent,
}: {
  label: string;
  value: string;
  color?: string;
  strong?: boolean;
  indent?: boolean;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-3", indent && "pl-3")}>
      <dt className="flex min-w-0 items-center gap-1.5">
        {color ? <Swatch color={color} /> : null}
        <span className={cn("whitespace-nowrap", strong && "font-medium text-[var(--text-primary)]")}>{label}</span>
      </dt>
      <dd
        className={cn(
          "whitespace-nowrap",
          strong ? "font-semibold text-[var(--text-primary)]" : "text-[var(--text-primary)]"
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function Swatch({ color }: { color: string }) {
  return (
    <span
      className="size-2.5 flex-none rounded-[2px] border border-[var(--border)]"
      style={{ background: color }}
      aria-hidden
    />
  );
}

/**
 * A ceiling and 4–5 gridlines at a rounded step (1, 1.4, 2, 2.5 or 5 × a power
 * of ten) — axis pixels only, never a planning figure.
 */
function axisScale(value: number): { max: number; ticks: number[] } {
  const raw = value / 4;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 1.4, 2, 2.5, 5, 10].find((s) => s * magnitude >= raw) ?? 10) * magnitude;
  const count = Math.max(4, Math.ceil(value / step));
  return { max: count * step, ticks: Array.from({ length: count + 1 }, (_, i) => i * step) };
}

/** Expected and missing in the active measure, as the horizon defines them. */
function totals(slice: HorizonSlice, measure: HorizonMeasure): { expected: number; missing: number } {
  if (measure === "items") return { expected: expectedItems(slice), missing: missingItems(slice) };
  const missing = measure === "units" ? slice.missingUnits : slice.missingValue;
  return { expected: slice[measure].planned + missing, missing };
}

/** "470 expected · 376 planned · 81 absent (8 still to decide) · 13 exited". */
function annotation(slice: HorizonSlice, measure: HorizonMeasure, format: (n: number) => string): string {
  const { expected, missing } = totals(slice, measure);
  const stack = slice[measure];
  return `${format(expected)} expected · ${format(stack.planned)} planned · ${format(missing)} absent (${format(
    stack.toDecide
  )} still to decide) · ${format(stack.exited)} exited`;
}
