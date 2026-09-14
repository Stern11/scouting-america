"use client";

/**
 * Decisions (V2 §57, PRD §20).
 *
 * One question: what do I have to decide, and by when?
 *
 * This is where everything a planner does in the workspace lands. Carrying an
 * item forward on Reconcile puts its components and line load on the
 * calendar here; nothing registers a decision, they derive from the same
 * situations every page reads (`lib/situations/decisions.ts`).
 *
 * All programmes by default, or one via `?programme=` — a planner running
 * Halloween and Holiday at once needs one list, but a link from a programme
 * should land scoped to it. Production and sales timing is per programme, so
 * it only appears when one is selected.
 */

import { Suspense, useCallback, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useDataset } from "@/components/dataset/dataset-provider";
import { useDatasetStore } from "@/stores/dataset-store";
import { useSituationScenarioStore } from "@/stores/situation-scenario-store";
import { MetricRow, NotAvailable, Page, PageHeader, SectionRule } from "@/components/shared/page";
import { DecisionListHeader, DecisionRow } from "@/components/decisions/decision-row";
import { NextDecision } from "@/components/decisions/next-decision";
import { BlockedList } from "@/components/decisions/blocked-list";
import { ReleaseDialog, type ChosenSupplier } from "@/components/decisions/release-dialog";
import { CommittedLog } from "@/components/decisions/committed-log";
import { DecisionsTable } from "@/components/decisions/decisions-table";
import { SavedScenarios } from "@/components/decisions/saved-scenarios";
import { RunwayTimeline } from "@/components/workspace/runway";
import {
  blockedAcrossProgrammes,
  committedLog,
  nextDecision,
  releaseFor,
  undecidedProductCount,
  upcomingDecisions,
  type PendingDecision,
  type ProgrammeDecision,
} from "@/lib/situations/decisions";
import { countAdjustments } from "@/lib/situations/scenario";
import { cn } from "@/lib/utils/cn";
import { fmtNum } from "@/lib/utils/format";

/** Enough to see the next month or two without the list becoming the page. */
const PREVIEW_ROWS = 8;

const isDueNow = (d: ProgrammeDecision) => d.urgency === "overdue" || d.urgency === "urgent";

export default function DecisionsPage() {
  // `useSearchParams` needs a Suspense boundary above it in the App Router.
  return (
    <Suspense fallback={<Page>{null}</Page>}>
      <Decisions />
    </Suspense>
  );
}

