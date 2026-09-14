/**
 * The pieces of capacity planning around the chart (V2 §46, PRD §14.4).
 *
 * - `ModeToggle`: Before (no scenario) / After (the scenario).
 * - `PullForwardSlider`: one direction only — pull forward up to N weeks.
 * - `MonthCapacity`: the selected month's cap and weekend shift.
 * - `FocusTiles`: four figures for the focused month.
 * - `PullForwardPanel`: the SKUs moving in or out of that month, and what to
 *   order for them by when.
 *
 * Every figure arrives from `lib/situations/capacity-plan.ts`; these only
 * lay it out and write overrides to the capacity scenario store.
 */

"use client";

import { useRef, useState, type ReactNode } from "react";
import { ChevronRight, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useCapacityScenarioStore } from "@/stores/capacity-scenario-store";
import {
  EXTRA_SHIFT_HOURS,
  extraShiftHoursFor,
  lineMonthKey,
  resolveCapacityEntry,
  weekendDaysIn,
  type CapacityEntry,
  type CapacityPlanCell,
  type FocusMonth,
  type ProcurementUrgency,
  type PullForwardMonthPlan,
  type PullForwardSku,
} from "@/lib/situations/capacity-plan";
import { MAX_MOVE_WEEKS } from "@/lib/situations/pull-forward";
import { weeksLeftLabel } from "@/lib/situations/deadline";
import { formatMonthLabel } from "@/lib/dataset/periods";
import { fmtDateShort, fmtHours, fmtNum, fmtUnits } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";
import { NewBadge } from "@/components/shared/new-badge";

export type ChartMode = "before" | "after";

/**
 * One labelled lever in the control bar. Every group has the same label row
 * and the same 32px control row, so the line picker, the toggle, the slider
 * and the month's capacity sit on one baseline instead of four.
 */
export function ControlGroup({
  label,
  aside,
  className,
  children,
}: {
  label: string;
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <div className="flex h-4 items-baseline justify-between gap-3 text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--text-muted)]">
        <span className="truncate">{label}</span>
        {aside ? <span className="flex-none normal-case tracking-normal">{aside}</span> : null}
      </div>
      <div className="flex h-8 min-w-0 items-center gap-2">{children}</div>
    </div>
  );
}

/**
 * The pressed state uses the accent with on-accent text. It used to paint
 * `--text-primary` behind `--text-on-accent`, which in the dark theme is
 * near-white on near-white — the pressed label vanished.
 */
export function ModeToggle({ mode, onChange }: { mode: ChartMode; onChange: (m: ChartMode) => void }) {
  return (
    <div
      className="flex h-8 flex-none items-stretch rounded-[var(--radius-sm)] border border-[var(--border)] p-0.5 text-[12px]"
      role="group"
      aria-label="Show the line before or after this scenario"
    >
      {(["before", "after"] as const).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onChange(m)}
          aria-pressed={mode === m}
          className={cn(
            "rounded-[3px] px-3 py-1 font-medium capitalize transition-colors",
            mode === m
              ? "bg-[var(--accent)] text-[var(--text-on-accent)]"
              : "text-[var(--text-secondary)] hover:bg-[var(--interaction-hover)]"
          )}
          style={{ transitionDuration: "var(--duration-fast)" }}
        >
          {m}
        </button>
      ))}
    </div>
  );
}

export function PullForwardSlider({
  weeks,
  disabled,
  onChange,
}: {
  weeks: number;
  disabled?: boolean;
  onChange: (weeks: number) => void;
}) {
  const readout = weeks > 0 ? `up to ${weeks} wks` : "Off";
  return (
    <ControlGroup
      label="Pull forward"
      className="xl:w-[220px]"
      aside={
        <span
          className={cn(
            "text-[11.5px] font-medium tabular-nums",
            weeks > 0 ? "text-[var(--state-scenario)]" : "text-[var(--text-secondary)]"
          )}
        >
          {readout}
        </span>
      }
    >
      <input
        type="range"
        min={0}
        max={MAX_MOVE_WEEKS}
        step={1}
        value={weeks}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[var(--accent)] disabled:opacity-40"
        aria-label="Pull production forward, in weeks"
        aria-valuetext={readout}
      />
    </ControlGroup>
  );
}

