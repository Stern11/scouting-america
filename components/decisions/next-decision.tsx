"use client";

/**
 * The one decision the Decisions page leads with: what it is, the date it
 * stops being reversible, how long is left, and the action that settles it.
 *
 * An order is released here, not somewhere else. Sending the planner to
 * another page to "see the items" was navigation dressed up as an action.
 */

import Link from "next/link";
import { AlertTriangle, ArrowRight, Check } from "lucide-react";
import { Label } from "@/components/shared/page";
import type { DecisionUrgency, PendingDecision } from "@/lib/situations/decisions";
import { cn } from "@/lib/utils/cn";
import { fmtDateShort, fmtNum, fmtWeeks } from "@/lib/utils/format";

export function NextDecision({
  decision,
  context,
  onRelease,
}: {
  decision: PendingDecision;
  /** The programme, when the page spans more than one. */
  context?: string;
  onRelease: () => void;
}) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius-lg)] border px-5 py-5 sm:px-7 sm:py-6",
        decision.urgency === "overdue"
          ? "border-[var(--risk-critical)] bg-[var(--risk-critical-soft)]"
          : decision.urgency === "urgent"
            ? "border-[var(--risk-warning)] bg-[var(--risk-warning-soft)]"
            : "border-[var(--border)] bg-[var(--surface)]"
      )}
    >
      <Label>Next decision{context ? ` · ${context}` : ""}</Label>
      <div className="mt-1.5 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="text-[21px] font-semibold leading-tight tracking-tight text-[var(--text-primary)] sm:text-[26px]">
          {decision.title}
        </span>
        {decision.date ? (
          <span className="text-[15px] tabular-nums text-[var(--text-secondary)]">
            {decision.dateLabel.toLowerCase()} {fmtDateShort(decision.date)}
          </span>
        ) : null}
      </div>

      <div className="mt-2 flex flex-wrap items-baseline gap-x-3">
        <UrgencyText urgency={decision.urgency} weeksAway={decision.weeksAway} />
        <span className="text-[13px] text-[var(--text-secondary)]">{decision.consequence}</span>
      </div>

      {decision.drivenBy.length > 0 ? (
        <div className="mt-3 text-[12.5px] text-[var(--text-muted)]">
          Needed for <span className="text-[var(--text-secondary)]">{decision.drivenBy.join(", ")}</span>
        </div>
      ) : null}

      <div className="mt-5 flex flex-col items-stretch gap-2.5 sm:flex-row sm:flex-wrap sm:items-center">
        {decision.materialId ? (
          <button
            type="button"
            onClick={onRelease}
            className="inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--accent)] px-3.5 py-2.5 text-[13px] font-medium text-[var(--text-on-accent)] transition-opacity hover:opacity-90 sm:py-2"
            style={{ transitionDuration: "var(--duration-fast)" }}
          >
            <Check className="size-3.5" />
            {decision.quantity && decision.quantity > 0
              ? `Release ${fmtNum(Math.round(decision.quantity))} ${decision.uom} for ordering…`
              : "Release for ordering…"}
          </button>
        ) : null}
        <Link
          href={decision.href}
          className={cn(
            "inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-sm)] px-3.5 py-2.5 text-[13px] font-medium transition-colors sm:py-2",
            decision.materialId
              ? "border border-[var(--border-strong)] text-[var(--text-primary)] hover:bg-[var(--interaction-hover)]"
              : "bg-[var(--accent)] text-[var(--text-on-accent)] hover:opacity-90"
          )}
          style={{ transitionDuration: "var(--duration-fast)" }}
        >
          {decision.cta}
          <ArrowRight className="size-3.5" />
        </Link>
      </div>
    </div>
  );
}

function UrgencyText({ urgency, weeksAway }: { urgency: DecisionUrgency; weeksAway: number | undefined }) {
  if (urgency === "overdue") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[var(--risk-critical)]">
        <AlertTriangle className="size-3.5" />
        Already past
      </span>
    );
  }
  if (weeksAway === undefined) {
    return <span className="text-[13px] text-[var(--text-muted)]">No date yet</span>;
  }
  return (
    <span
      className={cn(
        "text-[13px] font-semibold tabular-nums",
        urgency === "urgent" ? "text-[var(--risk-warning)]" : "text-[var(--text-primary)]"
      )}
    >
      {fmtWeeks(weeksAway)} left
    </span>
  );
}