function Decisions() {
  const { situations, dataset } = useDataset();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const overridesBySituation = useDatasetStore((s) => s.overridesBySituation);
  const releaseMaterial = useDatasetStore((s) => s.releaseMaterial);
  const scenariosById = useSituationScenarioStore((s) => s.scenarios);
  const [showAll, setShowAll] = useState(false);
  // The order whose supplier is being chosen.
  const [releasing, setReleasing] = useState<ProgrammeDecision | null>(null);

  // A programme the dataset does not carry (a stale link, a different upload)
  // is ignored rather than rendered as an empty page.
  const requested = searchParams.get("programme");
  const programme = situations.find((s) => s.id === requested);
  const inScope = useMemo(() => (programme ? [programme] : situations), [programme, situations]);

  const selectProgramme = useCallback(
    (id: string | undefined) => {
      const params = new URLSearchParams(searchParams.toString());
      if (id) params.set("programme", id);
      else params.delete("programme");
      const query = params.toString();
      setShowAll(false);
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  // Scenario Lab opens every situation on a fresh "Scenario 1" so the
  // planner never lands on an empty column. Counting that untouched scenario
  // as "saved" here made every visited situation look like a decision had
  // been worked through — so only scenarios that change something, or carry
  // a note, are listed and counted.
  const scenarios = useMemo(
    () =>
      Object.values(scenariosById).filter(
        (s) =>
          (!programme || s.situationId === programme.id) &&
          (countAdjustments(s.adjustments) > 0 || Boolean(s.note?.trim()))
      ),
    [scenariosById, programme]
  );

  const upcoming = useMemo(
    () => upcomingDecisions(inScope, overridesBySituation),
    [inScope, overridesBySituation]
  );
  const committed = useMemo(
    () => committedLog(inScope, overridesBySituation),
    [inScope, overridesBySituation]
  );
  const blocked = useMemo(() => blockedAcrossProgrammes(inScope), [inScope]);

  const stillToDecide = useMemo(() => undecidedProductCount(inScope), [inScope]);

  const dueNow = upcoming.filter(isDueNow);
  const overdue = upcoming.filter((d) => d.urgency === "overdue").length;
  const dueSoon = upcoming.filter((d) => d.urgency === "soon").length;
  const next = nextDecision(upcoming);

  const releasingSituation = releasing
    ? situations.find((s) => s.id === releasing.situationId)
    : undefined;

  const onConfirmRelease = (decision: ProgrammeDecision, supplier: ChosenSupplier) => {
    const situation = situations.find((s) => s.id === decision.situationId);
    setReleasing(null);
    if (!situation) return;
    // Dataset time, never wall-clock.
    const release = releaseFor(decision, situation.calculatedAt, supplier);
    if (release) releaseMaterial(decision.situationId, release);
  };

  const visible = showAll ? upcoming : upcoming.slice(0, PREVIEW_ROWS);
  const multi = !programme && situations.length > 1;

  return (
    <Page>
      <PageHeader title="Decisions" subtitle="What you have to decide, and by when" />

      {situations.length > 1 ? (
        <div className="-mt-2 mb-6 grid grid-cols-2 gap-1.5 sm:flex sm:flex-wrap" role="group" aria-label="Programme">
          <ProgrammeChip active={!programme} onClick={() => selectProgramme(undefined)}>
            All programmes
          </ProgrammeChip>
          {situations.map((s) => (
            <ProgrammeChip key={s.id} active={programme?.id === s.id} onClick={() => selectProgramme(s.id)}>
              {s.title}
            </ProgrammeChip>
          ))}
        </div>
      ) : null}

      {next ? (
        <NextDecision
          decision={next}
          context={multi ? next.situationTitle : undefined}
          onRelease={() => setReleasing(next)}
        />
      ) : (
        <NotAvailable
          title="Nothing is waiting on you"
          detail="No dated decision follows from what is carrying forward."
        />
      )}

      <MetricRow
        className="mt-6"
        items={[
          {
            label: "Due in 4 weeks",
            value: fmtNum(dueNow.length),
            tone: overdue > 0 ? "critical" : dueNow.length > 0 ? "warning" : "neutral",
            sub: overdue > 0 ? `${fmtNum(overdue)} already past` : undefined,
          },
          { label: "Due in 5–12 weeks", value: fmtNum(dueSoon) },
          { label: "Committed", value: fmtNum(committed.length), sub: "Released or locked" },
          {
            label: "Products undecided",
            value: fmtNum(stillToDecide),
            tone: stillToDecide > 0 ? "warning" : "positive",
            sub: "They carry no load yet",
          },
        ]}
      />

      <SectionRule
        label={`Order-by and decision dates · ${upcoming.length}`}
        action={
          upcoming.length > PREVIEW_ROWS ? (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="text-[12px] font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
              style={{ transitionDuration: "var(--duration-fast)" }}
            >
              {showAll ? "Show fewer" : `Show all ${upcoming.length}`}
            </button>
          ) : undefined
        }
      />
      {upcoming.length > 0 ? (
        <div>
          <DecisionListHeader />
          <div className="divide-y divide-[var(--border)] border-b border-[var(--border)] max-sm:border-t">
            {visible.map((decision) => (
              <DecisionRow
                key={decision.key}
                decision={decision}
                context={multi ? decision.situationTitle : undefined}
                onRelease={() => setReleasing(decision)}
              />
            ))}
          </div>
        </div>
      ) : (
        <p className="py-4 text-[13px] text-[var(--text-muted)]">
          Nothing carries forward yet, so nothing has a date on it.
        </p>
      )}

      {blocked.length > 0 ? (
        <>
          <SectionRule label={`Cannot be committed yet · ${blocked.length}`} />
          <BlockedList rows={blocked} showProgramme={multi} />
        </>
      ) : null}

      {programme ? (
        <>
          <SectionRule label="Production and sales timing" />
          <RunwayTimeline runway={programme.runway} />
        </>
      ) : null}

      <SectionRule label={`Committed by you · ${committed.length}`} />
      <CommittedLog entries={committed} />

      <SectionRule label="Products you have decided" />
      <DecisionsTable situations={inScope} overridesBySituation={overridesBySituation} />

      <SectionRule label={`Saved scenarios · ${scenarios.length}`} />
      <SavedScenarios scenarios={scenarios} situations={situations} />

      <ReleaseDialog
        decision={releasing}
        situation={releasingSituation}
        dataset={dataset}
        onClose={() => setReleasing(null)}
        onConfirm={(decision: PendingDecision, supplier) =>
          onConfirmRelease(decision as ProgrammeDecision, supplier)
        }
      />
    </Page>
  );
}

function ProgrammeChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "h-8 max-w-full truncate rounded-[var(--radius-sm)] border px-2.5 text-[12.5px] transition-colors",
        active
          ? "border-[var(--interaction-selected-border)] bg-[var(--interaction-selected)] font-medium text-[var(--text-primary)]"
          : "border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
      )}
      style={{ transitionDuration: "var(--duration-fast)" }}
    >
      {children}
    </button>
  );
}
