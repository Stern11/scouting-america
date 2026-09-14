/**
 * Capacity planning (V2 §46, PRD §14).
 *
 * One line, one graph. The load is everything the plant must build on that
 * line — the formal plan plus every programme's carry-forward — against its
 * monthly capacity. The levers sit together above the graph: the line, Before
 * / After, how far builds may be pulled forward, and the selected month's cap
 * and weekend shift. Clicking a bar selects that month; below the graph it
 * shows which SKUs move in or out and what to order for them by when. Cutting
 * a brand × pack is the last resort and stays folded away.
 *
 * Before is the line with no scenario — the same hours the Overview shows for
 * that line-month. After is the scenario. The toggle drives the chart, the
 * tiles and the pull-forward plan alike.
 *
 * Its own scenario (`stores/capacity-scenario-store.ts`), separate from
 * demand planning's. Every number is recomputed by `buildCapacityPlan`.
 */

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { useDataset } from "@/components/dataset/dataset-provider";
import { isCapacityScenarioDirty, useCapacityScenarioStore } from "@/stores/capacity-scenario-store";
import {
  buildCapacityPlan,
  countCapacityAdjustments,
  describeCapacityChanges,
  describeLineHistory,
  EMPTY_CAPACITY_ADJUSTMENTS,
  focusMonth,
  fmtUtilization,
  lineChartMonths,
  pullForwardPlanForMonth,
  shortLineName,
  worstPeriod,
} from "@/lib/situations/capacity-plan";
import { formatMonthLabel } from "@/lib/dataset/periods";
import { cn } from "@/lib/utils/cn";
import { fmtHours, fmtMoney, fmtUnits } from "@/lib/utils/format";
import { HeroMetric, MetricRow, NotAvailable, Page, SectionRule, type MetricItem } from "@/components/shared/page";
import { LoadCapacityChart } from "@/components/shared/load-capacity-chart";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { MonthKey } from "@/types/dataset";
import { ScenarioToolbar } from "./scenario-toolbar";
import {
  ControlGroup,
  FocusTiles,
  ModeToggle,
  MonthCapacity,
  PullForwardPanel,
  PullForwardSlider,
  type ChartMode,
} from "./capacity-focus";
import { useUnsavedChangesGuard } from "./unsaved-changes-guard";

