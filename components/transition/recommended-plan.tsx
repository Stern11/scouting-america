"use client";

/**
 * The plan, as numbered steps — the answer the whole page builds to.
 *
 * Only what a planner would actually do this week: up to three steps, each
 * one instruction and one reason. Approving happens on Actions, where the
 * reasons and arithmetic sit beside the button.
 */

import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import type { TransitionView } from "@/types/transition";
import { useDatasetStore } from "@/stores/dataset-store";
import { cn } from "@/lib/utils/cn";
import { fmtDateShort } from "@/lib/utils/format";

export function RecommendedPlan({ view }: { view: TransitionView }) {
  const actionStates = useDatasetStore((s) => s.actionStates);
  const steps = view.actions.filter((a) => a.priority !== "MONITOR").slice(0, 3);

  if (steps.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-[18px] border border-[var(--border)] bg-[var(--surface)] p-5">
        <span className="grid size-9 place-items-center rounded-full bg-[var(--risk-positive-soft)]">
          <Check className="size-4 text-[var(--risk-positive)]" />
        </span>
        <p className="text-[14px] text-[var(--text-primary)]">
          {view.status === "COMPLETE" ? "This switch is complete." : "Nothing to do — every shop has enough until new stock arrives."}
        </p>
      </div>
    );
  }

  return (
    <ol className="grid grid-cols-1 gap-3 md:grid-cols-3">
      {steps.map((a, i) => {
        const state = actionStates[a.id];
        const done = state?.disposition === "DONE";
        return (
          <li
            key={a.id}
            className={cn(
              "flex flex-col rounded-[18px] border bg-[var(--surface)] p-5 transition-colors",
              done ? "border-[var(--risk-positive)]/40 bg-[var(--risk-positive-soft)]/40" : "border-[var(--border)]"
            )}
          >
            <div className="flex items-center gap-2.5">
              <span
                className={cn(
                  "grid size-7 flex-none place-items-center rounded-full text-[13px] font-bold",
                  done ? "bg-[var(--risk-positive)] text-[var(--text-on-accent)]" : "bg-[var(--accent)] text-[var(--text-on-accent)]"
                )}
              >
                {done ? <Check className="size-4" /> : i + 1}
              </span>
              {a.dueDate && !done ? (
                <span className="text-[12px] text-[var(--text-muted)]">by {fmtDateShort(a.dueDate)}</span>
              ) : null}
            </div>
            <h4 className="mt-3 text-[16px] font-semibold leading-snug text-[var(--text-primary)]">{a.title}</h4>
            <p className="mt-1 flex-1 text-[13px] leading-snug text-[var(--text-secondary)]">{a.impact ?? a.summary}</p>
            <div className="mt-4 flex items-center gap-2">
              {done ? <span className="text-[13px] font-medium text-[var(--risk-positive)]">Approved</span> : null}
              <Link
                href={`/actions?focus=${encodeURIComponent(a.id)}`}
                className="ml-auto inline-flex items-center gap-1 text-[13px] font-medium text-[var(--accent)] hover:underline"
              >
                Review in Actions <ArrowRight className="size-3.5" />
              </Link>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