/**
 * "Jun 27 capacity: [501] h · + weekend shift (+64h)" — for the selected month
 * only. The caller keys this by line and month, so a half-typed value or a
 * pending confirm can never follow the planner to another month.
 */
export function MonthCapacity({
  lineId,
  cell,
  mode,
  scenarioId,
  onEdit,
}: {
  lineId: string;
  /** The scenario's cell; Before shows its Line_Capacity figure only. */
  cell: CapacityPlanCell;
  mode: ChartMode;
  scenarioId?: string;
  /** Called after any edit, so the chart can switch to After. */
  onEdit: () => void;
}) {
  const setAvailableHours = useCapacityScenarioStore((s) => s.setAvailableHours);
  const setExtraShift = useCapacityScenarioStore((s) => s.setExtraShift);
  const clearAdjustment = useCapacityScenarioStore((s) => s.clearAdjustment);
  const [pending, setPending] = useState<number | null>(null);

  const month = formatMonthLabel(cell.period);
  const key = lineMonthKey(lineId, cell.period);
  const room = cell.calendarMaxHours - cell.plannedAvailableHours;
  const shiftHours = cell.extraShiftOn ? cell.extraShiftHours : Math.min(extraShiftHoursFor(cell.period), Math.max(0, room));
  const overridden = Math.abs(cell.plannedAvailableHours - cell.baselineAvailableHours) >= 0.5;

  // Before is the line with no scenario: no edited cap, no shift, no "was".
  if (mode === "before" || !scenarioId) {
    return (
      <ControlGroup label={`${month} capacity`}>
        <span className="text-[13px] font-medium tabular-nums text-[var(--text-primary)]">
          {fmtHours(cell.baselineAvailableHours)}
        </span>
        {scenarioId ? (
          <button
            type="button"
            onClick={onEdit}
            className="text-[12px] text-[var(--text-secondary)] underline-offset-2 hover:text-[var(--text-primary)] hover:underline"
          >
            Edit in After
          </button>
        ) : null}
      </ControlGroup>
    );
  }

  const write = (hours: number) => {
    setPending(null);
    setAvailableHours(scenarioId, lineId, cell.period, hours);
    onEdit();
  };

  const onEntry = (entry: CapacityEntry) => {
    if (entry.kind === "unchanged") return;
    if (entry.kind === "reset") {
      clearAdjustment(scenarioId, "availableHours", key);
      onEdit();
    } else if (entry.kind === "confirm") setPending(entry.hours);
    else write(entry.hours);
  };

  if (pending !== null) {
    return (
      <ControlGroup label={`${month} capacity`}>
        <span className="min-w-0 truncate text-[12px] tabular-nums text-[var(--risk-warning)]" role="alert">
          {fmtHours(pending)} is below {month}&apos;s {fmtHours(cell.formalHours)} formal plan
        </span>
        <button
          type="button"
          onClick={() => write(pending)}
          className="h-7 flex-none rounded-[var(--radius-sm)] border border-[var(--risk-warning)] px-2.5 text-[12px] font-medium text-[var(--risk-warning)] hover:bg-[var(--risk-warning-soft)]"
        >
          Set {fmtHours(pending)}
        </button>
        <button
          type="button"
          onClick={() => setPending(null)}
          className="h-7 flex-none rounded-[var(--radius-sm)] px-2 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--interaction-hover)]"
        >
          Keep {fmtHours(cell.plannedAvailableHours)}
        </button>
      </ControlGroup>
    );
  }

  return (
    <ControlGroup
      label={`${month} capacity`}
      aside={
        overridden ? (
          <span className="text-[11.5px] tabular-nums text-[var(--state-scenario)]">
            was {fmtHours(cell.baselineAvailableHours)}
          </span>
        ) : null
      }
    >
      <HoursInput label={`${month} available hours`} cell={cell} edited={overridden} onEntry={onEntry} />
      <span className="flex-none text-[12px] text-[var(--text-muted)]">h</span>
      {overridden ? (
        <button
          type="button"
          onClick={() => clearAdjustment(scenarioId, "availableHours", key)}
          aria-label={`Reset ${month} available hours`}
          className="flex size-6 flex-none items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:bg-[var(--interaction-hover)] hover:text-[var(--text-primary)]"
        >
          <X className="size-3.5" />
        </button>
      ) : null}
      <button
        type="button"
        role="switch"
        aria-checked={cell.extraShiftOn}
        disabled={!cell.extraShiftOn && room <= 0}
        onClick={() => {
          setExtraShift(scenarioId, lineId, cell.period, !cell.extraShiftOn);
          onEdit();
        }}
        title={`One ${EXTRA_SHIFT_HOURS}-hour shift on each Saturday and Sunday of ${month} (${weekendDaysIn(cell.period)} days)`}
        className={cn(
          "ml-1 inline-flex h-8 flex-none items-center gap-2 rounded-full border px-3 text-[12px] font-medium transition-colors disabled:opacity-40",
          cell.extraShiftOn
            ? "border-[var(--state-scenario)] bg-[var(--state-scenario-soft)] text-[var(--state-scenario)]"
            : "border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--interaction-hover)]"
        )}
        style={{ transitionDuration: "var(--duration-fast)" }}
      >
        <span
          className={cn("size-2 rounded-full", cell.extraShiftOn ? "bg-[var(--state-scenario)]" : "bg-[var(--state-unknown)]")}
          aria-hidden
        />
        + weekend shift (+{fmtHours(shiftHours)})
      </button>
    </ControlGroup>
  );
}