export function CapacityPlanning() {
  const { dataset, situations, loading } = useDataset();

  const scenarios = useCapacityScenarioStore((s) => s.scenarios);
  const activeScenarioId = useCapacityScenarioStore((s) => s.activeScenarioId);
  const hasHydrated = useCapacityScenarioStore((s) => s.hasHydrated);
  const createScenario = useCapacityScenarioStore((s) => s.createScenario);
  const duplicateScenario = useCapacityScenarioStore((s) => s.duplicateScenario);
  const renameScenario = useCapacityScenarioStore((s) => s.renameScenario);
  const deleteScenario = useCapacityScenarioStore((s) => s.deleteScenario);
  const resetScenario = useCapacityScenarioStore((s) => s.resetScenario);
  const setActiveScenario = useCapacityScenarioStore((s) => s.setActiveScenario);
  const clearAdjustment = useCapacityScenarioStore((s) => s.clearAdjustment);
  const saveScenario = useCapacityScenarioStore((s) => s.saveScenario);
  const discardChanges = useCapacityScenarioStore((s) => s.discardChanges);
  const setMoveWeeks = useCapacityScenarioStore((s) => s.setMoveWeeks);

  const [plant, setPlant] = useState<string | undefined>();
  const [lineId, setLineId] = useState<string | undefined>();
  const [mode, setMode] = useState<ChartMode>("after");
  const [focus, setFocus] = useState<MonthKey | undefined>();

  const ordered = useMemo(
    () => Object.values(scenarios).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)),
    [scenarios]
  );
  const activeScenario = activeScenarioId ? scenarios[activeScenarioId] : undefined;

  const autoCreated = useRef(false);
  useEffect(() => {
    if (!hasHydrated || activeScenario) return;
    const fallback = ordered[0];
    if (fallback) {
      setActiveScenario(fallback.id);
      return;
    }
    if (autoCreated.current) return;
    autoCreated.current = true;
    createScenario("Capacity scenario 1", new Date().toISOString());
  }, [hasHydrated, activeScenario, ordered, setActiveScenario, createScenario]);

  const adjustments = activeScenario?.adjustments ?? EMPTY_CAPACITY_ADJUSTMENTS;
  const currency = dataset?.metadata.currency ?? "USD";

  const baselinePlan = useMemo(
    () => (dataset ? buildCapacityPlan(dataset, situations, EMPTY_CAPACITY_ADJUSTMENTS, plant) : undefined),
    [dataset, situations, plant]
  );
  const plan = useMemo(
    () => (dataset ? buildCapacityPlan(dataset, situations, adjustments, plant) : undefined),
    [dataset, situations, adjustments, plant]
  );
  const changes = useMemo(
    () => (plan ? describeCapacityChanges(plan, adjustments, currency) : []),
    [plan, adjustments, currency]
  );

  const dirty = isCapacityScenarioDirty(activeScenario);
  const { guard, dialog } = useUnsavedChangesGuard({
    dirty,
    scenarioName: activeScenario?.name,
    onSave: () => activeScenario && saveScenario(activeScenario.id),
    onDiscard: () => activeScenario && discardChanges(activeScenario.id),
  });

  if (loading) return <Page>{null}</Page>;
  if (!dataset || !plan || !baselinePlan) {
    return (
      <Page>
        <NotAvailable title="No planning data loaded" />
      </Page>
    );
  }

  const nowIso = () => new Date().toISOString();
  const toolbar = (
    <ScenarioToolbar
      context={
        plan.plants.length > 1 ? (
          <Select value={plan.plant} onValueChange={setPlant}>
            <SelectTrigger className="w-[160px]" aria-label="Plant">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {plan.plants.map((p) => (
                <SelectItem key={p} value={p}>
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <span className="truncate text-[13px] text-[var(--text-secondary)]">
            <span className="font-medium text-[var(--text-primary)]">{plan.plant ?? "Plant"}</span> · all
            programmes
          </span>
        )
      }
      scenarios={ordered}
      activeScenario={activeScenario}
      changeCount={activeScenario ? countCapacityAdjustments(activeScenario.adjustments) : 0}
      dirty={dirty}
      onSave={() => activeScenario && saveScenario(activeScenario.id)}
      onDiscard={() => activeScenario && discardChanges(activeScenario.id)}
      onCreate={() => guard(() => createScenario(`Capacity scenario ${ordered.length + 1}`, nowIso()))}
      onSelect={(id) => guard(() => setActiveScenario(id))}
      onRename={(name) => activeScenario && renameScenario(activeScenario.id, name)}
      onDuplicate={() => activeScenario && duplicateScenario(activeScenario.id, nowIso())}
      onResetAll={() => activeScenario && resetScenario(activeScenario.id)}
      onDelete={() => {
        if (!activeScenario) return;
        if (typeof window !== "undefined" && !window.confirm(`Delete "${activeScenario.name}"?`)) return;
        deleteScenario(activeScenario.id);
      }}
    />
  );

  if (!plan.available) {
    return (
      <div>
        {toolbar}
        <Page>
          <NotAvailable title="Capacity cannot be planned yet" detail={plan.unavailableReason} />
        </Page>
        {dialog}
      </div>
    );
  }

  // One switch decides what every figure reads: Before is the baseline plan
  // with no overrides at all; After is the scenario, shown against it.
  const isAfter = mode === "after";
  const s = isAfter ? plan.summary : baselinePlan.summary;
  const b = baselinePlan.summary;
  const defaultLineId = [...baselinePlan.lines].sort(
    (x, y) => y.overCapacityHours - x.overCapacityHours || y.peakUtilization - x.peakUtilization
  )[0]?.lineId;
  const line = plan.lines.find((l) => l.lineId === lineId) ?? plan.lines.find((l) => l.lineId === defaultLineId);
  const baselineLine = baselinePlan.lines.find((l) => l.lineId === line?.lineId);
  // One switch decides what the chart, the tiles and the pull-forward plan read.
  const shownLine = mode === "before" ? baselineLine : line;
  const period =
    focus && line?.cells.some((c) => c.period === focus) ? focus : baselineLine ? worstPeriod(baselineLine) : undefined;
  const focused = shownLine && baselineLine && period ? focusMonth(baselineLine, shownLine, period) : undefined;
  const monthPlan =
    shownLine && period ? pullForwardPlanForMonth(shownLine, period, situations, dataset.metadata.planningNow) : undefined;
  const focusedCell = line?.cells.find((c) => c.period === period);
  const chartMonths = shownLine ? lineChartMonths(shownLine) : [];

  const peakChanged = isAfter && s.peak && b.peak && Math.abs(s.peak.utilization - b.peak.utilization) >= 0.005;
  const supportItems: MetricItem[] = [
    {
      label: "Peak utilisation",
      value: s.peak ? (peakChanged && b.peak ? `${fmtUtilization(b.peak.utilization)} → ${fmtUtilization(s.peak.utilization)}` : fmtUtilization(s.peak.utilization)) : "—",
      tone: s.peak && s.peak.utilization > 1 ? "critical" : "neutral",
      sub: s.peak ? `${shortLineName(s.peak.lineName)} · ${formatMonthLabel(s.peak.period)}` : undefined,
    },
  ];
  if (isAfter && s.unitsNotSupplied > 0.5) {
    supportItems.push({
      label: "Supply cut",
      value: fmtUnits(s.unitsNotSupplied, true),
      tone: "warning",
      sub: `${fmtMoney(s.revenueAtRisk, currency)} at risk`,
    });
  }

  const onEdit = () => setMode("after");

  return (
    <div>
      {toolbar}
      <Page>
        {/* Hero and its supporting figure read together, not from opposite edges of the page. */}
        <div className="flex flex-wrap items-end gap-x-14 gap-y-5">
          <HeroMetric
            label="Over capacity"
            value={
              isAfter && Math.abs(s.overCapacityHours - b.overCapacityHours) > 0.5
                ? `${fmtHours(b.overCapacityHours)} → ${fmtHours(s.overCapacityHours)}`
                : fmtHours(s.overCapacityHours)
            }
            tone={s.overCapacityHours > 0.5 ? "critical" : "positive"}
            sub={`${plan.lines.length} lines · all programmes`}
          />
          <MetricRow items={supportItems} />
        </div>
        {plan.unmappedCarryForwardUnits > 0.5 ? (
          <p className="mt-3 text-[12px] text-[var(--text-muted)]">
            {fmtUnits(plan.unmappedCarryForwardUnits, true)} carrying forward have no line mapping and are not in these
            hours.
          </p>
        ) : null}

        {line && baselineLine && shownLine ? (
          <>
            <SectionRule label="Load vs capacity" />

            {/* The levers, together and each labelled, sharing one baseline:
                line · view · pull forward · the selected month's capacity. */}
            <div className="mb-4 grid grid-cols-1 gap-x-8 gap-y-4 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 sm:grid-cols-2 xl:flex xl:flex-wrap xl:items-start">
              <ControlGroup label="Line">
                <Select
                  value={line.lineId}
                  onValueChange={(id) => {
                    setLineId(id);
                    setFocus(undefined);
                  }}
                >
                  <SelectTrigger className="h-8 w-full xl:w-[240px]" aria-label="Line">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {plan.lines.map((l) => (
                      <SelectItem key={l.lineId} value={l.lineId}>
                        {l.lineName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </ControlGroup>
              <ControlGroup label="View">
                <ModeToggle mode={mode} onChange={setMode} />
              </ControlGroup>
              <PullForwardSlider
                weeks={line.moveWeeks}
                disabled={!activeScenario}
                onChange={(weeks) => {
                  if (!activeScenario) return;
                  setMoveWeeks(activeScenario.id, line.lineId, weeks);
                  onEdit();
                }}
              />
              {focusedCell ? (
                <MonthCapacity
                  key={`${line.lineId}::${focusedCell.period}`}
                  lineId={line.lineId}
                  cell={focusedCell}
                  mode={mode}
                  scenarioId={activeScenario?.id}
                  onEdit={onEdit}
                />
              ) : null}
            </div>

            {focused ? <FocusTiles focus={focused} mode={mode} /> : null}

            <div className="mt-5">
              <EditedCapacityMarkers months={chartMonths} selected={period} onSelect={setFocus} />
              <LoadCapacityChart
                months={chartMonths}
                selected={period}
                onSelect={setFocus}
                labels={{ committed: "Formal plan", added: "Carry-forward", movedIn: "Pulled forward" }}
              />
            </div>

            {monthPlan ? <PullForwardPanel plan={monthPlan} mode={mode} /> : null}

            <p className="mt-4 text-[12px] text-[var(--text-muted)]">
              {line.history
                ? describeLineHistory(line.history)
                : plan.historyAvailable
                  ? "No Line_History rows for this line."
                  : "Add Line_History to see downtime, overtime and late arrivals."}
            </p>
          </>
        ) : null}

        {changes.length > 0 ? (
          <>
            <SectionRule label="What changes" />
            <ul className="flex flex-col">
              {changes.map((c) => (
                <li
                  key={`${c.category}:${c.key}`}
                  className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-[var(--border)] py-2 last:border-b-0"
                >
                  <span className="min-w-0 text-[12.5px] text-[var(--text-primary)]">{c.label}</span>
                  <span className="flex flex-none items-center gap-3 text-[12px] tabular-nums">
                    <span className="font-medium text-[var(--state-scenario)]">{c.detail}</span>
                    {activeScenario ? (
                      <button
                        type="button"
                        onClick={() => clearAdjustment(activeScenario.id, c.category, c.key)}
                        aria-label={`Undo ${c.label}`}
                        className="flex size-6 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:bg-[var(--interaction-hover)] hover:text-[var(--text-primary)]"
                      >
                        <X className="size-3.5" />
                      </button>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </Page>
      {dialog}
    </div>
  );
}

/**
 * A strip above the chart, one slot per month in the chart's own column
 * layout, naming each month whose capacity the scenario edited — so an edited
 * cap is never only visible as a moved dashed line. Empty in Before.
 */
function EditedCapacityMarkers({
  months,
  selected,
  onSelect,
}: {
  months: ReturnType<typeof lineChartMonths>;
  selected?: MonthKey;
  onSelect: (period: MonthKey) => void;
}) {
  if (!months.some((m) => m.capacityEdited)) return null;
  return (
    <div className="overflow-x-auto">
      {/* Matches LoadCapacityChart: 48px axis gutter, same gaps and min width. */}
      <div className="flex min-w-[340px] gap-1 pl-12 sm:gap-2" aria-label="Months with edited capacity">
        {months.map((m) => (
          <div key={m.period} className="flex min-w-0 flex-1 justify-center">
            {m.capacityEdited ? (
              <button
                type="button"
                onClick={() => onSelect(m.period)}
                title={`${formatMonthLabel(m.period)} capacity edited: ${fmtHours(m.capacityHours)}`}
                className={cn(
                  "inline-flex max-w-full items-center gap-1 truncate rounded-full border px-1 py-px text-[9.5px] font-medium leading-none tabular-nums text-[var(--state-scenario)] sm:px-1.5 sm:text-[10.5px]",
                  m.period === selected
                    ? "border-[var(--state-scenario)] bg-[var(--state-scenario-soft)]"
                    : "border-transparent bg-[var(--state-scenario-soft)]"
                )}
              >
                <span className="size-1.5 flex-none rounded-full bg-[var(--state-scenario)]" aria-hidden />
                <span className="hidden sm:inline">edited</span>
                <span className="sr-only sm:hidden">{formatMonthLabel(m.period)} capacity edited</span>
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
