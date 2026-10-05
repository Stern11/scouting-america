"use client";

/**
 * One action in the work queue. Collapsed it is an instruction and a reason;
 * opened it is the why, the evidence and the arithmetic — enough to approve
 * without taking the priority on trust.
 */

import { useEffect, useRef } from "react";
import Link from "next/link";
import { Check, ChevronDown, X } from "lucide-react";
import type { PlannerAction } from "@/types/transition";
import { Button } from "@/components/ui/button";
import { PriorityBadge } from "@/components/shared/state-badge";
import { CalcLines } from "@/components/transition/calc-lines";
import { cn } from "@/lib/utils/cn";
import { fmtDateShort, fmtMoney } from "@/lib/utils/format";

export const ACTION_TYPE_LABEL: Record<PlannerAction["type"], string> = {
  CONFIRM_SUCCESSOR: "Confirm successor",
  REPLENISH_SUCCESSOR: "Replenish",
  HOLD_REPLENISHMENT: "Hold replenishment",
  TRANSFER_INVENTORY: "Transfer inventory",
  ACCELERATE_INBOUND: "Expedite inbound",
  REVIEW_TRANSITION: "Legacy sell-through",
  MARK_LEGACY_DEPLETION: "Close out legacy",
  UPDATE_DEMAND_ASSUMPTION: "Update forecast",
  INVESTIGATE_STORE_RISK: "Investigate stores",
};

export function QueueItem({
  action,
  open,
  onToggle,
  onApprove,
  onDismiss,
  currency,
}: {
  action: PlannerAction;
  open: boolean;
  onToggle: () => void;
  onApprove: () => void;
  onDismiss: () => void;
  currency: string;
}) {
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (open) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [open]);

  return (
    <li ref={ref} className={cn("border-b border-[var(--border)] last:border-b-0", open && "bg-[var(--surface)]")}>
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2 px-2 py-3 sm:flex-nowrap">
        <button type="button" onClick={onToggle} className="flex min-w-0 flex-1 items-start gap-3 text-left" aria-expanded={open}>
          <span className="w-[70px] flex-none pt-0.5">
            <PriorityBadge priority={action.priority} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] font-medium text-[var(--text-primary)]">{action.title}</span>
            <span className="mt-0.5 block text-[12.5px] leading-snug text-[var(--text-muted)]">
              <span className="text-[var(--text-secondary)]">{action.transitionName}</span> · {action.summary}
            </span>
          </span>
          <span className="hidden w-[150px] flex-none text-right text-[12px] text-[var(--text-muted)] md:block">
            <span className="block">{ACTION_TYPE_LABEL[action.type]}</span>
            {action.dueDate ? <span className="block tabular-nums">Due {fmtDateShort(action.dueDate)}</span> : null}
          </span>
          <ChevronDown className={cn("mt-1 size-4 flex-none text-[var(--text-muted)] transition-transform", open && "rotate-180")} />
        </button>
        <div className="flex flex-none gap-1 pl-[82px] sm:pl-0">
          <Button size="sm" onClick={onApprove}>
            <Check /> {action.type === "CONFIRM_SUCCESSOR" ? "Confirm" : "Approve"}
          </Button>
          <Button size="sm" variant="ghost" aria-label="Dismiss" onClick={onDismiss}>
            <X />
          </Button>
        </div>
      </div>

      {open ? (
        <div className="grid grid-cols-1 gap-x-10 gap-y-4 px-2 pb-4 pl-[94px] md:grid-cols-2">
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
            {action.impact ? <p className="mt-2.5 text-[12.5px] font-medium text-[var(--text-primary)]">{action.impact}</p> : null}
            <div className="mt-2.5 flex flex-wrap gap-x-4 text-[12px] text-[var(--text-muted)]">
              {action.storesAffected ? <span>{action.storesAffected} stores affected</span> : null}
              {action.valueAtStake !== undefined ? <span>{fmtMoney(action.valueAtStake, currency)} at stake</span> : null}
              <Link href={`/transitions/${encodeURIComponent(action.transitionId)}`} className="text-[var(--accent)] hover:underline">
                Open transition →
              </Link>
            </div>
          </div>
          {action.calculation.length > 0 ? (
            <div>
              <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-muted)]">Calculation</div>
              <CalcLines lines={action.calculation} className="mt-1" />
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
