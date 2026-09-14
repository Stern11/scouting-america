"use client";

/**
 * Reconcile (V2 §42).
 *
 * One question: what future business is not represented yet? The bridge shows
 * the size of the gap, and the contributor list is where the planner turns a
 * number into decisions — every downstream page reads from those decisions.
 */

import { use, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Pencil, RotateCcw } from "lucide-react";
import { useDataset, useSituation } from "@/components/dataset/dataset-provider";
import { useDatasetStore } from "@/stores/dataset-store";
import { BusinessToPlanBridge } from "@/components/workspace/bridge";
import { CandidateFilterBar } from "@/components/workspace/candidate-filters";
import { DataTable, type Column } from "@/components/shared/data-table";
import { SeasonBasis } from "@/components/workspace/season-basis";
import { NewBadge } from "@/components/shared/new-badge";
import { SkuImpactDrawer } from "@/components/workspace/sku-impact-drawer";
import { MaterialDrawer } from "@/components/workspace/material-drawer";
import { DispositionBadge, DISPOSITION_ORDER, dispositionLabel } from "@/components/shared/state-badge";
import { HeroMetric, MetricRow, Page, SectionRule } from "@/components/shared/page";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { upcomingDecisions } from "@/lib/situations/decisions";
import { applyFilters, filterOptions, type CandidateFilters } from "@/lib/situations/filters";
import { cn } from "@/lib/utils/cn";
import { LOAD_BEARING_DISPOSITIONS, type CandidateItem, type ContributorDisposition } from "@/types/situation";
import { fmtDateShort, fmtMoney, fmtUnits } from "@/lib/utils/format";
import {
  deadlineSortValue,
  deadlineTone,
  leadTimeLabel,
  noDeadlineReason,
  weeksLeftLabel,
  type DeadlineTone,
} from "@/lib/situations/deadline";

