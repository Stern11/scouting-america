"use client";

/**
 * Overview (V2 §39).
 *
 * One question: how much of my future business has no product in the plan, and
 * what does that do to me?
 *
 * It opens on the items missing from the plan, laid out by production month —
 * planning happens over a rolling horizon, not against a season total — and
 * reads out the consequence in the currencies a planner works in: money,
 * factory hours, and time left to order. Every section always covers the
 * whole horizon: hovering a chart shows that month's figures in place, and
 * never re-scopes the rest of the page.
 */

import { useMemo } from "react";
import { useDataset } from "@/components/dataset/dataset-provider";
import { Label, Page, PageHeader, SectionRule, NotAvailable } from "@/components/shared/page";
import { BeforeAfterPlan } from "@/components/overview/before-after-plan";
import { LineLoad } from "@/components/overview/line-load";
import { MissingTimeline } from "@/components/overview/missing-timeline";
import { ReadinessCurveCard } from "@/components/overview/readiness-curve";
import { WelcomePanel } from "@/components/overview/welcome-panel";
import { buildPlanningHorizon } from "@/lib/situations/horizon";
import { listLoadLines, summarizePortfolio, type PortfolioSummary } from "@/lib/situations/portfolio";
import { buildReadinessCurve } from "@/lib/situations/readiness-curve";
import { cn } from "@/lib/utils/cn";
import { fmtDateShort, fmtHours, fmtMoney, fmtPct, fmtUnits, fmtWeeks } from "@/lib/utils/format";

