/**
 * Demand planning (V2 §13, §42).
 *
 * One programme at a time: last year, this year's target, the formal plan,
 * and whether the items missing from the plan explain the difference — product
 * family by product family. Changing a SKU's units moves its revenue at that SKU's own price,
 * and the family, the total and the gap move with it.
 *
 * Baseline is the situation `useDataset()` already built. The scenario result
 * is derived: `buildSituations` runs again with this programme's volume
 * overrides layered on, and `buildDemandPlan` reads both. Nothing derived is
 * persisted. No capacity here — that is the other tab, with its own scenario.
 */

"use client";

import { useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { useDataset } from "@/components/dataset/dataset-provider";
import { useDatasetStore } from "@/stores/dataset-store";
import { isScenarioDirty, useSituationScenarioStore } from "@/stores/situation-scenario-store";
import { buildSituations } from "@/lib/situations/build";
import { bandTone, buildDemandPlan, describeExplanation, diffDemandPlans } from "@/lib/situations/demand-plan";
import { countAdjustments } from "@/lib/situations/scenario";
import { EMPTY_ADJUSTMENTS } from "@/types/situation";
import { HeroMetric, MetricRow, NotAvailable, Page, SectionRule } from "@/components/shared/page";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils/cn";
import { fmtMoney, fmtPct, fmtUnits } from "@/lib/utils/format";
import { ScenarioToolbar } from "./scenario-toolbar";
import { BAND_TEXT, DemandFamilyTable, fmtSignedPct } from "./demand-family-table";
import { CommitBar } from "./commit-bar";
import { useUnsavedChangesGuard } from "./unsaved-changes-guard";

/** "2026-Halloween" -> "Halloween 2026". */
function seasonLabel(period: string | undefined): string | undefined {
  if (!period) return undefined;
  const m = /^(\d{4})-(.+)$/.exec(period);
  return m ? `${m[2]} ${m[1]}` : period;
}

export function DemandPlanning({ situationId, focusItemId }: { situationId?: string; focusItemId?: string }) {
  const router = useRouter();
  const { dataset, situations, loading } = useDataset();
  const overridesBySituation = useDatasetStore((s) => s.overridesBySituation);

  const scenarios = useSituationScenarioStore((s) => s.scenarios);
  const activeScenarioId = useSituationScenarioStore((s) => s.activeScenarioId);
  const hasHydrated = useSituationScenarioStore((s) => s.hasHydrated);
  const createScenario = useSituationScenarioStore((s) => s.createScenario);
  const duplicateScenario = useSituationScenarioStore((s) => s.duplicateScenario);
  const renameScenario = useSituationScenarioStore((s) => s.renameScenario);
  const deleteScenario = useSituationScenarioStore((s) => s.deleteScenario);
  const resetScenario = useSituationScenarioStore((s) => s.resetScenario);
  const setActiveScenario = useSituationScenarioStore((s) => s.setActiveScenario);
  const clearAdjustment = useSituationScenarioStore((s) => s.clearAdjustment);
  const saveScenario = useSituationScenarioStore((s) => s.saveScenario);
  const discardChanges = useSituationScenarioStore((s) => s.discardChanges);

  // Situations arrive sorted by unresolved value, so the default is the
  // programme with the most business still missing from the plan.
  const baseline = situations.find((s) => s.id === situationId) ?? situations[0];
  const selectedId = baseline?.id;

  const scenariosForSituation = useMemo(
    () =>
      Object.values(scenarios)
        .filter((s) => s.situationId === selectedId)
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)),
    [scenarios, selectedId]
  );

  const rawActive = activeScenarioId ? scenarios[activeScenarioId] : undefined;
  const activeScenario = rawActive?.situationId === selectedId ? rawActive : undefined;

  // Opening a programme shows its own most recent scenario, or makes one — an
  // untouched scenario equals the baseline, so this costs nothing and removes
  // a dead first screen. Guarded by a ref because the store write is async.
  const autoCreatedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!hasHydrated || !selectedId || activeScenario) return;
    const fallback = scenariosForSituation[0];
    if (fallback) {
      setActiveScenario(fallback.id);
      return;
    }
    if (autoCreatedFor.current === selectedId) return;
    autoCreatedFor.current = selectedId;
    createScenario(selectedId, "Scenario 1", new Date().toISOString());
  }, [hasHydrated, selectedId, activeScenario, scenariosForSituation, setActiveScenario, createScenario]);

  const adjustments = activeScenario?.adjustments ?? EMPTY_ADJUSTMENTS;
  const volumeUnits = adjustments.volumeUnits ?? EMPTY_ADJUSTMENTS.volumeUnits;

  // Committed volumes are already in the baseline (through the planner's
  // overrides); the scenario's own values go on top, for this programme only.
  const scenarioSituation = useMemo(
    () =>
      dataset && selectedId
        ? buildSituations(dataset, {
            overridesBySituation,
            volumeOverridesBySituation: { [selectedId]: volumeUnits },
          }).find((s) => s.id === selectedId)
        : undefined,
    [dataset, overridesBySituation, volumeUnits, selectedId]
  );

  const baselinePlan = useMemo(
    () => (dataset && baseline ? buildDemandPlan(dataset, baseline) : undefined),
    [dataset, baseline]
  );
  const scenarioPlan = useMemo(() => {
    const source = scenarioSituation ?? baseline;
    return dataset && source ? buildDemandPlan(dataset, source) : undefined;
  }, [dataset, scenarioSituation, baseline]);
  const changes = useMemo(
    () => (baselinePlan && scenarioPlan ? diffDemandPlans(baselinePlan, scenarioPlan) : []),
    [baselinePlan, scenarioPlan]
  );

  const dirty = isScenarioDirty(activeScenario);
  const { guard, dialog } = useUnsavedChangesGuard({
    dirty,
    scenarioName: activeScenario?.name,
    onSave: () => activeScenario && saveScenario(activeScenario.id),
    onDiscard: () => activeScenario && discardChanges(activeScenario.id),
  });

  if (loading) return <Page>{null}</Page>;
  if (!dataset || !baseline || !baselinePlan || !scenarioPlan) {
    return (
      <Page>
        <NotAvailable title="No programmes to plan" detail="Add Business_Plan rows to plan demand by programme." />
      </Page>
    );
  }

  const currency = scenarioPlan.currency;
  const total = scenarioPlan.total;
  const before = baselinePlan.total;
  const closed = before.remainingGapValue - total.remainingGapValue;
  const planPlusCarry = total.formalValue + total.missing.carryForwardValue;
  const planPlusCarryBefore = before.formalValue + before.missing.carryForwardValue;
  const nowIso = () => new Date().toISOString();

  return (
    <div>
      <ScenarioToolbar
        context={
          <Select
            value={baseline.id}
            onValueChange={(id) =>
              guard(() => router.replace(`/scenario-lab?mode=demand&situation=${encodeURIComponent(id)}`))
            }
          >
            <SelectTrigger className="w-full min-w-0 sm:w-[220px]" aria-label="Programme">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {situations.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
        scenarios={scenariosForSituation}
        activeScenario={activeScenario}
        changeCount={activeScenario ? countAdjustments(activeScenario.adjustments) : 0}
        dirty={dirty}
        onSave={() => activeScenario && saveScenario(activeScenario.id)}
        onDiscard={() => activeScenario && discardChanges(activeScenario.id)}
        onCreate={() =>
          guard(() => createScenario(baseline.id, `Scenario ${scenariosForSituation.length + 1}`, nowIso()))
        }
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

      <Page>
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between lg:gap-10">
          <HeroMetric
            label="Gap to target after carry-forward"
            value={fmtMoney(total.remainingGapValue, currency)}
            tone={bandTone(total.explainedBand)}
            sub={
              Math.abs(closed) >= 1
                ? `This scenario ${closed > 0 ? "closes" : "opens"} ${fmtMoney(Math.abs(closed), currency)} · was ${fmtMoney(before.remainingGapValue, currency)}`
                : "Target, less the formal plan and what is carrying forward"
            }
          />
          <MetricRow
            items={[
              {
                label: "Last year",
                value: fmtMoney(total.lyValue, currency),
                sub: seasonLabel(scenarioPlan.lySeason),
              },
              {
                label: "Target",
                value: fmtMoney(total.targetValue, currency),
                sub: total.targetGrowthPct !== undefined ? `${fmtSignedPct(total.targetGrowthPct)} vs LY` : undefined,
              },
              {
                label: "Formal plan",
                value: fmtMoney(total.formalValue, currency),
                sub: total.planVsLyPct !== undefined ? `${fmtSignedPct(total.planVsLyPct)} vs LY` : undefined,
              },
              {
                label: "Plan + carry-forward",
                value: fmtMoney(planPlusCarry, currency),
                sub:
                  Math.abs(planPlusCarry - planPlusCarryBefore) >= 1
                    ? `was ${fmtMoney(planPlusCarryBefore, currency)}`
                    : `${fmtMoney(total.missing.carryForwardValue, currency)} carrying forward`,
              },
            ]}
          />
        </div>

        <p className={cn("mt-6 text-[13.5px] font-medium", BAND_TEXT[total.explainedBand])}>
          {describeExplanation(total, currency)}
          {before.explainedByCarryPct !== undefined &&
          total.explainedByCarryPct !== undefined &&
          Math.abs(before.explainedByCarryPct - total.explainedByCarryPct) >= 0.005 ? (
            <span className="ml-2 text-[12px] font-medium text-[var(--state-scenario)]">
              was {fmtPct(before.explainedByCarryPct)}
            </span>
          ) : null}
        </p>

        <SectionRule
          label="By family"
          action={
            <span className="text-[11.5px] text-[var(--text-muted)]">Expand a family to change SKU units</span>
          }
        />
        <DemandFamilyTable
          plan={scenarioPlan}
          baselinePlan={baselinePlan}
          scenarioId={activeScenario?.id}
          adjustments={adjustments}
          focusItemId={focusItemId}
        />

        {changes.length > 0 ? (
          <>
            <SectionRule label="What changes" />
            <ul className="flex flex-col">
              {changes.map((c) => (
                <li
                  key={c.candidateId}
                  className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-[var(--border)] py-2 last:border-b-0"
                >
                  <span className="min-w-0 truncate text-[12.5px] text-[var(--text-primary)]">{c.itemName}</span>
                  <span className="flex flex-none items-center gap-3 text-[12px] tabular-nums text-[var(--text-secondary)]">
                    {fmtUnits(c.unitsBefore)} → {fmtUnits(c.unitsAfter, true)}
                    <span className="font-medium text-[var(--state-scenario)]">
                      {c.valueDelta >= 0 ? "+" : "−"}
                      {fmtMoney(Math.abs(c.valueDelta), currency)}
                    </span>
                    {activeScenario ? (
                      <button
                        type="button"
                        onClick={() => clearAdjustment(activeScenario.id, "volumeUnits", c.candidateId)}
                        aria-label={`Undo ${c.itemName}`}
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

        <CommitBar baseline={baseline} scenario={scenarioSituation ?? baseline} adjustments={adjustments} />
      </Page>
      {dialog}
    </div>
  );
}
