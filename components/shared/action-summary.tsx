/**
 * One action, compact: priority, the instruction, the product, why now.
 * Used wherever the work queue is previewed — the full explanation lives on
 * Actions.
 */

import type { PlannerAction } from "@/types/transition";
import { PriorityBadge } from "./state-badge";
import { OpenArrow } from "./open-arrow";
import { fmtDateShort } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";

export function ActionSummary({ action, className }: { action: PlannerAction; className?: string }) {
  return (
    <div className={cn("flex items-start gap-3 border-b border-[var(--border)] px-1 py-3 last:border-b-0", className)}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3">
          <PriorityBadge priority={action.priority} />
          {action.dueDate ? (
            <span className="text-[11.5px] tabular-nums text-[var(--text-muted)]">Due {fmtDateShort(action.dueDate)}</span>
          ) : null}
        </div>
        <div className="mt-1.5 text-[13.5px] font-medium text-[var(--text-primary)]">{action.title}</div>
        <div className="mt-0.5 text-[12px] leading-snug text-[var(--text-muted)]">
          <span className="text-[var(--text-secondary)]">{action.transitionName}</span> · {action.summary}
        </div>
      </div>
      <OpenArrow href={`/actions?focus=${encodeURIComponent(action.id)}`} label={`Review: ${action.title}`} className="mt-6" />
    </div>
  );
}
