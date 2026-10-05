"use client";

/**
 * What the planner can do about this transition today, and what has already
 * been decided — the recommendation on top, the record underneath.
 */

import { useMemo } from "react";
import { Check, RotateCcw, X } from "lucide-react";
import type { PlanningDataset } from "@/types/dataset";
import type { PlannerAction, TransitionView } from "@/types/transition";
import { useDatasetStore } from "@/stores/dataset-store";
import { Button } from "@/components/ui/button";
import { PriorityBadge } from "@/components/shared/state-badge";
import { fmtDateShort } from "@/lib/utils/format";
import { CalcLines } from "./calc-lines";
import { useDecisions } from "./use-decisions";

export function TransitionActions({ view }: { view: TransitionView }) {
  const actionStates = useDatasetStore((s) => s.actionStates);
  const decisions = useDecisions(view.id);
  const open = view.actions.filter((a) => !actionStates[a.id]);
  const handled = view.actions.filter((a) => actionStates[a.id]);

  if (view.actions.length === 0) {
    return (
      <p className="text-[13px] text-[var(--text-muted)]">
        {view.status === "COMPLETE"
          ? "This transition is complete — nothing to do."
          : "Nothing to do today. Usable stock covers demand and inbound supply in every store."}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {open.map((a) => (
        <ActionBlock
          key={a.id}
          action={a}
          onDone={() => decisions.act(a.id, "DONE", `Approved: ${a.title}`)}
          onDismiss={() => decisions.act(a.id, "DISMISSED", `Dismissed: ${a.title}`)}
        />
      ))}
      {handled.length > 0 ? (
        <ul className="divide-y divide-[var(--border)] border-y border-[var(--border)]">
          {handled.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 py-2 text-[13px]">
              <span className="text-[var(--text-secondary)]">
                <span className={actionStates[a.id]?.disposition === "DONE" ? "text-[var(--risk-positive)]" : "text-[var(--text-muted)]"}>
                  {actionStates[a.id]?.disposition === "DONE" ? "Approved" : "Dismissed"}
                </span>{" "}
                · {a.title}
              </span>
              <button
                type="button"
                className="inline-flex items-center gap-1 text-[12px] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                onClick={() => decisions.reopen(a.id, `Reopened: ${a.title}`)}
              >
                <RotateCcw className="size-3" /> Reopen
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function ActionBlock({ action, onDone, onDismiss }: { action: PlannerAction; onDone: () => void; onDismiss: () => void }) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <PriorityBadge priority={action.priority} />
            {action.dueDate ? <span className="text-[11.5px] text-[var(--text-muted)]">Due {fmtDateShort(action.dueDate)}</span> : null}
          </div>
          <div className="mt-1.5 text-[15px] font-semibold text-[var(--text-primary)]">{action.title}</div>
          <div className="mt-0.5 text-[12.5px] text-[var(--text-secondary)]">{action.summary}</div>
        </div>
        <div className="flex flex-none gap-1.5">
          <Button size="sm" onClick={onDone}>
            <Check /> Approve
          </Button>
          <Button size="sm" variant="ghost" onClick={onDismiss}>
            <X /> Dismiss
          </Button>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-x-8 gap-y-3 border-t border-[var(--border)] pt-3 md:grid-cols-2">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-muted)]">Why</div>
          <ul className="mt-1.5 space-y-1 text-[12.5px] leading-snug text-[var(--text-secondary)]">
            {action.reasons.map((r) => (
              <li key={r} className="flex gap-2">
                <span className="mt-[7px] size-1 flex-none rounded-full bg-[var(--text-muted)]" />
                {r}
              </li>
            ))}
          </ul>
          {action.impact ? <p className="mt-2 text-[12.5px] font-medium text-[var(--text-primary)]">{action.impact}</p> : null}
        </div>
        {action.calculation.length > 0 ? (
          <div>
            <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-muted)]">Calculation</div>
            <CalcLines lines={action.calculation} className="mt-1" />
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Decisions on this transition: the dataset's own record plus everything decided here. */
export function TransitionHistory({ view, dataset }: { view: TransitionView; dataset: PlanningDataset }) {
  const auditLog = useDatasetStore((s) => s.auditLog);
  const entries = useMemo(() => {
    const fromData = dataset.history
      .filter((h) => h.transitionId === view.id)
      .map((h) => ({ id: h.id, at: h.date, actor: h.actor, text: h.text }));
    const fromHere = auditLog.filter((e) => e.transitionId === view.id).map((e) => ({ id: e.id, at: e.at, actor: e.actor, text: e.text }));
    return [...fromData, ...fromHere].sort((a, b) => b.at.localeCompare(a.at));
  }, [auditLog, dataset.history, view.id]);

  if (entries.length === 0) return <p className="text-[13px] text-[var(--text-muted)]">No decisions recorded yet.</p>;
  return (
    <ol className="space-y-2.5">
      {entries.map((e) => (
        <li key={e.id} className="grid grid-cols-[72px_minmax(0,1fr)] gap-3 text-[13px]">
          <span className="tabular-nums text-[var(--text-muted)]">{fmtDateShort(e.at)}</span>
          <span className="text-[var(--text-secondary)]">
            <span className="font-medium text-[var(--text-primary)]">{e.actor}</span> · {e.text}
          </span>
        </li>
      ))}
    </ol>
  );
}
