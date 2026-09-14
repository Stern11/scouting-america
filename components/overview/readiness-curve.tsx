/**
 * The season readiness curve (V2 §39, PRD §16, §23.2 — "Planning Gap Curve").
 *
 * One question per card: how much of this season's expected value is in the
 * plan, against where last year stood at the same point — and how much has to
 * be added before the first decision stops being reversible?
 *
 * Last year is a dashed historical line; this year is a solid line from its
 * earlier checkpoints to today's live figure, with both marked at today's
 * week. The span from today to the deadline is the green "weeks left" zone,
 * from the deadline to production start the red "lead time" zone. One line
 * underneath reads the lateness gap in points and in money.
 *
 * Marks and labels are HTML laid over a stretched SVG, so text and dots keep
 * their shape at any card width; the SVG only carries lines and zones. Every
 * figure comes from `buildReadinessCurve`.
 */

"use client";

import { useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Maximize2 } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils/cn";
import { fmtDateShort, fmtMoney, fmtPct } from "@/lib/utils/format";
import {
  interpolateReadiness,
  type ReadinessCurve,
  type ReadinessLateness,
  type ReadinessPoint,
} from "@/lib/situations/readiness-curve";
import { skuCounts } from "@/lib/situations/horizon";
import type { PlanningSituation } from "@/types/situation";

/** Percent across the axis: the horizon at the left, production start at the right. */
function xPct(weeks: number, horizonWeeks: number): number {
  return ((horizonWeeks - weeks) / horizonWeeks) * 100;
}

function yPct(pct: number): number {
  return (1 - Math.max(0, Math.min(1, pct))) * 100;
}

function pathFor(points: ReadinessPoint[], horizonWeeks: number): string {
  return points
    .map(
      (p, i) =>
        `${i === 0 ? "M" : "L"}${xPct(p.weeksBeforeProductionStart, horizonWeeks).toFixed(2)},${yPct(p.representedPct).toFixed(2)}`
    )
    .join(" ");
}

/**
 * The chart itself, reused at two sizes: compact on the card, and larger
 * inside the zoom dialog.
 */