/**
 * A whole-hours box. The typed text only exists while the box has focus; the
 * rest of the time it shows the cell's cap. It used to mirror `value` through
 * an effect and commit on blur, so a single instance was reused across months
 * and whatever was in the box — a half-typed number, an empty string that
 * parsed as 0 — was written on blur. Commit rules live in
 * `resolveCapacityEntry`; Escape abandons the edit.
 */
function HoursInput({
  label,
  cell,
  edited,
  onEntry,
}: {
  label: string;
  cell: CapacityPlanCell;
  edited: boolean;
  onEntry: (entry: CapacityEntry) => void;
}) {
  const current = String(Math.round(cell.plannedAvailableHours));
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);

  return (
    <Input
      value={draft ?? current}
      onFocus={(e) => {
        cancelled.current = false;
        setDraft(current);
        e.target.select();
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const text = draft;
        setDraft(null);
        if (cancelled.current || text === null) return;
        onEntry(resolveCapacityEntry(text, cell));
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          cancelled.current = true;
          (e.target as HTMLInputElement).blur();
        }
      }}
      inputMode="numeric"
      aria-label={label}
      className={cn(
        "h-8 w-[72px] flex-none text-right tabular-nums",
        edited && "border-[var(--state-scenario)] text-[var(--state-scenario)]"
      )}
    />
  );
}

type TileTone = "neutral" | "positive" | "warning" | "critical";

// `color/opacity` resolves through color-mix, so it works on a CSS variable.
const TILE_BOX: Record<TileTone, string> = {
  neutral: "border-[var(--border)] bg-[var(--surface)]",
  positive: "border-[var(--risk-positive)]/30 bg-[var(--risk-positive)]/[0.06]",
  warning: "border-[var(--risk-warning)]/40 bg-[var(--risk-warning)]/[0.08]",
  critical: "border-[var(--risk-critical)]/30 bg-[var(--risk-critical)]/[0.06]",
};

const TONE_TEXT: Record<TileTone, string> = {
  neutral: "text-[var(--text-primary)]",
  positive: "text-[var(--risk-positive)]",
  warning: "text-[var(--risk-warning)]",
  critical: "text-[var(--risk-critical)]",
};

interface Tile {
  label: string;
  value: string;
  tone: TileTone;
  sub?: string;
}

