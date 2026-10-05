"use client";

/**
 * Planning Simulator — what changes if demand, supply timing or the
 * assumptions change?
 *
 * One transition at a time. The levers write scenario state only; the
 * baseline column is rebuilt from the same data and the planner's own
 * decisions, and is never touched. A scenario becomes the plan only when the
 * planner adopts it — and even then the supplier delay stays a what-if.
 */

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowUpRight, Check, RotateCcw, Save, Trash2 } from "lucide-react";
import { useDataset } from "@/components/dataset/dataset-provider";
import { useDatasetStore } from "@/stores/dataset-store";
import { useScenarioStore } from "@/stores/scenario-store";
import { NotAvailable, Page, PageHeader, SectionRule } from "@/components/shared/page";
import { StatusBadge } from "@/components/shared/state-badge";
import { LineageChain } from "@/components/shared/transition-bar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Levers } from "@/components/simulator/levers";
import { ComparisonTable } from "@/components/simulator/comparison";
import { useDecisions } from "@/components/transition/use-decisions";
import { adoptableOverrides, compareScenario, isEmptyAdjustment, scenarioImpactLines } from "@/lib/transitions/scenario";
import { sortForAttention } from "@/lib/transitions/portfolio";
import { fmtDateShort } from "@/lib/utils/format";
import type { ScenarioAdjustments } from "@/types/transition";

const EMPTY: ScenarioAdjustments = {};

export default function SimulatorPage() {
  return (
    <Suspense fallback={<Page>{null}</Page>}>
      <Simulator />
    </Suspense>
  );
}

