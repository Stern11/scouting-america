"use client";

/**
 * Actions — what do I do this week?
 *
 * A to-do board, not a report. One sentence says how much there is and how
 * much is urgent; three columns sort the work by what the planner is doing —
 * keeping shops stocked, buying the right amount, tidying up — each most
 * urgent first. Every card is one instruction, one reason, two buttons.
 * Approving is recorded with who and when; confirming a match or closing out
 * a product changes the plan itself, so every page moves with it.
 */

import { Suspense, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, ChevronDown, ClipboardCheck, RotateCcw, ShoppingCart, Store, X } from "lucide-react";
import { useDataset } from "@/components/dataset/dataset-provider";
import { useDatasetStore } from "@/stores/dataset-store";
import { useCurrentUser } from "@/components/layout/use-current-user";
import { Page } from "@/components/shared/page";
import { ActionCard } from "@/components/actions/action-card";
import { openActions } from "@/lib/transitions/portfolio";
import { ACTION_GROUPS, ACTION_TYPE_LABEL, actionGroup, type ActionGroup } from "@/lib/transitions/action-groups";
import type { ActionType, PlannerAction } from "@/types/transition";
import { cn } from "@/lib/utils/cn";
import { fmtDateShort } from "@/lib/utils/format";

/** Short names other pages link with. */
const TYPE_ALIASES: Record<string, ActionType> = { confirm: "CONFIRM_SUCCESSOR", transfer: "TRANSFER_INVENTORY", hold: "HOLD_REPLENISHMENT" };
const GROUP_ICON: Record<ActionGroup, typeof Store> = { stock: Store, buy: ShoppingCart, tidy: ClipboardCheck };
const GROUP_TONE: Record<ActionGroup, string> = {
  stock: "bg-[var(--risk-critical-soft)] text-[var(--risk-critical)]",
  buy: "bg-[var(--accent-soft)] text-[var(--accent)]",
  tidy: "bg-[var(--risk-positive-soft)] text-[var(--risk-positive)]",
};
const VISIBLE = 4;

export default function ActionsPage() {
  return (
    <Suspense fallback={<Page>{null}</Page>}>
      <ActionBoard />
    </Suspense>
  );
}