export default function ReconcilePage({ params }: { params: Promise<{ situationId: string }> }) {
  const { situationId } = use(params);
  const situation = useSituation(situationId);
  const { dataset } = useDataset();
  const setDisposition = useDatasetStore((s) => s.setDisposition);
  const resetDispositions = useDatasetStore((s) => s.resetDispositions);
  const setSeasonBasis = useDatasetStore((s) => s.setSeasonBasis);
  const overrides = useDatasetStore((s) => s.overridesBySituation[situationId]);

  const [filters, setFilters] = useState<CandidateFilters>({});
  const [openSkuId, setOpenSkuId] = useState<string | null>(null);
  const [openMaterialId, setOpenMaterialId] = useState<string | null>(null);

  const candidates = useMemo(() => situation?.candidateItems ?? [], [situation]);
  const options = useMemo(() => filterOptions(candidates), [candidates]);
  const visible = useMemo(() => applyFilters(candidates, filters), [candidates, filters]);

  const counts = useMemo(() => {
    const out: Partial<Record<ContributorDisposition, number>> = {};
    for (const c of candidates) out[c.disposition] = (out[c.disposition] ?? 0) + 1;
    return out;
  }, [candidates]);

  if (!situation) return <Page>{null}</Page>;

  const { bridge } = situation;
  // Counted the way Decisions lists them, so the two numbers always agree.
  const openDecisions = upcomingDecisions([situation], { [situationId]: overrides }).length;

  // Every item on the same basis grows at the same rate, so the header can
  // state it once. Only omitted when the rows genuinely disagree.
  const growthRates = new Set(
    candidates
      .filter((c) => c.plannedBasis.kind !== "planner_override")
      .map((c) => c.plannedBasis.growthPct.toFixed(4))
  );
  const sharedGrowth =
    growthRates.size === 1 ? Number([...growthRates][0]) : undefined;
  const sharedGrowthLabel =
    sharedGrowth !== undefined && Math.abs(sharedGrowth) >= 0.0005
      ? `${sharedGrowth > 0 ? "+" : ""}${(sharedGrowth * 100).toFixed(1)}%`
      : undefined;
  const edited = Object.keys(overrides?.dispositions ?? {}).length;
  const hasWindow = situation.productionWindow !== undefined;

  const columns: Column<CandidateItem>[] = [
    {
      key: "item",
      header: "Prior item",
      sortValue: (row) => row.itemName,
      render: (row) => (
        // Table cells ignore max-width, so the cap sits on the content: a long
        // item name truncates instead of widening the whole table.
        <div className="min-w-0 max-w-[230px] xl:max-w-[280px]">
          <div className="flex items-center gap-2">
            <span
              title={row.itemName}
              className={cn(
                "truncate font-medium",
                row.disposition === "intentional_exit"
                  ? "text-[var(--text-muted)] line-through"
                  : "text-[var(--text-primary)]"
              )}
            >
              {row.itemName}
            </span>
            {row.isNewThisSeason ? <NewBadge /> : null}
          </div>
          <div className="truncate text-[11.5px] text-[var(--text-muted)]">
            {row.productFamily}
            {row.customer ? ` · ${row.customer}` : ""}
          </div>
        </div>
      ),
    },
    {
      key: "planned",
      // Last year and what carries forward read as one movement, so they share
      // a column — two numeric columns side by side were most of the width
      // that pushed the decision control off the edge. The growth rate is one
      // number for the whole basis, so it belongs in the header once.
      header: (
        <span title="Units last year → units carried forward this year">
          Units
          {sharedGrowthLabel ? (
            <span className="ml-1.5 font-normal normal-case text-[var(--text-muted)]">{sharedGrowthLabel}</span>
          ) : null}
        </span>
      ),
      numeric: true,
      sortValue: (row) => row.plannedUnits,
      render: (row) => {
        const overridden = row.plannedBasis.kind === "planner_override";
        return (
          <div>
            <div className="whitespace-nowrap tabular-nums text-[var(--text-primary)]">
              <span className="text-[var(--text-muted)]">{fmtUnits(row.actualUnits)} →</span>{" "}
              {fmtUnits(row.plannedUnits)}
            </div>
            {/* Only what departs from the shared basis earns a second line. */}
            {overridden ? (
              <div className="text-[11.5px] text-[var(--state-scenario)]">set by hand</div>
            ) : null}
          </div>
        );
      },
    },
    {
      key: "coverage",
      header: "In this year's plan",
      render: (row) => {
        const cover = coverageOf(row);
        if (!cover) {
          // Deliberately terse. The long version repeated verbatim down every
          // uncovered row, and its second line restated the brand, family and
          // customer already sitting in the first column — two kinds of
          // repetition on one screen, neither of them telling the reader
          // anything they had not just read.
          return (
            <span className="text-[12.5px] text-[var(--risk-warning)]">Not covered</span>
          );
        }
        return (
          <div className="min-w-0 max-w-[190px] xl:max-w-[230px]">
            <div className="truncate text-[12.5px] text-[var(--text-primary)]" title={cover.name}>
              {cover.name}
            </div>
            {/* Prior units already have their own column; the line only
                needs what the plan carries and how far that is from it. */}
            <div className="truncate text-[11.5px] text-[var(--text-muted)]">
              {fmtUnits(cover.planned)} planned{" "}
              <span
                className={
                  cover.aligned ? "text-[var(--text-muted)]" : "font-medium text-[var(--risk-warning)]"
                }
              >
                ({cover.delta > 0 ? "+" : ""}
                {Math.round(cover.delta * 100)}%)
              </span>
            </div>
          </div>
        );
      },
    },
    {
      key: "deadline",
      header: (
        <span title="The last day to commit: production start minus the lead time of this item's slowest component. Red: overdue or 8 weeks or less · Amber: 9–20 weeks · Green: more than 20 weeks">
          Deadline
        </span>
      ),
      sortValue: deadlineSortValue,
      render: (row) => <DeadlineCell row={row} hasWindow={hasWindow} />,
    },
    {
      key: "disposition",
      header: "Decision",
      width: "160px",
      render: (row) => (
        // The row opens the drawer; the decision control must not, or changing
        // a disposition would always be followed by a panel the planner did
        // not ask for.
        <div
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          role="presentation"
        >
          <DecisionCell
            candidate={row}
            settled={isSettled(row)}
            onChange={(value) => setDisposition(situationId, row.id, value)}
          />
        </div>
      ),
    },
  ];

  return (
    <Page>
      <div className="flex flex-wrap items-end justify-between gap-6 sm:gap-8">
        <HeroMetric
          label="Not represented"
          value={fmtMoney(bridge.unresolvedValue, bridge.currency)}
          tone={bridge.unresolvedValue > 0 ? "critical" : "positive"}
          sub={`${fmtUnits(bridge.unresolvedUnits, true)} of expected business have no item in the formal plan`}
        />
        <MetricRow
          items={[
            {
              label: "Carrying forward",
              value: fmtMoney(bridge.validatedValue, bridge.currency),
              sub: `${fmtUnits(bridge.validatedUnits, true)} · drives supply and capacity`,
              tone: "neutral",
            },
            {
              label: "Unexplained",
              value: fmtMoney(bridge.unexplainedValue, bridge.currency),
              sub: "No prior item accounts for this",
              tone: bridge.unexplainedValue > bridge.unresolvedValue * 0.2 ? "warning" : "muted",
            },
          ]}
        />
      </div>

      <SectionRule label="Expected business against the formal plan" />
      <div className="mb-5">
        <SeasonBasis situation={situation} onChange={(periods) => setSeasonBasis(situationId, periods)} />
      </div>
      <BusinessToPlanBridge bridge={bridge} candidates={candidates} />

      <SectionRule
        label={`Possible contributors · ${candidates.length} prior items`}
        action={
          edited > 0 ? (
            <button
              type="button"
              onClick={() => resetDispositions(situationId)}
              className="inline-flex items-center gap-1.5 text-[12px] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              <RotateCcw className="size-3" />
              Reset {edited} change{edited === 1 ? "" : "s"}
            </button>
          ) : null
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2">
        {DISPOSITION_ORDER.filter((d) => (counts[d] ?? 0) > 0).map((d) => (
          <span key={d} className="flex items-center gap-2">
            <DispositionBadge disposition={d} />
            <span className="text-[12.5px] tabular-nums text-[var(--text-secondary)]">{counts[d]}</span>
            {LOAD_BEARING_DISPOSITIONS.includes(d) ? (
              <span className="text-[11.5px] text-[var(--text-muted)]">counts as load</span>
            ) : null}
          </span>
        ))}
      </div>

      <CandidateFilterBar
        filters={filters}
        options={options}
        visible={visible}
        total={candidates.length}
        currency={bridge.currency}
        onChange={setFilters}
      />

      <DataTable
        rows={visible}
        columns={columns}
        rowKey={(row) => row.id}
        onRowClick={(row) => setOpenSkuId(row.id)}
        isRowActive={(row) => row.id === openSkuId}
        rowClassName={(row) =>
          // An exit is decided and gone — greyed rather than highlighted.
          row.disposition === "intentional_exit"
            ? "opacity-60"
            : isSettled(row)
              ? undefined
              : "bg-[var(--surface)]"
        }
        // Soonest deadline first: the date is what a planner prioritises by,
        // and exits and undated rows sort to the bottom rather than crowding
        // out what is due.
        initialSort={{ key: "deadline", direction: "asc" }}
        minWidth={760}
        card={(row) => {
          const cover = coverageOf(row);
          return (
            <div className="flex flex-col gap-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-[13px] font-medium text-[var(--text-primary)]">
                      {row.itemName}
                    </span>
                    {row.isNewThisSeason ? <NewBadge /> : null}
                  </div>
                  <div className="mt-0.5 text-[11.5px] text-[var(--text-muted)]">
                    {row.productFamily}
                    {row.customer ? ` · ${row.customer}` : ""}
                  </div>
                </div>
                <div className="flex-none text-right">
                  <div className="text-[13px] font-medium tabular-nums text-[var(--text-primary)]">
                    {fmtUnits(row.plannedUnits)}
                  </div>
                  <div className="text-[11px] text-[var(--text-muted)]">carries forward</div>
                </div>
              </div>

              <div className="text-[11.5px] leading-snug text-[var(--text-muted)]">
                {cover ? (
                  <>
                    In the plan: {cover.name} ·{" "}
                    <span className="tabular-nums">
                      {fmtUnits(row.actualUnits)} → {fmtUnits(cover.planned)}
                    </span>{" "}
                    <span
                      className={
                        cover.aligned ? "text-[var(--text-muted)]" : "font-medium text-[var(--risk-warning)]"
                      }
                    >
                      ({cover.delta > 0 ? "+" : ""}
                      {Math.round(cover.delta * 100)}%)
                    </span>
                  </>
                ) : (
                  <span className="text-[var(--risk-warning)]">Nothing in the plan covers it</span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-[var(--text-muted)]">
                {row.deadline ? (
                  <>
                    <span>Deadline</span>
                    <DeadlineCell row={row} hasWindow={hasWindow} wide />
                  </>
                ) : (
                  <span>No deadline — {noDeadlineReason(row, hasWindow)}</span>
                )}
              </div>

              <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} role="presentation">
                <DecisionCell
                  candidate={row}
                  settled={isSettled(row)}
                  onChange={(value) => setDisposition(situationId, row.id, value)}
                />
              </div>
            </div>
          );
        }}
        empty={
          candidates.length === 0
            ? `No prior-season items comparable to ${situation.title} were found, so nothing can be offered as an explanation.`
            : "No items match these filters."
        }
      />

      <SkuImpactDrawer
        situation={situation}
        candidateId={openSkuId}
        onClose={() => setOpenSkuId(null)}
        onDisposition={(candidateId, disposition) =>
          setDisposition(situationId, candidateId, disposition)
        }
        onSelectMaterial={setOpenMaterialId}
      />

      <MaterialDrawer
        dataset={dataset}
        situation={situation}
        materialId={openMaterialId}
        onClose={() => setOpenMaterialId(null)}
      />

      {/* What this programme's choices commit the planner to is handled on
          Decisions, with every other programme's — a quiet pointer, not a step. */}
      <div className="mt-8 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-[var(--border)] pt-4">
        <span className="text-[12.5px] tabular-nums text-[var(--text-muted)]">
          {openDecisions === 0
            ? "No dated decisions yet"
            : `${openDecisions} decision${openDecisions === 1 ? "" : "s"} this creates`}
        </span>
        <Link
          href={`/decisions?programme=${encodeURIComponent(situationId)}`}
          className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
          style={{ transitionDuration: "var(--duration-fast)" }}
        >
          View in Decisions
          <ArrowRight className="size-3.5" />
        </Link>
      </div>
    </Page>
  );
}

/* ------------------------------------------------------------------ */
/* Deadline cells                                                      */
/* ------------------------------------------------------------------ */

/** Filled soft pills, so the band reads at a glance down the column. */
const PILL_TONE: Record<DeadlineTone, string> = {
  critical: "border-[var(--risk-critical)] bg-[var(--risk-critical-soft)] text-[var(--risk-critical)]",
  warning: "border-[var(--risk-warning)] bg-[var(--risk-warning-soft)] text-[var(--risk-warning)]",
  positive: "border-[var(--risk-positive)] bg-[var(--risk-positive-soft)] text-[var(--risk-positive)]",
};

/**
 * The date and how long is left, with what sets it on a second quiet line. An
 * exit needs no decision date, so it is struck.
 *
 * The component class tag ("PM") that used to sit in its own column is gone:
 * the abbreviation needed explaining, and the component's own name says more.
 */
function DeadlineCell({
  row,
  hasWindow,
  wide = false,
}: {
  row: CandidateItem;
  hasWindow: boolean;
  /** In a phone card the component name has the full row, not a 150px column. */
  wide?: boolean;
}) {
  if (!row.deadline) {
    return (
      <span className="text-[var(--text-muted)]" title={noDeadlineReason(row, hasWindow)}>
        —
      </span>
    );
  }
  if (row.disposition === "intentional_exit") {
    return (
      <span
        className="whitespace-nowrap tabular-nums text-[var(--text-muted)] line-through"
        title="Intentional exit — needs no decision date"
      >
        {fmtDateShort(row.deadline.date)}
      </span>
    );
  }
  return (
    <span className="inline-flex flex-col gap-0.5">
      <span className="inline-flex items-center gap-2 whitespace-nowrap">
        <span className="tabular-nums text-[var(--text-primary)]">{fmtDateShort(row.deadline.date)}</span>
        <span
          className={cn(
            "rounded-full border px-1.5 py-[2px] text-[10.5px] font-medium leading-none tabular-nums",
            PILL_TONE[deadlineTone(row.deadline.weeksAway)]
          )}
        >
          {weeksLeftLabel(row.deadline.weeksAway)}
        </span>
      </span>
      <span
        className={cn(
          "block truncate text-[11px] text-[var(--text-muted)]",
          wide ? "max-w-[240px]" : "max-w-[150px]"
        )}
        title={`Set by ${row.deadline.componentName}, which takes ${row.deadline.leadTimeDays} days to arrive`}
      >
        {leadTimeLabel(row.deadline.leadTimeDays)} · {row.deadline.componentName}
      </span>
    </span>
  );
}

/** How much this prior item's volume differs from the plan item covering it. */
interface Coverage {
  name: string;
  planned: number;
  /** Fractional change from prior actual to planned. */
  delta: number;
  /** Within a margin where the plan can be taken as carrying the same business. */
  aligned: boolean;
}

/** Beyond this the plan covers the item in name but not in volume. */
const ALIGNED_TOLERANCE = 0.1;

function coverageOf(row: CandidateItem): Coverage | undefined {
  const planned = row.match.matchedUnits;
  if (!row.match.matchedItemId || planned === undefined) return undefined;
  const delta = row.actualUnits === 0 ? 0 : (planned - row.actualUnits) / row.actualUnits;
  return {
    name: row.match.matchedItemName ?? row.match.matchedItemId,
    planned,
    delta,
    aligned: Math.abs(delta) <= ALIGNED_TOLERANCE,
  };
}

/**
 * A settled row is one the planner has nothing left to decide: the plan
 * already carries this business at a comparable volume. Those stay read-only
 * so the twenty-row list reads as "five things to decide" rather than twenty
 * identical dropdowns — but a plan item that covers the name while carrying a
 * materially different volume is NOT settled, because that difference is
 * exactly the kind of thing a planner should look at.
 */
function isSettled(row: CandidateItem): boolean {
  if (row.disposition !== "already_represented") return false;
  return coverageOf(row)?.aligned === true;
}

function DecisionCell({
  candidate,
  settled,
  onChange,
}: {
  candidate: CandidateItem;
  settled: boolean;
  onChange: (value: ContributorDisposition) => void;
}) {
  const [unlocked, setUnlocked] = useState(false);

  if (settled && !unlocked) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-[12.5px] text-[var(--text-muted)]">Covered</span>
        <button
          type="button"
          onClick={() => setUnlocked(true)}
          className="inline-flex h-8 items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--border)] px-2 text-[11.5px] sm:h-7 text-[var(--text-muted)] transition-opacity hover:bg-[var(--interaction-hover)] hover:text-[var(--text-primary)] focus-visible:opacity-100 group-hover:opacity-100 sm:border-transparent sm:opacity-0 [tr:hover_&]:opacity-100"
        >
          <Pencil className="size-3" />
          Change
        </button>
      </div>
    );
  }

  const needsAttention = candidate.disposition === "under_review" || candidate.disposition === "unreviewed";

  return (
    <Select value={candidate.disposition} onValueChange={(value) => onChange(value as ContributorDisposition)}>
      <SelectTrigger
        className={cn(
          "w-[152px]",
          needsAttention && "border-[var(--state-inferred)] ring-1 ring-[var(--state-inferred)]/30",
          candidate.disposition === "carry_forward" && "border-[var(--state-validated)]"
        )}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {DISPOSITION_ORDER.map((option) => (
          <SelectItem key={option} value={option}>
            {dispositionLabel(option)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