function Simulator() {
  const { dataset, transitions } = useDataset();
  const overrides = useDatasetStore((s) => s.overridesByTransition);
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const active = useMemo(() => sortForAttention(transitions.filter((t) => t.status !== "COMPLETE")), [transitions]);
  const requested = params.get("transition");
  const transitionId = (requested && transitions.some((t) => t.id === requested) ? requested : active[0]?.id) ?? null;

  const draft = useScenarioStore((s) => (transitionId ? s.drafts[transitionId] : undefined)) ?? EMPTY;
  const saved = useScenarioStore((s) => s.saved);
  const setLever = useScenarioStore((s) => s.setLever);
  const setDraft = useScenarioStore((s) => s.setDraft);
  const resetDraft = useScenarioStore((s) => s.resetDraft);
  const saveScenario = useScenarioStore((s) => s.saveScenario);
  const deleteScenario = useScenarioStore((s) => s.deleteScenario);
  const decisions = useDecisions(transitionId ?? "");
  const [name, setName] = useState("");
  const [adopted, setAdopted] = useState(false);

  const comparison = useMemo(
    () => (dataset && transitionId ? compareScenario(dataset, transitionId, overrides, draft) : undefined),
    [dataset, transitionId, overrides, draft]
  );

  if (!dataset || !transitionId || !comparison) {
    return (
      <Page>
        <PageHeader title="Planning Simulator" />
        <NotAvailable title="No active transitions to simulate" detail="Every transition in this dataset is complete." />
      </Page>
    );
  }

  const { baseline } = comparison;
  const changed = !isEmptyAdjustment(draft);
  const impact = scenarioImpactLines(comparison);
  const savedHere = Object.values(saved).filter((s) => s.transitionId === transitionId);
  const adoptable = adoptableOverrides(draft);

  const choose = (id: string) => {
    const next = new URLSearchParams(params.toString());
    next.set("transition", id);
    setAdopted(false);
    router.replace(`${pathname}?${next}`, { scroll: false });
  };

  return (
    <Page>
      <PageHeader
        title="Planning Simulator"
        subtitle="Move an assumption and see stores, orders and legacy stock respond. The plan itself is untouched."
      />

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Select value={transitionId} onValueChange={choose}>
          <SelectTrigger className="min-w-[280px]" aria-label="Transition">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {active.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <LineageChain predecessors={baseline.lineage.predecessors} successors={baseline.lineage.successors} />
        <StatusBadge status={baseline.status} />
        <Link
          href={`/transitions/${encodeURIComponent(transitionId)}`}
          className="inline-flex items-center gap-1 text-[12.5px] text-[var(--text-muted)] hover:text-[var(--accent)]"
        >
          Open transition <ArrowUpRight className="size-3" />
        </Link>
        <span
          className={
            changed
              ? "ml-auto rounded-full bg-[var(--state-scenario-soft)] px-2.5 py-1 text-[11.5px] font-medium text-[var(--state-scenario)]"
              : "ml-auto rounded-full bg-[var(--surface-sunken)] px-2.5 py-1 text-[11.5px] text-[var(--text-muted)]"
          }
        >
          {changed ? "Scenario — not part of the plan" : "Showing baseline"}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[320px_minmax(0,1fr)]">
        {/* ---------------- levers ---------------- */}
        <aside>
          <SectionRule
            label="Assumptions"
            action={
              changed ? (
                <button
                  type="button"
                  onClick={() => {
                    resetDraft(transitionId);
                    setAdopted(false);
                  }}
                  className="inline-flex items-center gap-1 text-[12px] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                >
                  <RotateCcw className="size-3" /> Reset all
                </button>
              ) : null
            }
          />
          <Levers
            baseline={baseline}
            adjustments={draft}
            onChange={(key, value) => {
              setLever(transitionId, key, value);
              setAdopted(false);
            }}
          />
        </aside>

        {/* ---------------- outcome ---------------- */}
        <div>
          <SectionRule label="Baseline vs scenario" />
          <ComparisonTable comparison={comparison} currency={dataset.metadata.currency} />

          {changed ? (
            <div className="mt-4 rounded-[var(--radius-lg)] border border-[var(--state-scenario)]/30 bg-[var(--state-scenario-soft)] px-4 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--state-scenario)]">Scenario impact</div>
              {impact.length > 0 ? (
                <ul className="mt-1.5 flex flex-wrap gap-x-6 gap-y-1 text-[14px] font-medium text-[var(--text-primary)]">
                  {impact.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-[13px] text-[var(--text-secondary)]">This change does not move any of the outcomes above.</p>
              )}
            </div>
          ) : (
            <p className="mt-4 text-[13px] text-[var(--text-muted)]">
              Try moving the supplier delay two weeks, or setting legacy substitutability to what your stores really see.
            </p>
          )}

          {/* ---------------- decide ---------------- */}
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name this scenario"
              className="w-[220px]"
              aria-label="Scenario name"
              disabled={!changed}
            />
            <Button
              variant="outline"
              disabled={!changed}
              onClick={() => {
                saveScenario(transitionId, name.trim() || `Scenario ${savedHere.length + 1}`, new Date().toISOString());
                setName("");
              }}
            >
              <Save /> Save scenario
            </Button>
            <Button
              disabled={!changed || Object.keys(adoptable).length === 0 || adopted}
              title={draft.inboundDelayWeeks ? "The supplier delay is a what-if about the world, not a decision — it is not adopted." : undefined}
              onClick={() => {
                decisions.override(adoptable, `Adopted simulator assumptions: ${describe(adoptable)}`);
                setAdopted(true);
              }}
            >
              <Check /> {adopted ? "Adopted as plan" : "Adopt as plan"}
            </Button>
            {draft.inboundDelayWeeks ? (
              <span className="text-[11.5px] text-[var(--text-muted)]">Supplier delay stays a what-if.</span>
            ) : null}
          </div>

          {savedHere.length > 0 ? (
            <>
              <SectionRule label="Saved scenarios" />
              <ul className="divide-y divide-[var(--border)] border-y border-[var(--border)]">
                {savedHere.map((s) => {
                  const result = compareScenario(dataset, transitionId, overrides, s.adjustments);
                  return (
                    <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-[13px]">
                      <div className="min-w-0">
                        <div className="font-medium text-[var(--text-primary)]">{s.name}</div>
                        <div className="text-[12px] text-[var(--text-muted)]">
                          {describe(s.adjustments)} · saved {fmtDateShort(s.createdAt)}
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        {result ? (
                          <span className="text-[12px] tabular-nums text-[var(--text-secondary)]">
                            {result.scenarioMetrics.storesAtRisk} at risk · order {result.scenarioMetrics.successorOrder}
                          </span>
                        ) : null}
                        <Button size="sm" variant="ghost" onClick={() => setDraft(transitionId, s.adjustments)}>
                          Load
                        </Button>
                        <button
                          type="button"
                          aria-label={`Delete ${s.name}`}
                          onClick={() => deleteScenario(s.id)}
                          className="text-[var(--text-muted)] hover:text-[var(--risk-critical)]"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : null}
        </div>
      </div>
    </Page>
  );
}

const LEVER_WORDS: Record<keyof ScenarioAdjustments, (v: number) => string> = {
  demandAdjustmentPct: (v) => `demand ${v >= 0 ? "+" : "−"}${Math.round(Math.abs(v) * 100)}%`,
  inboundDelayWeeks: (v) => `inbound ${v} wk${v === 1 ? "" : "s"} late`,
  substitutabilityPct: (v) => `substitutability ${Math.round(v * 100)}%`,
  safetyStockWeeks: (v) => `safety stock ${v} wks`,
  sellThroughWeeks: (v) => `sell-through ${v} wks`,
  transferredDemandPct: (v) => `transferred demand ${Math.round(v * 100)}%`,
};

function describe(adjustments: ScenarioAdjustments): string {
  const parts = (Object.keys(adjustments) as (keyof ScenarioAdjustments)[])
    .filter((k) => adjustments[k] !== undefined)
    .map((k) => LEVER_WORDS[k](adjustments[k] as number));
  return parts.join(", ") || "no changes";
}
