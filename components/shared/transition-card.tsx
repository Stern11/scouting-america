/**
 * One product transition as a card: what it is, how far sales have moved to
 * the new version, the one thing that matters, and the one thing to do.
 *
 * Deliberately four lines, and not one big link — the small arrow opens it.
 * Every other number lives one click away.
 */

import { Check } from "lucide-react";
import type { TransitionView } from "@/types/transition";
import { versionLabels } from "@/lib/transitions/names";
import { MeritBadge } from "./merit-badge";
import { OpenArrow } from "./open-arrow";
import { Trail } from "./trail";
import { StatusBadge } from "./state-badge";
import { cn } from "@/lib/utils/cn";

export function TransitionCard({
  view,
  compact = false,
  showStatus = false,
}: {
  view: TransitionView;
  compact?: boolean;
  /** Off where the surrounding group already says it. */
  showStatus?: boolean;
}) {
  const urgent = view.status === "ACTION_NEEDED";
  const quiet = view.status === "COMPLETE" || view.nextStep === "Keep monitoring" || view.nextStep === "Nothing to do";
  const href = `/transitions/${encodeURIComponent(view.id)}`;
  return (
    <div
      className={cn(
        "flex flex-col rounded-[14px] border bg-[var(--surface)] p-4",
        urgent ? "border-[var(--risk-critical)]/35" : "border-[var(--border)]"
      )}
    >
      <div className="flex items-start gap-3">
        <MeritBadge name={view.name} category={view.category} status={view.status} size={compact ? 38 : 46} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-[15px] font-semibold leading-snug text-[var(--text-primary)]">{view.name}</h3>
            {showStatus ? <StatusBadge status={view.status} className="flex-none" /> : null}
          </div>
          <div className="mt-0.5 text-[12px] text-[var(--text-muted)]">
            {[view.program, view.category].filter(Boolean).join(" · ")}
          </div>
        </div>
        <OpenArrow href={href} label={`Open ${view.name}`} />
      </div>

      {!compact ? (
        <>
          <Trail
            from={view.lineage.predecessors}
            to={view.lineage.successors}
            progress={view.progress}
            labels={versionLabels(view.lineage.reason, view.lineage.successors, view.lineage.predecessors)}
            className="mt-4"
          />
          <p className="mt-3 flex-1 text-[13.5px] leading-snug text-[var(--text-primary)]">{view.headline}</p>
        </>
      ) : null}

      {/* The next step, read as a note — not a button. */}
      <div
        className={cn(
          "mt-3 flex items-center gap-2 border-t pt-3 text-[13px]",
          quiet ? "border-[var(--border)] text-[var(--text-secondary)]" : "border-[var(--border)]"
        )}
      >
        {quiet ? (
          <>
            <Check className="size-3.5 flex-none text-[var(--risk-positive)]" />
            <span>{view.status === "COMPLETE" ? "Transition complete" : "On track — nothing to do"}</span>
          </>
        ) : (
          <>
            <span className="flex-none text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">Next</span>
            <span className={cn("min-w-0 font-medium", urgent ? "text-[var(--risk-critical)]" : "text-[var(--accent)]")}>
              {view.nextStep}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
