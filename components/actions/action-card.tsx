"use client";

/**
 * One thing to do, as a card: which product, how urgent, what to do, why —
 * and two buttons. The numbers behind it open on "Why?".
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, ChevronDown } from "lucide-react";
import type { PlannerAction, TransitionStatus } from "@/types/transition";
import { Button } from "@/components/ui/button";
import { MeritBadge } from "@/components/shared/merit-badge";
import { CalcLines } from "@/components/transition/calc-lines";
import { URGENCY_LABEL } from "@/lib/transitions/action-groups";
import { cn } from "@/lib/utils/cn";
import { fmtDateShort } from "@/lib/utils/format";

const URGENCY_STYLE: Record<PlannerAction["priority"], string> = {
  CRITICAL: "bg-[var(--risk-critical)] text-[var(--text-on-accent)]",
  HIGH: "bg-[var(--risk-critical-soft)] text-[var(--risk-critical)]",
  MEDIUM: "bg-[var(--risk-warning-soft)] text-[var(--risk-warning)]",
  MONITOR: "bg-[var(--surface-sunken)] text-[var(--text-secondary)]",
};

export function ActionCard({
  action,
  category,
  status,
  focused,
  onApprove,
  onDismiss,
}: {
  action: PlannerAction;
  category: string;
  status: TransitionStatus;
  focused: boolean;
  onApprove: () => void;
  onDismiss: () => void;
}) {
  const [open, setOpen] = useState(focused);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focused]);

  return (
    <div
      ref={ref}
      className={cn(
        "rounded-[14px] border bg-[var(--surface)] p-4 transition-shadow",
        focused ? "border-[var(--accent)] shadow-[0_0_0_3px_var(--accent-soft)]" : "border-[var(--border)]"
      )}
    >
      <div className="flex items-center gap-2.5">
        <MeritBadge name={action.transitionName} category={category} status={status} size={30} />
        <Link
          href={`/transitions/${encodeURIComponent(action.transitionId)}`}
          className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-[var(--text-secondary)] hover:text-[var(--accent)]"
        >
          {action.transitionName}
        </Link>
        <span className={cn("flex-none rounded-full px-2 py-[3px] text-[11px] font-semibold", URGENCY_STYLE[action.priority])}>
          {URGENCY_LABEL[action.priority]}
        </span>
      </div>

      <h3 className="mt-3 text-[15px] font-semibold leading-snug text-[var(--text-primary)]">{action.title}</h3>
      <p className="mt-1 text-[12.5px] leading-snug text-[var(--text-secondary)]">{action.impact ?? action.summary}</p>
      {action.dueDate ? <p className="mt-1.5 text-[11.5px] text-[var(--text-muted)]">Do by {fmtDateShort(action.dueDate)}</p> : null}

      <div className="mt-3.5 flex items-center gap-2">
        <Button size="sm" onClick={onApprove}>
          <Check /> {action.type === "CONFIRM_SUCCESSOR" ? "Confirm" : "Approve"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          Not now
        </Button>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="ml-auto inline-flex items-center gap-1 text-[12.5px] font-medium text-[var(--accent)] hover:underline"
        >
          Why? <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
        </button>
      </div>

      {open ? (
        <div className="mt-3 space-y-3 border-t border-[var(--border)] pt-3">
          <ul className="space-y-1 text-[12.5px] leading-snug text-[var(--text-secondary)]">
            {action.reasons.map((r) => (
              <li key={r} className="flex gap-2">
                <span className="mt-[7px] size-1 flex-none rounded-full bg-[var(--text-muted)]" />
                {r}
              </li>
            ))}
          </ul>
          {action.calculation.length > 0 ? <CalcLines lines={action.calculation} /> : null}
        </div>
      ) : null}
    </div>
  );
}