export function FocusTiles({ focus, mode }: { focus: FocusMonth; mode: ChartMode }) {
  const month = formatMonthLabel(focus.period);
  const before = focus.overflowBeforeHours;
  const after = focus.overflowAfterHours;
  const isAfter = mode === "after";

  const tiles: Tile[] = [
    {
      label: `${month} · over capacity`,
      value: isAfter ? `${fmtHours(before)} → ${fmtHours(after)}` : fmtHours(before),
      tone: before <= 0.5 ? "neutral" : !isAfter ? "critical" : after <= 0.5 ? "positive" : after < before - 0.5 ? "warning" : "critical",
    },
    // A month that only receives builds did not pull anything forward; say
    // what it did instead of headlining a zero.
    focus.movedHours <= 0.5 && focus.movedInHours > 0.5
      ? {
          label: `Built in ${month} from later`,
          value: `+${fmtHours(focus.movedInHours)}`,
          tone: "neutral",
          sub: "Nothing pulled out of this month",
        }
      : {
          label: `Pulled out of ${month}`,
          value: fmtHours(focus.movedHours),
          tone: focus.movedHours > 0.5 ? "positive" : "neutral",
          sub: focus.movedInHours > 0.5 ? `+${fmtHours(focus.movedInHours)} built here from later` : undefined,
        },
    {
      label: "Still over capacity",
      value: fmtHours(after),
      tone: after > 0.5 ? "critical" : before > 0.5 ? "positive" : "neutral",
    },
    {
      label: "Units secured",
      value: focus.unitsSecured !== undefined && focus.unitsSecured > 0.5 ? fmtUnits(focus.unitsSecured, true) : "—",
      tone: focus.unitsSecured !== undefined && focus.unitsSecured > 0.5 ? "positive" : "neutral",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {tiles.map((t) => (
        <div key={t.label} className={cn("min-w-0 rounded-[var(--radius-sm)] border px-3 py-2.5", TILE_BOX[t.tone])}>
          <div
            className="truncate text-[10.5px] font-medium uppercase leading-tight tracking-wide text-[var(--text-muted)]"
            title={t.label}
          >
            {t.label}
          </div>
          <div className={cn("mt-1.5 text-[17px] font-semibold leading-none tabular-nums sm:text-[19px]", TONE_TEXT[t.tone])}>
            {t.value}
          </div>
          {t.sub ? <div className="mt-1 truncate text-[11px] text-[var(--text-secondary)]">{t.sub}</div> : null}
        </div>
      ))}
    </div>
  );
}

const URGENCY_PILL: Record<ProcurementUrgency, string> = {
  critical: "border-[var(--risk-critical)] bg-[var(--risk-critical-soft)] text-[var(--risk-critical)]",
  warning: "border-[var(--risk-warning)] bg-[var(--risk-warning-soft)] text-[var(--risk-warning)]",
  positive: "border-[var(--risk-positive)] bg-[var(--risk-positive-soft)] text-[var(--risk-positive)]",
};

/** Component · quantity · new order-by · previous date — shared by the header row and every component row. */
const COMPONENT_GRID = "sm:grid-cols-[minmax(0,1fr)_110px_190px_90px]";

/**
 * SKU · units and hours · from → to. Fixed right-hand columns on desktop so
 * every row's figures line up; on a phone the name takes its own line and the
 * two figures sit beneath it, left and right.
 */
const SKU_ROW_GRID = "sm:grid-cols-[minmax(0,1fr)_160px_136px]";

/** "Pull-forward plan · Jul 27": SKUs moving, and what to order for them by when. */
export function PullForwardPanel({ plan, mode }: { plan: PullForwardMonthPlan; mode: ChartMode }) {
  const month = formatMonthLabel(plan.period);
  return (
    <section className="mt-5 border-t border-[var(--border)] pt-4" aria-label={`Pull-forward plan for ${month}`}>
      <h3 className="text-[12.5px] font-medium text-[var(--text-primary)]">Pull-forward plan · {month}</h3>
      {plan.skus.length === 0 ? (
        <p className="mt-1.5 text-[12px] tabular-nums text-[var(--text-secondary)]">
          {mode === "before" ? "Before the scenario nothing moves." : `Nothing moves in or out of ${month}.`}{" "}
          <span className="text-[var(--text-muted)]">
            {fmtHours(plan.committedHours)} formal · {fmtHours(plan.carryForwardHours)} carry-forward ·{" "}
            {fmtHours(plan.capacityHours)} capacity
          </span>
        </p>
      ) : (
        <ul className="mt-2 flex flex-col">
          {plan.skus.map((sku) => (
            <SkuRow key={`${sku.situationId}:${sku.candidateId}:${sku.fromPeriod}:${sku.toPeriod}`} sku={sku} />
          ))}
        </ul>
      )}
    </section>
  );
}

function SkuRow({ sku }: { sku: PullForwardSku }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="border-b border-[var(--border)] last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          "grid w-full grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-1 py-2 text-left",
          SKU_ROW_GRID
        )}
      >
        <span className="col-span-2 flex min-w-0 items-baseline gap-1.5 sm:col-span-1">
          <ChevronRight
            className={cn("size-3.5 flex-none self-center text-[var(--text-muted)] transition-transform", open && "rotate-90")}
            aria-hidden
          />
          <span className="min-w-0 truncate text-[12.5px] font-medium text-[var(--text-primary)]" title={sku.itemName}>
            {sku.itemName}
          </span>
          {sku.isNewThisSeason ? <NewBadge className="self-center" /> : null}
          <span className="hidden min-w-0 truncate text-[11.5px] text-[var(--text-muted)] sm:inline" title={sku.programme}>
            {sku.programme}
          </span>
        </span>
        <span className="whitespace-nowrap pl-5 text-[12px] tabular-nums text-[var(--text-secondary)] sm:pl-0 sm:text-right">
          {sku.units !== undefined ? `${fmtUnits(sku.units, true)} · ` : ""}
          {fmtHours(sku.hours)}
        </span>
        <span className="whitespace-nowrap text-right text-[12px] font-medium tabular-nums text-[var(--state-scenario)]">
          {formatMonthLabel(sku.fromPeriod)} → {formatMonthLabel(sku.toPeriod)}
        </span>
      </button>
      {open ? (
        <div className="pb-2.5 pl-5">
          <p className="text-[11.5px] text-[var(--text-muted)] sm:hidden">{sku.programme}</p>
          {sku.components.length === 0 ? (
            <p className="text-[11.5px] text-[var(--text-muted)]">{sku.componentsNote}</p>
          ) : (
            <div className="overflow-hidden rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)]">
              <div
                className={cn(
                  "hidden gap-x-4 border-b border-[var(--border)] bg-[var(--surface-sunken)] px-3 py-1.5 text-[10.5px] font-medium uppercase tracking-[0.06em] text-[var(--text-muted)] sm:grid",
                  COMPONENT_GRID
                )}
              >
                <span>Component to order</span>
                <span className="text-right">Quantity</span>
                <span>Order by</span>
                <span>Was</span>
              </div>
              <ul>
                {sku.components.map((c) => (
                  <li
                    key={c.materialId}
                    className={cn(
                      "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 border-b border-[var(--border)] px-3 py-2 text-[12px] tabular-nums last:border-b-0",
                      COMPONENT_GRID
                    )}
                  >
                    <span className="min-w-0 truncate text-[var(--text-primary)]">{c.materialName}</span>
                    <span className="whitespace-nowrap text-right text-[var(--text-secondary)]">
                      {fmtNum(c.quantity)} {c.uom}
                    </span>
                    {c.waitNote ? (
                      <span className="col-span-2 text-[11.5px] text-[var(--text-muted)]">{c.waitNote}</span>
                    ) : (
                      <>
                        <span className="flex items-center gap-2 whitespace-nowrap">
                          <span className="font-medium text-[var(--text-primary)]">{fmtDateShort(c.orderBy)}</span>
                          <span
                            className={cn(
                              "rounded-full border px-1.5 py-[2px] text-[10.5px] font-medium leading-none",
                              URGENCY_PILL[c.urgency]
                            )}
                          >
                            {weeksLeftLabel(c.weeksLeft)}
                          </span>
                        </span>
                        <span className="whitespace-nowrap text-[var(--text-muted)]">
                          <span className="sm:hidden">was </span>
                          <span className="line-through decoration-[var(--text-muted)]/60">{fmtDateShort(c.wasOrderBy)}</span>
                        </span>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : null}
    </li>
  );
}