function ReadinessChart({ curve, heightClass }: { curve: ReadinessCurve; heightClass: string }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [hoverWeeks, setHoverWeeks] = useState<number | null>(null);

  const horizonWeeks = Math.max(curve.horizonWeeks, 1);
  const x = (weeks: number) => xPct(weeks, horizonWeeks);

  const hasToday = curve.todayWeeksBeforeProduction !== undefined && curve.todayPct !== undefined;
  const todayX = hasToday ? x(curve.todayWeeksBeforeProduction!) : undefined;

  const deadlineWeeks = curve.dropDeadWeeksBeforeProduction;
  const showDeadline = deadlineWeeks !== undefined && deadlineWeeks >= 0 && deadlineWeeks <= horizonWeeks;
  const deadlineX = showDeadline ? x(deadlineWeeks!) : undefined;

  const hasPrior = curve.priorSeasonPace.length > 1;
  const hasCurrent = curve.currentSeasonPace.length > 1;

  const hoverPrior = hoverWeeks !== null ? interpolateReadiness(curve.priorSeasonPace, hoverWeeks) : undefined;
  const hoverCurrent = hoverWeeks !== null ? interpolateReadiness(curve.currentSeasonPace, hoverWeeks) : undefined;

  const updateHover = (clientX: number) => {
    const el = boxRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0) return;
    const share = (clientX - rect.left) / rect.width;
    setHoverWeeks(Math.max(0, Math.min(horizonWeeks, horizonWeeks - share * horizonWeeks)));
  };

  return (
    <div>
      <div className="mt-2 pl-7 text-[10px] text-[var(--text-muted)]">% of expected value in plan</div>
      <div className="relative mt-1 pl-7">
        {/* Y-axis: three labelled gridlines. */}
        <div className="pointer-events-none absolute inset-y-0 left-0 flex w-7 flex-col justify-between text-[9px] leading-none text-[var(--text-muted)]">
          <span>100%</span>
          <span>50%</span>
          <span>0%</span>
        </div>

        <div
          ref={boxRef}
          className={cn("@container relative w-full cursor-crosshair", heightClass)}
          onMouseMove={(e) => updateHover(e.clientX)}
          onMouseLeave={() => setHoverWeeks(null)}
        >
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full" aria-hidden>
            {todayX !== undefined ? (
              <rect x={0} y={0} width={todayX} height={100} fill="var(--surface-sunken)" />
            ) : null}
            {todayX !== undefined && deadlineX !== undefined && deadlineX > todayX ? (
              <rect x={todayX} y={0} width={deadlineX - todayX} height={100} fill="var(--risk-positive)" fillOpacity={0.09} />
            ) : null}
            {deadlineX !== undefined ? (
              <rect
                x={Math.max(deadlineX, todayX ?? 0)}
                y={0}
                width={100 - Math.max(deadlineX, todayX ?? 0)}
                height={100}
                fill="var(--risk-critical)"
                fillOpacity={0.08}
              />
            ) : null}

            {[0, 50, 100].map((p) => (
              <line key={p} x1={0} x2={100} y1={p} y2={p} stroke="var(--border)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            ))}

            {hasPrior ? (
              <path
                d={pathFor(curve.priorSeasonPace, horizonWeeks)}
                fill="none"
                stroke="var(--state-historical)"
                strokeWidth={1.5}
                strokeDasharray="4,3"
                vectorEffect="non-scaling-stroke"
              />
            ) : null}
            {hasCurrent ? (
              <path
                d={pathFor(curve.currentSeasonPace, horizonWeeks)}
                fill="none"
                stroke="var(--state-formal)"
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
              />
            ) : null}

            {deadlineX !== undefined ? (
              <line x1={deadlineX} x2={deadlineX} y1={0} y2={100} stroke="var(--risk-critical)" strokeDasharray="3,3" strokeWidth={1.25} vectorEffect="non-scaling-stroke" />
            ) : null}
            {todayX !== undefined ? (
              <line x1={todayX} x2={todayX} y1={0} y2={100} stroke="var(--text-primary)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
            ) : null}
            {hoverWeeks !== null ? (
              <line x1={x(hoverWeeks)} x2={x(hoverWeeks)} y1={0} y2={100} stroke="var(--text-muted)" strokeDasharray="2,2" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            ) : null}
          </svg>

          {/* Zone labels, at the top of each zone. */}
          {todayX !== undefined && deadlineX !== undefined && curve.weeksLeft !== undefined && deadlineX > todayX ? (
            <ZoneLabel
              from={todayX}
              to={deadlineX}
              className="text-[var(--risk-positive)]"
              short={`${curve.weeksLeft} wks left`}
            >
              {curve.weeksLeft} wks left
            </ZoneLabel>
          ) : null}
          {deadlineX !== undefined && curve.leadTimeWeeks !== undefined ? (
            <ZoneLabel
              from={Math.max(deadlineX, todayX ?? 0)}
              to={100}
              className="text-[var(--risk-critical)]"
              short={`${curve.leadTimeWeeks}w lead`}
            >
              {curve.leadTimeWeeks} wks lead time
            </ZoneLabel>
          ) : null}

          {/* Marks at today's week: last year, and this year. */}
          {todayX !== undefined && curve.lastYearAtToday !== undefined ? (
            <Dot x={todayX} y={yPct(curve.lastYearAtToday)} color="var(--state-historical)" />
          ) : null}
          {deadlineX !== undefined && curve.lastYearAtDeadline !== undefined ? (
            <Dot x={deadlineX} y={yPct(curve.lastYearAtDeadline)} color="var(--state-historical)" />
          ) : null}
          {todayX !== undefined && hasToday ? (
            <Dot x={todayX} y={yPct(curve.todayPct!)} color="var(--state-formal)" size="lg" />
          ) : null}

          {hoverWeeks !== null && (hoverPrior !== undefined || hoverCurrent !== undefined) ? (
            <div
              className="pointer-events-none absolute top-1 z-10 -translate-x-1/2 whitespace-nowrap rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-elevated)] px-2 py-1 text-[10.5px] leading-tight tabular-nums shadow-sm"
              style={{ left: `${Math.max(14, Math.min(86, x(hoverWeeks)))}%` }}
            >
              <div className="text-[var(--text-muted)]">{Math.round(hoverWeeks)} wks before</div>
              {hoverCurrent !== undefined ? (
                <div className="font-semibold text-[var(--text-primary)]">{fmtPct(hoverCurrent)} this year</div>
              ) : null}
              {hoverPrior !== undefined ? (
                <div className="text-[var(--text-secondary)]">{fmtPct(hoverPrior)} last year</div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex items-center justify-between pl-7 text-[10.5px] text-[var(--text-muted)]">
        <span>{horizonWeeks} wks before production</span>
        <span>production start</span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 pl-7 text-[10.5px] text-[var(--text-muted)]">
        {hasCurrent || hasToday ? (
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-3 bg-[var(--state-formal)]" aria-hidden />
            This year
          </span>
        ) : null}
        {hasPrior ? (
          <span className="flex items-center gap-1.5">
            <span className="h-px w-3 border-t border-dashed border-[var(--state-historical)]" aria-hidden />
            Last year
          </span>
        ) : null}
        {showDeadline ? (
          <span className="flex items-center gap-1.5">
            <span className="h-px w-3 border-t border-dashed border-[var(--risk-critical)]" aria-hidden />
            {curve.dropDeadLabel ?? "Deadline"}
            {curve.dropDeadDate ? ` · ${fmtDateShort(curve.dropDeadDate)}` : ""}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function ZoneLabel({
  from,
  to,
  className,
  short,
  children,
}: {
  from: number;
  to: number;
  className: string;
  /** What fits when the chart is phone-width — "11w" rather than a clipped "11 wks l…". */
  short: ReactNode;
  children: ReactNode;
}) {
  const share = to - from;
  // Too narrow even for the short form: the legend and the lateness line still carry it.
  if (share < 10) return null;
  // The full words need about 90px: a fifth of a card-width chart, never a
  // phone-width one.
  const fullFits = share >= 20;
  return (
    <div
      className={cn(
        "pointer-events-none absolute bottom-1 truncate px-0.5 text-center text-[10px] font-medium",
        className
      )}
      style={{ left: `${from}%`, width: `${share}%` }}
    >
      {fullFits ? (
        <>
          <span className="@[440px]:hidden">{short}</span>
          <span className="hidden @[440px]:inline">{children}</span>
        </>
      ) : (
        short
      )}
    </div>
  );
}

function Dot({ x, y, color, size = "sm" }: { x: number; y: number; color: string; size?: "sm" | "lg" }) {
  return (
    <span
      className={cn(
        "pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-[1.5px] border-[var(--surface)]",
        size === "lg" ? "size-2.5" : "size-2"
      )}
      style={{ left: `${x}%`, top: `${y}%`, background: color }}
      aria-hidden
    />
  );
}

/** "12 pts behind last year · needs +29 pts ($48M) in 10 wks — last year gained 17 pts". */
function LatenessLine({ lateness }: { lateness: ReadinessLateness }) {
  const pts = (n: number) => Math.round(Math.abs(n) * 100);
  const { gapPts, neededPts, neededValue, lastYearGainedPts, weeksLeft, currency } = lateness;

  return (
    <p className="mt-2 text-[11.5px] leading-snug tabular-nums text-[var(--text-secondary)]">
      {gapPts !== undefined ? (
        pts(gapPts) === 0 ? (
          <span className="font-medium text-[var(--text-primary)]">Level with last year</span>
        ) : (
          <span
            className={cn(
              "font-medium",
              gapPts < 0 ? "text-[var(--risk-critical)]" : "text-[var(--risk-positive)]"
            )}
          >
            {pts(gapPts)} pts {gapPts < 0 ? "behind" : "ahead of"} last year
          </span>
        )
      ) : null}
      {gapPts !== undefined && neededPts !== undefined ? " · " : null}
      {neededPts !== undefined ? (
        neededPts > 0 ? (
          <>
            needs <span className="font-medium text-[var(--text-primary)]">+{pts(neededPts)} pts</span>
            {neededValue !== undefined ? ` (${fmtMoney(neededValue, currency)})` : ""}
            {weeksLeft !== undefined ? ` in ${weeksLeft} wks` : ""}
            {lastYearGainedPts !== undefined ? ` — last year gained ${pts(lastYearGainedPts)} pts` : ""}
          </>
        ) : (
          "already past last year's level at the deadline"
        )
      ) : null}
    </p>
  );
}

export function ReadinessCurveCard({
  curve,
  situation,
  href,
}: {
  curve: ReadinessCurve;
  /** For the one-line count of what's still unrepresented/undecided. */
  situation: PlanningSituation;
  href: string;
}) {
  const [zoomed, setZoomed] = useState(false);
  const router = useRouter();

  return (
    // A `<button>` inside an `<a>` is invalid HTML, so the card navigates on
    // its own click handler and the zoom button stops propagation.
    <div
      role="link"
      tabIndex={0}
      onClick={() => router.push(href)}
      onKeyDown={(e) => {
        if (e.key === "Enter") router.push(href);
      }}
      className="cursor-pointer rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-4 transition-colors hover:bg-[var(--interaction-hover)] sm:p-5"
      style={{ transitionDuration: "var(--duration-fast)" }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="text-[13.5px] font-medium text-[var(--text-primary)]">{curve.situationTitle}</div>
        <div className="flex items-center gap-3 text-[11.5px] text-[var(--text-muted)]">
          {curve.todayPct !== undefined ? (
            <span>
              today <span className="font-medium text-[var(--text-primary)] tabular-nums">{fmtPct(curve.todayPct)}</span>
            </span>
          ) : null}
          {curve.lastYearAtToday !== undefined ? (
            <span>
              last year <span className="font-medium text-[var(--text-secondary)] tabular-nums">{fmtPct(curve.lastYearAtToday)}</span>
            </span>
          ) : null}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setZoomed(true);
            }}
            title="Expand chart"
            aria-label="Expand chart"
            className="-my-1.5 grid size-8 flex-none place-items-center rounded-[var(--radius-sm)] text-[var(--text-muted)] transition-colors hover:bg-[var(--interaction-hover)] hover:text-[var(--text-primary)]"
            style={{ transitionDuration: "var(--duration-fast)" }}
          >
            <Maximize2 className="size-3.5" />
          </button>
        </div>
      </div>

      <div className="text-[11px] leading-snug text-[var(--text-muted)]">{metaLine(situation)}</div>

      <ReadinessChart curve={curve} heightClass="h-[96px]" />

      {!curve.historyAvailable ? (
        <p className="mt-2 text-[11px] text-[var(--text-muted)]">{curve.historyUnavailableReason}</p>
      ) : curve.priorSeasonPace.length === 0 ? (
        <p className="mt-2 text-[11px] text-[var(--text-muted)]">No comparable prior season to pace against.</p>
      ) : curve.lateness ? (
        <LatenessLine lateness={curve.lateness} />
      ) : (
        <p className="mt-2 text-[11px] text-[var(--text-muted)]">
          Today and the deadline fall outside last year&apos;s history, so there is no gap to read.
        </p>
      )}

      {curve.constrainingMaterial ? (
        <p className="mt-2.5 border-t border-[var(--border)] pt-2 text-[11.5px] leading-snug text-[var(--text-secondary)]">
          <span className="font-medium text-[var(--risk-warning)]">{curve.constrainingMaterial.materialName}</span> is
          the tightest constraint — order by{" "}
          <span className="font-medium text-[var(--text-primary)]">{fmtDateShort(curve.constrainingMaterial.decisionDate)}</span> or
          {curve.constrainingMaterial.itemCount === 1 ? " the missing item" : ` ${curve.constrainingMaterial.itemCount} missing items`} may not be ready in time.
        </p>
      ) : null}

      {/* React events bubble through the dialog's portal to the card; stop
          them here so closing or clicking inside the dialog never navigates. */}
      <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
        <Dialog open={zoomed} onOpenChange={setZoomed}>
          <DialogContent className="max-w-3xl">
            <DialogTitle>{curve.situationTitle}</DialogTitle>
            <div className="text-[11px] leading-snug text-[var(--text-muted)]">{metaLine(situation)}</div>
            <ReadinessChart curve={curve} heightClass="h-[300px]" />
            {curve.lateness ? <LatenessLine lateness={curve.lateness} /> : null}
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}

function metaLine(situation: PlanningSituation): string {
  // The same counts as the Overview headline and Reconcile (`skuCounts`).
  const { missing, toDecide } = skuCounts(situation);
  const parts = [
    `${missing} product${missing === 1 ? "" : "s"} missing`,
    toDecide > 0 ? `${toDecide} still to decide` : undefined,
    situation.productionWindow ? `builds from ${fmtDateShort(situation.productionWindow.start)}` : undefined,
  ].filter((p): p is string => Boolean(p));
  return parts.join(" · ");
}