function ActionBoard() {
  const { dataset, transitions } = useDataset();
  const actionStates = useDatasetStore((s) => s.actionStates);
  const auditLog = useDatasetStore((s) => s.auditLog);
  const setActionState = useDatasetStore((s) => s.setActionState);
  const reopenAction = useDatasetStore((s) => s.reopenAction);
  const setOverride = useDatasetStore((s) => s.setOverride);
  const { user } = useCurrentUser();
  const actor = user?.name.split(/\s+/)[0] ?? "Planner";
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [showHistory, setShowHistory] = useState(false);

  const focus = params.get("focus");
  const rawType = params.get("type");
  const typeFilter = rawType ? (TYPE_ALIASES[rawType] ?? (rawType as ActionType)) : undefined;

  const byId = useMemo(() => new Map(transitions.map((t) => [t.id, t])), [transitions]);
  const all = useMemo(() => transitions.flatMap((t) => t.actions), [transitions]);
  const queue = useMemo(
    () => openActions(transitions, actionStates).filter((a) => a.priority !== "MONITOR" && (!typeFilter || a.type === typeFilter)),
    [transitions, actionStates, typeFilter]
  );
  const handled = all.filter((a) => actionStates[a.id]);
  const urgent = queue.filter((a) => a.priority === "CRITICAL").length;
  const thisWeek = queue.filter((a) => a.priority === "CRITICAL" || a.priority === "HIGH").length;

  const history = useMemo(() => {
    const names = new Map(transitions.map((t) => [t.id, t.name]));
    const fromData = (dataset?.history ?? []).map((h) => ({ id: h.id, at: h.date, actor: h.actor, text: h.text, transitionId: h.transitionId }));
    return [...fromData, ...auditLog]
      .sort((a, b) => b.at.localeCompare(a.at))
      .map((e) => ({ ...e, transitionName: names.get(e.transitionId) ?? e.transitionId }));
  }, [auditLog, dataset, transitions]);

  if (!dataset) return null;

  const note = (text: string) => ({ actor, text, at: new Date().toISOString() });
  const approve = (a: PlannerAction) => {
    // Some approvals change the plan itself, not just the queue.
    if (a.type === "CONFIRM_SUCCESSOR") {
      setOverride(a.transitionId, { relationshipDecision: "CONFIRMED" }, note(`Confirmed the replacement for ${a.transitionName}`));
    } else if (a.type === "MARK_LEGACY_DEPLETION") {
      setOverride(a.transitionId, { closed: true }, note(`Closed out ${a.transitionName} — old stock is gone`));
    } else {
      setActionState(a.id, a.transitionId, { disposition: "DONE", at: new Date().toISOString() }, note(`Approved: ${a.title}`));
    }
  };
  const dismiss = (a: PlannerAction) =>
    setActionState(a.id, a.transitionId, { disposition: "DISMISSED", at: new Date().toISOString() }, note(`Not now: ${a.title}`));
  const clearType = () => {
    const next = new URLSearchParams(params.toString());
    next.delete("type");
    router.replace(`${pathname}${next.toString() ? `?${next}` : ""}`, { scroll: false });
  };

  return (
    <Page>
      {/* ---------------- the situation ---------------- */}
      <div className="flex flex-wrap items-end justify-between gap-4 pb-6">
        <div>
          <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em] text-[var(--text-primary)] sm:text-[30px]">
            {queue.length === 0 ? (
              "You're all caught up."
            ) : (
              <>
                {thisWeek} thing{thisWeek === 1 ? "" : "s"} to do this week
                {urgent > 0 ? <span className="text-[var(--risk-critical)]"> — {urgent} urgent</span> : null}
              </>
            )}
          </h1>
          <p className="mt-1.5 text-[14px] text-[var(--text-secondary)]">
            {queue.length - thisWeek > 0 ? `Plus ${queue.length - thisWeek} for later this cycle. ` : ""}
            Approve what you agree with — say &ldquo;not now&rdquo; to the rest.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-[13px] text-[var(--text-secondary)]">
          <CheckCircle2 className="size-4 text-[var(--risk-positive)]" />
          <span className="font-semibold tabular-nums text-[var(--text-primary)]">{handled.length}</span> decided so far
        </div>
      </div>

      {typeFilter ? (
        <button
          type="button"
          onClick={clearType}
          className="mb-4 inline-flex items-center gap-1.5 rounded-full bg-[var(--accent-soft)] px-3 py-1 text-[12.5px] font-medium text-[var(--accent)]"
        >
          Showing only: {ACTION_TYPE_LABEL[typeFilter]} <X className="size-3" />
        </button>
      ) : null}

      {/* ---------------- the board ---------------- */}
      {queue.length === 0 ? (
        <div className="rounded-[18px] border border-[var(--border)] bg-[var(--surface)] p-8 text-center">
          <CheckCircle2 className="mx-auto size-8 text-[var(--risk-positive)]" />
          <p className="mt-3 text-[15px] font-medium text-[var(--text-primary)]">No transitions require attention.</p>
          <p className="mt-1 text-[13px] text-[var(--text-secondary)]">
            Every active product has enough usable stock for current demand and the deliveries on the way.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          {ACTION_GROUPS.map((g) => {
            const items = queue.filter((a) => actionGroup(a) === g.key);
            const Icon = GROUP_ICON[g.key];
            const focusIndex = focus ? items.findIndex((a) => a.id === focus) : -1;
            const showAll = expanded[g.key] || focusIndex >= VISIBLE;
            const visible = showAll ? items : items.slice(0, VISIBLE);
            return (
              <section key={g.key} className="flex flex-col">
                <div className="mb-3 flex items-center gap-2.5">
                  <span className={cn("grid size-9 place-items-center rounded-full", GROUP_TONE[g.key])}>
                    <Icon className="size-[18px]" />
                  </span>
                  <div className="min-w-0">
                    <h2 className="text-[15.5px] font-semibold text-[var(--text-primary)]">
                      {g.title} <span className="font-normal text-[var(--text-muted)]">{items.length}</span>
                    </h2>
                    <p className="truncate text-[12px] text-[var(--text-muted)]">{g.blurb}</p>
                  </div>
                </div>
                <div className="flex flex-col gap-3">
                  {items.length === 0 ? (
                    <p className="rounded-[14px] border border-dashed border-[var(--border)] px-4 py-6 text-center text-[13px] text-[var(--text-muted)]">
                      Nothing here right now.
                    </p>
                  ) : (
                    visible.map((a) => {
                      const t = byId.get(a.transitionId);
                      return (
                        <ActionCard
                          key={a.id}
                          action={a}
                          category={t?.category ?? ""}
                          status={t?.status ?? "MONITOR"}
                          focused={a.id === focus}
                          onApprove={() => approve(a)}
                          onDismiss={() => dismiss(a)}
                        />
                      );
                    })
                  )}
                  {items.length > VISIBLE ? (
                    <button
                      type="button"
                      onClick={() => setExpanded((e) => ({ ...e, [g.key]: !showAll }))}
                      className="inline-flex items-center justify-center gap-1 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] py-2 text-[13px] font-medium text-[var(--accent)] hover:border-[var(--accent)]"
                    >
                      {showAll ? "Show fewer" : `Show ${items.length - VISIBLE} more`}
                      <ChevronDown className={cn("size-3.5 transition-transform", showAll && "rotate-180")} />
                    </button>
                  ) : null}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {/* ---------------- the record ---------------- */}
      <section className="mt-12">
        <button
          type="button"
          onClick={() => setShowHistory((v) => !v)}
          aria-expanded={showHistory}
          className="flex items-center gap-2 text-[15px] font-semibold text-[var(--text-primary)]"
        >
          Recently decided <span className="font-normal text-[var(--text-muted)]">{history.length}</span>
          <ChevronDown className={cn("size-4 text-[var(--text-muted)] transition-transform", showHistory && "rotate-180")} />
        </button>
        {showHistory ? (
          <div className="mt-3 grid grid-cols-1 gap-x-10 lg:grid-cols-2">
            <ol className="divide-y divide-[var(--border)] border-y border-[var(--border)]">
              {history.slice(0, 12).map((e) => (
                <li key={e.id} className="grid grid-cols-[80px_minmax(0,1fr)] gap-3 py-2.5 text-[13px]">
                  <span className="tabular-nums text-[var(--text-muted)]">{fmtDateShort(e.at)}</span>
                  <span className="text-[var(--text-secondary)]">
                    <span className="font-medium text-[var(--text-primary)]">{e.transitionName}</span> · {e.text}
                  </span>
                </li>
              ))}
            </ol>
            {handled.length > 0 ? (
              <ul className="divide-y divide-[var(--border)] border-y border-[var(--border)]">
                {handled.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-3 py-2.5 text-[13px]">
                    <span className="min-w-0 truncate text-[var(--text-secondary)]">
                      <span className={actionStates[a.id]?.disposition === "DONE" ? "text-[var(--risk-positive)]" : "text-[var(--text-muted)]"}>
                        {actionStates[a.id]?.disposition === "DONE" ? "Approved" : "Not now"}
                      </span>{" "}
                      · {a.title}
                    </span>
                    <button
                      type="button"
                      onClick={() => reopenAction(a.id, a.transitionId, note(`Reopened: ${a.title}`))}
                      className="inline-flex flex-none items-center gap-1 text-[12px] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                    >
                      <RotateCcw className="size-3" /> Undo
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </section>
    </Page>
  );
}
