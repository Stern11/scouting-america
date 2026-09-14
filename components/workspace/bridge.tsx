/**
 * The business-to-plan bridge (V2 §42, §63).
 *
 * One question: how much of the expected business does the formal plan
 * represent, and what accounts for the rest?
 *
 * Form: this is a part-to-whole story, so it is one bar the width of the
 * expected business, split into the three layers that make it up. An earlier
 * version drew four free-standing columns; a reader had to subtract across a
 * gap to see the gap itself, and the smallest segment collapsed to an
 * unreadable hairline with a label floating above it. A single composed bar
 * makes "72% represented" a shape rather than a number to be worked out.
 *
 * Colour is the planning-state palette, which already encodes exactly this
 * distinction — official plan / validated inference / unknown — so the fill
 * carries provenance rather than being decoration.
 */

"use client";

import { useMemo, useState } from "react";
import type { CandidateItem, ReconciliationBridge } from "@/types/situation";
import { fmtMoney, fmtPct, fmtUnits } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";

interface Segment {
  key: string;
  label: string;
  value: number;
  token: string;
  /** Ink colour for a label sitting on top of this fill. */
  onFill: string;
  detail: string;
  units?: number;
}

/** Below this share of the bar an inside label cannot fit without clipping. */
const INSIDE_LABEL_MIN_SHARE = 0.14;

export function BusinessToPlanBridge({
  bridge,
  candidates = [],
  className,
}: {
  bridge: ReconciliationBridge;
  candidates?: readonly CandidateItem[];
  className?: string;
}) {
  const [hovered, setHovered] = useState<string | null>(null);

  const { expectedValue, formalValue, explainedValue, unexplainedValue, currency } = bridge;
  const total = Math.max(expectedValue, formalValue + explainedValue + unexplainedValue, 1);
  const explainingCount = candidates.filter(
    (c) => c.disposition !== "already_represented" && c.disposition !== "intentional_exit"
  ).length;

  const segments: Segment[] = [
    {
      key: "formal",
      label: "Formal plan",
      value: formalValue,
      token: "--state-formal",
      onFill: "var(--text-on-accent)",
      detail: `${fmtUnits(bridge.formalUnits, true)} across items that already exist`,
      units: bridge.formalUnits,
    },
    {
      key: "explained",
      label: "Explained by prior items",
      value: explainedValue,
      token: "--state-validated",
      onFill: "var(--text-on-accent)",
      // The items the bridge's explained value is summed from — not every prior
      // item, most of which are already represented.
      detail: `${explainingCount} prior-season item${explainingCount === 1 ? "" : "s"} could account for this`,
    },
    {
      key: "unexplained",
      label: "Unexplained",
      value: unexplainedValue,
      token: "--state-unknown",
      onFill: "var(--text-primary)",
      detail: "No prior item accounts for this",
    },
  ].filter((s) => s.value > 0);

  // Where the unresolved business actually sits. The bar answers "how much";
  // this answers "where" — the second question a planner asks, and the one
  // that decides who they go and talk to. Planned value, the same basis as the
  // "explained" segment above, so the rows are this year's business rather
  // than last year's actuals beside a this-year bar.
  const byFamily = useMemo(() => {
    const totals = new Map<string, number>();
    for (const c of candidates) {
      if (c.disposition === "already_represented" || c.disposition === "intentional_exit") continue;
      totals.set(c.productFamily, (totals.get(c.productFamily) ?? 0) + c.plannedValue);
    }
    return [...totals.entries()].map(([family, value]) => ({ family, value })).sort((a, b) => b.value - a.value);
  }, [candidates]);

  const familyMax = Math.max(...byFamily.map((f) => f.value), 1);

  return (
    <div className={cn("w-full", className)}>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
        <span className="text-[13px] text-[var(--text-secondary)]">
          <span className="font-semibold text-[var(--text-primary)]">{fmtPct(bridge.representedPct)}</span> of{" "}
          {fmtMoney(expectedValue, currency)} expected business is represented
        </span>
        {bridge.expectedUnits !== undefined ? (
          <span className="text-[12px] text-[var(--text-muted)]">
            {fmtUnits(bridge.expectedUnits, true)} expected
          </span>
        ) : null}
      </div>

      {/* One bar, three layers, 2px surface gaps between fills. */}
      <div
        className="flex h-11 w-full items-stretch gap-[2px]"
        role="img"
        aria-label={`Of ${fmtMoney(expectedValue, currency)} expected, ${fmtMoney(formalValue, currency)} is in the formal plan, ${fmtMoney(explainedValue, currency)} is explained by prior items and ${fmtMoney(unexplainedValue, currency)} is unexplained.`}
      >
        {segments.map((segment, index) => {
          const share = segment.value / total;
          const fits = share >= INSIDE_LABEL_MIN_SHARE;
          const dimmed = hovered !== null && hovered !== segment.key;
          return (
            <div
              key={segment.key}
              onMouseEnter={() => setHovered(segment.key)}
              onMouseLeave={() => setHovered(null)}
              title={`${segment.label}\n${fmtMoney(segment.value, currency)} · ${fmtPct(share)} of expected\n${segment.detail}`}
              className={cn(
                "relative flex min-w-[3px] items-center overflow-hidden transition-opacity",
                index === 0 && "rounded-l-[4px]",
                index === segments.length - 1 && "rounded-r-[4px]",
                dimmed && "opacity-45"
              )}
              style={{ width: `${share * 100}%`, background: `var(${segment.token})` }}
            >
              {/* Only label inside when it genuinely fits — a clipped label is
                  worse than none, and the value is still in the legend. */}
              {fits ? (
                <span className="truncate px-2.5 text-[13px] font-semibold" style={{ color: segment.onFill }}>
                  {fmtMoney(segment.value, currency)}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>

      {/* Legend carries identity and the values the bar could not label. */}
      <div className="mt-3 flex flex-wrap gap-x-8 gap-y-2">
        {segments.map((segment) => (
          <button
            key={segment.key}
            type="button"
            onMouseEnter={() => setHovered(segment.key)}
            onMouseLeave={() => setHovered(null)}
            className="flex items-start gap-2 text-left"
          >
            <span
              className="mt-[3px] size-2.5 flex-none rounded-[2px]"
              style={{ background: `var(${segment.token})` }}
              aria-hidden
            />
            <span>
              <span className="block text-[12.5px] font-medium text-[var(--text-primary)]">
                {segment.label} · {fmtMoney(segment.value, currency)}
              </span>
              <span className="block text-[11.5px] text-[var(--text-muted)]">{segment.detail}</span>
            </span>
          </button>
        ))}
      </div>

      {byFamily.length > 0 ? (
        <div className="mt-6 border-t border-[var(--border)] pt-4">
          <div className="mb-2.5 text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-muted)]">
            Where the unresolved business sits
          </div>
          <div className="space-y-1.5">
            {byFamily.map((row) => (
              <div key={row.family} className="grid grid-cols-[150px_1fr_74px] items-center gap-3">
                <span className="truncate text-[12.5px] text-[var(--text-secondary)]">{row.family}</span>
                <span className="h-[10px] w-full overflow-hidden rounded-[3px] bg-[var(--chart-track)]">
                  <span
                    className="block h-full rounded-[3px] bg-[var(--state-validated)]"
                    style={{ width: `${(row.value / familyMax) * 100}%` }}
                  />
                </span>
                <span className="text-right text-[12.5px] font-medium tabular-nums text-[var(--text-primary)]">
                  {fmtMoney(row.value, currency)}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
