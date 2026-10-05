"use client";

/**
 * Actions — what does the planner need to do next?
 *
 * One queue across every transition, most urgent first. Each item carries its
 * reasons and its arithmetic; approving or dismissing it is recorded with who
 * and when, and confirming a successor or closing out legacy changes the plan
 * itself, so every page moves with it.
 */

import { Suspense, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { useDataset } from "@/components/dataset/dataset-provider";
import { useDatasetStore } from "@/stores/dataset-store";
import { useCurrentUser } from "@/components/layout/use-current-user";
import { MetricRow, NotAvailable, Page, PageHeader, SectionRule } from "@/components/shared/page";
import { ACTION_TYPE_LABEL, QueueItem } from "@/components/actions/queue-item";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { openActions } from "@/lib/transitions/portfolio";
import { PRIORITY_ORDER } from "@/lib/transitions/actions";
import type { ActionPriority, ActionType, PlannerAction } from "@/types/transition";
import { cn } from "@/lib/utils/cn";
import { fmtDateShort, fmtMoney, fmtNum } from "@/lib/utils/format";

const PRIORITIES: ActionPriority[] = ["CRITICAL", "HIGH", "MEDIUM", "MONITOR"];
const PRIORITY_LABEL: Record<ActionPriority, string> = { CRITICAL: "Critical", HIGH: "High", MEDIUM: "Medium", MONITOR: "Monitor" };
/** Short names the Overview links with. */
const TYPE_ALIASES: Record<string, ActionType> = { confirm: "CONFIRM_SUCCESSOR", transfer: "TRANSFER_INVENTORY", hold: "HOLD_REPLENISHMENT" };
const ALL = "__all";

export default function ActionsPage() {
  return (
    <Suspense fallback={<Page>{null}</Page>}>
      <ActionQueue />
    </Suspense>
  );
}

function ActionQueue() {
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

  const focus = params.get("focus");
  const rawType = params.get("type");
  const typeFilter = rawType ? (TYPE_ALIASES[rawType] ?? (rawType as ActionType)) : undefined;
  const priorityFilter = params.get("priority") as ActionPriority | null;
  const [openId, setOpenId] = useState<string | null>(focus);

  const all = useMemo(() => transitions.flatMap((t) => t.actions), [transitions]);
  const queue = useMemo(() => openActions(transitions, actionStates), [transitions, actionStates]);
  const shown = queue.filter((a) => (!typeFilter || a.type === typeFilter) && (!priorityFilter || a.priority === priorityFilter));
  const handled = all.filter((a) => actionStates[a.id]);

  const counts = useMemo(() => {
    const c: Record<ActionPriority, number> = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, MONITOR: 0 };
    for (const a of queue) c[a.priority] += 1;
    return c;
  }, [queue]);

  const atStake = useMemo(() => {
    const urgent = queue.filter((a) => a.priority === "CRITICAL" || a.priority === "HIGH");
    return {
      stores: urgent.reduce((n, a) => n + (a.type === "TRANSFER_INVENTORY" || a.type === "REPLENISH_SUCCESSOR" || a.type === "ACCELERATE_INBOUND" ? (a.storesAffected ?? 0) : 0), 0),
      value: urgent.reduce((n, a) => n + (a.valueAtStake ?? 0), 0),
    };
  }, [queue]);

  const history = useMemo(() => {
    const names = new Map(transitions.map((t) => [t.id, t.name]));
    const fromData = (dataset?.history ?? []).map((h) => ({ id: h.id, at: h.date, actor: h.actor, text: h.text, transitionId: h.transitionId }));
    return [...fromData, ...auditLog]
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 14)
      .map((e) => ({ ...e, transitionName: names.get(e.transitionId) ?? e.transitionId }));
  }, [auditLog, dataset, transitions]);

  if (!dataset) return null;
  const currency = dataset.metadata.currency;

  const setParam = (key: string, value: string | undefined) => {
    const next = new URLSearchParams(params.toString());
    next.delete("focus");
    if (!value || value === ALL) next.delete(key);
    else next.set(key, value);
    router.replace(`${pathname}${next.toString() ? `?${next}` : ""}`, { scroll: false });
  };

  const note = (text: string) => ({ actor, text, at: new Date().toISOString() });

  const approve = (a: PlannerAction) => {
    // Some approvals change the plan itself, not just the queue.
    if (a.type === "CONFIRM_SUCCESSOR") {
      setOverride(a.transitionId, { relationshipDecision: "CONFIRMED" }, note(`Confirmed ${a.summary.split(" · ")[0]} for ${a.transitionName}`));
    } else if (a.type === "MARK_LEGACY_DEPLETION") {
      setOverride(a.transitionId, { closed: true }, note(`Closed out ${a.transitionName} — old stock is gone`));
    } else {
      setActionState(a.id, a.transitionId, { disposition: "DONE", at: new Date().toISOString() }, note(`Approved: ${a.title}`));
    }
    setOpenId(null);
  };
  const dismiss = (a: PlannerAction) => {
    setActionState(a.id, a.transitionId, { disposition: "DISMISSED", at: new Date().toISOString() }, note(`Dismissed: ${a.title}`));
    setOpenId(null);
  };

  const types = [...new Set(queue.map((a) => a.type))];

  return (
    <Page>
      <PageHeader title="Actions" subtitle="What to do next, across every transition — most urgent first" />

      <MetricRow
        className="border-y border-[var(--border)] py-4"
        items={[
          { label: "Critical", value: fmtNum(counts.CRITICAL), tone: counts.CRITICAL > 0 ? "critical" : "muted", sub: "stockouts or overdue orders" },
          { label: "High", value: fmtNum(counts.HIGH), tone: counts.HIGH > 0 ? "warning" : "muted", sub: "this week" },
          { label: "Medium", value: fmtNum(counts.MEDIUM), sub: "this cycle" },
          { label: "Stores protected", value: fmtNum(atStake.stores), sub: "if critical and high are done" },
          { label: "Value in play", value: atStake.value > 0 ? fmtMoney(atStake.value, currency) : "—", sub: "orders, holds and stock at cost" },
        ]}
      />

      <div className="mt-5 grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_300px]">
        <section>
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            <Chip active={!priorityFilter} onClick={() => setParam("priority", undefined)}>
              All · {queue.length}
            </Chip>
            {PRIORITIES.map((p) => (
              <Chip key={p} active={priorityFilter === p} onClick={() => setParam("priority", p)}>
                {PRIORITY_LABEL[p]} · {counts[p]}
              </Chip>
            ))}
            <Select value={typeFilter ?? ALL} onValueChange={(v) => setParam("type", v)}>
              <SelectTrigger className="ml-auto min-w-[170px]" aria-label="Action type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Any action</SelectItem>
                {types.map((t) => (
                  <SelectItem key={t} value={t}>
                    {ACTION_TYPE_LABEL[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {shown.length === 0 ? (
            <NotAvailable
              title={queue.length === 0 ? "No transitions require attention." : "Nothing matches this filter."}
              detail={
                queue.length === 0
                  ? "All active product transitions have sufficient inventory coverage based on current demand and inbound supply."
                  : undefined
              }
            />
          ) : (
            <ul className="border-y border-[var(--border)]">
              {[...shown]
                .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || a.rank - b.rank)
                .map((a) => (
                  <QueueItem
                    key={a.id}
                    action={a}
                    open={openId === a.id}
                    onToggle={() => setOpenId(openId === a.id ? null : a.id)}
                    onApprove={() => approve(a)}
                    onDismiss={() => dismiss(a)}
                    currency={currency}
                  />
                ))}
            </ul>
          )}

          {handled.length > 0 ? (
            <>
              <SectionRule label={`Handled · ${handled.length}`} />
              <ul className="divide-y divide-[var(--border)] border-y border-[var(--border)]">
                {handled.map((a) => {
                  const state = actionStates[a.id];
                  return (
                    <li key={a.id} className="flex items-center justify-between gap-3 px-2 py-2 text-[13px]">
                      <span className="min-w-0 truncate text-[var(--text-secondary)]">
                        <span className={state?.disposition === "DONE" ? "text-[var(--risk-positive)]" : "text-[var(--text-muted)]"}>
                          {state?.disposition === "DONE" ? "Approved" : "Dismissed"}
                        </span>{" "}
                        · {a.title} <span className="text-[var(--text-muted)]">· {a.transitionName}</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => reopenAction(a.id, a.transitionId, note(`Reopened: ${a.title}`))}
                        className="inline-flex flex-none items-center gap-1 text-[12px] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                      >
                        <RotateCcw className="size-3" /> Reopen
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : null}
        </section>

        <aside>
          <SectionRule label="Decision history" />
          {history.length === 0 ? (
            <p className="text-[13px] text-[var(--text-muted)]">No decisions recorded yet.</p>
          ) : (
            <ol className="space-y-3">
              {history.map((e) => (
                <li key={e.id} className="text-[12.5px] leading-snug">
                  <div className="text-[11.5px] tabular-nums text-[var(--text-muted)]">
                    {fmtDateShort(e.at)} · {e.transitionName}
                  </div>
                  <div className="text-[var(--text-secondary)]">
                    <span className="font-medium text-[var(--text-primary)]">{e.actor}</span> · {e.text}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </aside>
      </div>
    </Page>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 text-[12.5px] tabular-nums transition-colors",
        active
          ? "border-[var(--interaction-selected-border)] bg-[var(--interaction-selected)] font-medium text-[var(--text-primary)]"
          : "border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--interaction-hover)]"
      )}
      style={{ transitionDuration: "var(--duration-fast)" }}
    >
      {children}
    </button>
  );
}
