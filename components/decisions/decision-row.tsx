"use client";

/**
 * One dated decision on a row: when it stops being reversible, what it is,
 * what happens at that date, and the one action that settles it. Used on the
 * Decisions page, whether it shows one programme or all of them.
 *
 * Every date says what it is ("order by", "resolve by", "starts"). A bare
 * date on a list of mixed decisions left the planner asking what it meant.
 */

import Link from "next/link";
import { Check } from "lucide-react";
import type { PendingDecision } from "@/lib/situations/decisions";
import { cn } from "@/lib/utils/cn";
import { fmtDateShort, fmtNum, fmtWeeks } from "@/lib/utils/format";

/** Shared column widths, so the header row lines up with the rows under it. */
const DATE_COL = "w-[112px]";
const QTY_COL = "w-[132px]";
const ACTION_COL = "sm:w-[200px]";

/** Column labels above a list of decision rows. Wide screens only — a phone reads each row as a stack. */
export function DecisionListHeader() {
  return (
    <div className="hidden items-center gap-5 border-b border-[var(--border-strong)] pb-2 text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--text-muted)] sm:flex">
      <span className={cn(DATE_COL, "flex-none text-right")}>Required by</span>
      <span className="w-[3px] flex-none" />
      <span className="flex min-w-0 flex-1 items-center gap-3">
        <span className="flex-1">Decision</span>
        <span className={cn(QTY_COL, "hidden flex-none text-right lg:block")}>Quantity</span>
        <span className={cn(ACTION_COL, "flex-none text-right")}>Action</span>
      </span>
    </div>
  );
}