export default function OverviewPage() {
  const { dataset, situations } = useDataset();

  const horizon = useMemo(() => buildPlanningHorizon(situations), [situations]);
  const hasLineLoad = useMemo(() => listLoadLines(situations).length > 0, [situations]);
  const summary = useMemo(() => summarizePortfolio(situations), [situations]);
  const curves = useMemo(
    () => (dataset ? situations.map((s) => ({ situation: s, curve: buildReadinessCurve(s, dataset) })) : []),
    [dataset, situations]
  );

  if (situations.length === 0 || !dataset) {
    return (
      <Page>
        <PageHeader title="Overview" subtitle="What is not represented, and what it costs" />
        <NotAvailable
          title="No planning situations found"
          detail="Your business plan and formal plan reconcile, or there is no business plan data to compare against."
        />
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        title="Overview"
        subtitle={`${situations.length} programme${situations.length === 1 ? "" : "s"} in the planning horizon`}
      />

      <WelcomePanel summary={summary} firstSituationId={situations[0]?.id} />

      <MissingTimeline horizon={horizon} />

      <SectionRule label="What that does to the plan" />
      <Consequences summary={summary} />

      <SectionRule label="Factory load against capacity · all programmes" />
      {hasLineLoad ? (
        <>
          <LineLoad situations={situations} />
          {summary.capacityUnavailable ? (
            <p className="mt-2 text-[11.5px] text-[var(--text-muted)]">
              Some programmes have no line capacity or mapping, so their hours are not shown.
            </p>
          ) : null}
        </>
      ) : (
        <NotAvailable
          title="No factory load to show"
          detail="Add line capacity and item-line mapping to see hours by line and month."
        />
      )}

      <SectionRule label="What changes once these SKUs count" />
      <BeforeAfterPlan beforeAfter={summary.beforeAfter} materialsUnavailable={summary.materialsUnavailable} />

      <SectionRule label="Season readiness" />
      <p className="-mt-1 mb-3 text-[12.5px] leading-snug text-[var(--text-muted)]">
        Share of expected value in the plan, against last year at the same point.
      </p>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {curves.map(({ situation, curve }) => (
          <ReadinessCurveCard
            key={situation.id}
            curve={curve}
            situation={situation}
            href={`/workspace/${situation.id}/reconcile`}
          />
        ))}
      </div>
    </Page>
  );
}

/* ------------------------------------------------------------------ */
/* Consequences                                                        */
/* ------------------------------------------------------------------ */

function Consequences({ summary }: { summary: PortfolioSummary }) {
  return (
    <div className="grid grid-cols-1 gap-px overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--border)] sm:grid-cols-3">
      <Consequence
        heading="Sales"
        question="How much of the expected business is represented?"
        value={summary.representedBasis === "unavailable" ? "—" : fmtPct(summary.representedPct)}
        tone={
          summary.representedBasis === "unavailable"
            ? "neutral"
            : summary.representedPct >= 0.95
              ? "positive"
              : summary.representedPct >= 0.8
                ? "warning"
                : "critical"
        }
        detail={salesDetail(summary)}
        footnote={`${fmtUnits(summary.validatedUnits, true)} accepted as carrying forward`}
      />

      <Consequence
        heading="Manufacturing"
        question="How many hours does that add to the factory?"
        value={summary.capacityUnavailable ? "—" : fmtHours(summary.unresolvedHours)}
        tone={summary.exposedLines.length > 0 ? "critical" : "neutral"}
        detail={
          summary.capacityUnavailable
            ? "Add line capacity and item-line mapping to calculate this."
            : `on top of ${fmtHours(summary.formalHours)} already planned, across ${
                summary.linesCarryingLoadCount
              } line${summary.linesCarryingLoadCount === 1 ? "" : "s"}`
        }
        footnote={
          summary.capacityUnavailable
            ? undefined
            : summary.exposedLines.length > 0
              ? `${summary.exposedLines.length} line${summary.exposedLines.length === 1 ? "" : "s"} go past target`
              : "every line stays inside target"
        }
      />

      <Consequence
        heading="Time"
        question="When does the first decision stop being reversible?"
        value={summary.nearestDeadline ? fmtWeeks(summary.nearestDeadline.weeksAway) : "—"}
        tone={
          !summary.nearestDeadline
            ? "neutral"
            : summary.nearestDeadline.weeksAway <= 0
              ? "critical"
              : summary.nearestDeadline.weeksAway <= 8
                ? "warning"
                : "neutral"
        }
        detail={
          summary.nearestDeadline
            ? `${summary.nearestDeadline.label} · ${fmtDateShort(summary.nearestDeadline.date)} · ${
                summary.nearestDeadline.situationTitle
              }`
            : "No decision date is pending."
        }
        footnote={
          summary.materialsUnavailable
            ? "Add BOM data to see material deadlines."
            : `${summary.planNowCount} component${summary.planNowCount === 1 ? "" : "s"} can be ordered now · ${
                summary.waitCount
              } must wait`
        }
      />
    </div>
  );
}

/** Money is only totalled within one currency; otherwise units, or nothing. */
function salesDetail(summary: PortfolioSummary): string {
  if (summary.valuesComparable) {
    return `${fmtMoney(summary.formalValue, summary.currency)} planned of ${fmtMoney(
      summary.expectedValue,
      summary.currency
    )} expected`;
  }
  const currencies = summary.currencies.join(", ");
  if (summary.representedBasis === "units") {
    return `${fmtUnits(summary.formalUnits, true)} planned of ${fmtUnits(
      summary.expectedUnits ?? 0,
      true
    )} expected · ${currencies} not summed`;
  }
  return `Planned in ${currencies} — money isn't summed across currencies`;
}

function Consequence({
  heading,
  question,
  value,
  detail,
  footnote,
  tone,
}: {
  heading: string;
  question: string;
  value: string;
  detail: string;
  footnote?: string;
  tone: "positive" | "warning" | "critical" | "neutral";
}) {
  return (
    <div className="bg-[var(--surface)] px-5 py-4">
      <Label>{heading}</Label>
      {/* Two lines reserved from sm up, so the three figures share a baseline
          however their questions wrap. */}
      <div className="mt-0.5 text-[11.5px] leading-snug text-[var(--text-muted)] sm:line-clamp-2 sm:min-h-[2.75em]" title={question}>
        {question}
      </div>
      <div
        className={cn(
          "mt-3 text-[30px] font-semibold leading-none tabular-nums",
          tone === "positive" && "text-[var(--risk-positive)]",
          tone === "warning" && "text-[var(--risk-warning)]",
          tone === "critical" && "text-[var(--risk-critical)]",
          tone === "neutral" && "text-[var(--text-primary)]"
        )}
      >
        {value}
      </div>
      <div className="mt-2 text-[12px] leading-snug text-[var(--text-secondary)]">{detail}</div>
      {footnote ? <div className="mt-1 text-[11.5px] leading-snug text-[var(--text-muted)]">{footnote}</div> : null}
    </div>
  );
}
