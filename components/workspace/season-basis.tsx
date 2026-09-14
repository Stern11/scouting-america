/**
 * Which past seasons the plan is built from (V2 §16.3).
 *
 * The basis used to be invisible and fixed: the engine took the most recent
 * comparable season and silently dropped the rest, and no screen said so. A
 * planner cannot judge a forecast without knowing what it was read from, so
 * the seasons are shown, the derived growth is stated, and both are theirs to
 * change.
 */

"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { fmtUnits } from "@/lib/utils/format";
import type { PlanningSituation } from "@/types/situation";

export function SeasonBasis({
  situation,
  onChange,
}: {
  situation: PlanningSituation;
  onChange: (periods: string[]) => void;
}) {
  const { availableSeasons, selectedSeasons } = situation;

  // Nothing to choose between is not a control, it is a caption.
  if (availableSeasons.length <= 1) {
    return (
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[12.5px] text-[var(--text-muted)]">
        <span>
          Planning from{" "}
          <span className="font-medium text-[var(--text-secondary)]">
            {availableSeasons[0]?.period ?? "no prior season"}
          </span>
        </span>
        <span className="text-[var(--text-muted)]">·</span>
        <span>{situation.seasonBasisLabel}</span>
      </div>
    );
  }

  const toggle = (period: string) => {
    const next = selectedSeasons.includes(period)
      ? selectedSeasons.filter((p) => p !== period)
      : [...selectedSeasons, period];
    // Never leave the basis empty — with nothing selected there is no history
    // to plan from, and the engine would silently fall back anyway.
    onChange(next.length > 0 ? next.sort() : selectedSeasons);
  };

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <span className="text-[11px] font-medium uppercase tracking-[0.09em] text-[var(--text-muted)]">
        Seasons in basis
      </span>

      <div className="flex flex-wrap items-center gap-1.5">
        {availableSeasons.map(({ period, units, itemCount }) => {
          const active = selectedSeasons.includes(period);
          const only = active && selectedSeasons.length === 1;
          return (
            <button
              key={period}
              type="button"
              onClick={() => toggle(period)}
              aria-pressed={active}
              title={
                only
                  ? "The basis cannot be empty — select another season before removing this one"
                  : active
                    ? `Remove ${period} from the basis`
                    : `Add ${period} to the basis`
              }
              className={cn(
                "inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-[var(--radius-sm)] border px-2.5 text-[12.5px] tabular-nums transition-colors",
                active
                  ? "border-[var(--interaction-selected-border)] bg-[var(--interaction-selected)] font-medium text-[var(--text-primary)]"
                  : "border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]",
                only && "cursor-default"
              )}
              style={{ transitionDuration: "var(--duration-fast)" }}
            >
              {active ? <Check className="size-3" /> : null}
              {period}
              <span className="text-[11px] font-normal text-[var(--text-muted)]">
                {fmtUnits(units, true)} · {itemCount} item{itemCount === 1 ? "" : "s"}
              </span>
            </button>
          );
        })}
      </div>

      <SeasonConclusion label={situation.seasonBasisLabel} />
    </div>
  );
}

/**
 * The growth rate the selected seasons imply.
 *
 * Pulled out of the sentence and given weight, because it is the one number in
 * this control a planner will argue with — and a figure that drives every
 * carry-forward volume on the page should not read as a footnote.
 */
function SeasonConclusion({ label }: { label: string }) {
  const match = /([+\-−]?\d+(?:\.\d+)?%)/.exec(label);
  if (!match?.[1]) {
    return <span className="text-[12.5px] text-[var(--text-secondary)]">{label}</span>;
  }
  const [before, after] = label.split(match[1]);
  const positive = !match[1].startsWith("-") && !match[1].startsWith("\u2212");

  return (
    <span className="text-[12.5px] text-[var(--text-secondary)]">
      {before}
      <span
        className={cn(
          "text-[14px] font-semibold tabular-nums",
          positive ? "text-[var(--risk-positive)]" : "text-[var(--risk-critical)]"
        )}
      >
        {match[1]}
      </span>
      {after}
    </span>
  );
}