export function DecisionRow({
  decision,
  context,
  onRelease,
  onUndo,
}: {
  decision: PendingDecision;
  /** The programme, when the list spans more than one. */
  context?: string;
  onRelease: () => void;
  onUndo?: () => void;
}) {
  const coveredByStock = decision.quantity !== undefined && decision.quantity < 0.5;

  // One definition of the row's action, placed twice: inline at the end of the
  // row where there is room for it, and on its own line underneath where there
  // is not. A phone cannot afford "Test it in Scenario Lab" competing with the
  // title for the same 200px.
  const action = decision.released ? (
    <span className="flex min-w-0 items-center justify-end gap-2.5">
      <span
        className="inline-flex min-w-0 items-center gap-1 text-[12px] font-medium text-[var(--risk-positive)]"
        title={decision.releasedTo ? `Released to ${decision.releasedTo}` : "Released without a supplier"}
      >
        <Check className="size-3.5 flex-none" />
        <span className="truncate">
          {decision.releasedTo ? `Released to ${decision.releasedTo}` : "Released"}
        </span>
      </span>
      {onUndo ? (
        <button
          type="button"
          onClick={onUndo}
          className="flex-none text-[11.5px] text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
          style={{ transitionDuration: "var(--duration-fast)" }}
        >
          Undo
        </button>
      ) : null}
    </span>
  ) : decision.materialId && coveredByStock ? (
    // Stock already covers it: there is no order to place, and an empty cell
    // read as a missing button rather than as "nothing to do".
    <span className="text-[12px] text-[var(--text-muted)]" title="On-hand and inbound stock cover the requirement">
      No order needed
    </span>
  ) : decision.materialId ? (
    <button
      type="button"
      onClick={onRelease}
      className="inline-flex h-8 flex-none items-center whitespace-nowrap rounded-[var(--radius-sm)] border border-[var(--border-strong)] px-2.5 text-[12px] font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--interaction-hover)]"
      style={{ transitionDuration: "var(--duration-fast)" }}
    >
      Release…
    </button>
  ) : (
    <Link
      href={decision.href}
      className="inline-flex h-8 flex-none items-center whitespace-nowrap rounded-[var(--radius-sm)] border border-[var(--border-strong)] px-2.5 text-[12px] font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--interaction-hover)]"
      style={{ transitionDuration: "var(--duration-fast)" }}
    >
      {decision.cta}
    </Link>
  );

  const urgencyColor =
    decision.urgency === "overdue"
      ? "text-[var(--risk-critical)]"
      : decision.urgency === "urgent"
        ? "text-[var(--risk-warning)]"
        : "text-[var(--text-primary)]";

  const weeks = decision.weeksAway !== undefined ? fmtWeeks(decision.weeksAway) : undefined;

  return (
    <div
      className={cn("group py-3 transition-colors sm:py-3.5", decision.released && "opacity-70")}
      style={{ transitionDuration: "var(--duration-fast)" }}
    >
      <div className="flex items-center gap-3 sm:gap-5">
        {/* A date column costs 100px a phone does not have. Below sm: the date
            leads the second line instead, where it is read in the same glance
            as the lead time. */}
        <div className={cn(DATE_COL, "hidden flex-none text-right sm:block")}>
          <div className={cn("text-[13px] font-medium tabular-nums", urgencyColor)}>
            {decision.date ? fmtDateShort(decision.date) : "Undated"}
          </div>
          <div className="text-[11px] text-[var(--text-muted)]">
            {decision.dateLabel.toLowerCase()}
            {weeks ? ` · ${weeks}` : ""}
          </div>
        </div>

        <span
          className={cn(
            // Runs the height of the row on a phone, where the row is a stack.
            "w-[3px] flex-none self-stretch rounded-full sm:h-8 sm:self-auto",
            decision.urgency === "overdue"
              ? "bg-[var(--risk-critical)]"
              : decision.urgency === "urgent"
                ? "bg-[var(--risk-warning)]"
                : decision.urgency === "soon"
                  ? "bg-[var(--state-validated)]"
                  : "bg-[var(--border-strong)]"
          )}
        />

        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[13.5px] font-medium leading-snug text-[var(--text-primary)] sm:truncate">
              {decision.title}
            </div>
            <div className="text-[12px] leading-snug text-[var(--text-muted)] sm:truncate">
              <span className={cn("font-medium tabular-nums sm:hidden", urgencyColor)}>
                {decision.date ? `${decision.dateLabel} ${fmtDateShort(decision.date)}` : "Undated"}
                {weeks ? ` · ${weeks}` : ""}
              </span>
              <span className="sm:hidden"> · </span>
              {context ? (
                <>
                  <span className="text-[var(--text-secondary)]">{context}</span>
                  {" · "}
                </>
              ) : null}
              {decision.consequence}
              {decision.drivenBy.length > 0
                ? ` · for ${decision.drivenBy[0]}${
                    decision.drivenBy.length > 1 ? ` +${decision.drivenBy.length - 1}` : ""
                  }`
                : ""}
            </div>
            {/* On a phone the action takes its own line rather than squeezing the title. */}
            <div className="mt-2 flex sm:hidden">{action}</div>
          </div>

          {/* On a wide screen the row otherwise trails off into empty space;
              the quantity under decision is the figure that belongs there. */}
          <div className={cn(QTY_COL, "hidden flex-none text-right lg:block")}>
            {decision.quantity && decision.quantity > 0 ? (
              <>
                <div className="text-[13px] font-medium tabular-nums text-[var(--text-primary)]">
                  {fmtNum(Math.round(decision.quantity))}
                </div>
                <div className="text-[11px] text-[var(--text-muted)]">{decision.uom ?? "units"}</div>
              </>
            ) : decision.materialId && coveredByStock ? (
              <div className="text-[12px] text-[var(--text-muted)]">Covered by stock</div>
            ) : (
              <div className="text-[12px] text-[var(--text-muted)]">—</div>
            )}
          </div>

          <div className={cn(ACTION_COL, "hidden flex-none justify-end sm:flex")}>
            {action}
          </div>
        </div>
      </div>
    </div>
  );
}
