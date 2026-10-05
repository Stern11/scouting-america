/**
 * Status chips.
 *
 * One planner-facing state per transition — never status, severity, type and
 * confidence at once. Priority chips belong to actions; store-state chips to
 * store rows. Each uses the risk palette only where it means risk.
 */

import type {
  ActionPriority,
  RelationshipConfidence,
  StoreStockState,
  TransitionStatus,
} from "@/types/transition";
import { cn } from "@/lib/utils/cn";

const CHIP = "inline-flex items-center rounded-full px-2 py-[3px] text-[11px] font-medium leading-none whitespace-nowrap";

const STATUS: Record<TransitionStatus, { label: string; className: string }> = {
  ACTION_NEEDED: { label: "Action needed", className: "bg-[var(--risk-critical-soft)] text-[var(--risk-critical)]" },
  MONITOR: { label: "Monitor", className: "bg-[var(--risk-warning-soft)] text-[var(--risk-warning)]" },
  TRANSITIONING: { label: "Transitioning", className: "bg-[var(--accent-soft)] text-[var(--accent)]" },
  HEALTHY: { label: "Healthy", className: "bg-[var(--risk-positive-soft)] text-[var(--risk-positive)]" },
  COMPLETE: { label: "Complete", className: "bg-[var(--state-unknown-soft)] text-[var(--text-secondary)]" },
};

export function StatusBadge({ status, className }: { status: TransitionStatus; className?: string }) {
  const config = STATUS[status];
  return <span className={cn(CHIP, config.className, className)}>{config.label}</span>;
}

export function statusLabel(status: TransitionStatus): string {
  return STATUS[status].label;
}

export const STATUS_DOT: Record<TransitionStatus, string> = {
  ACTION_NEEDED: "bg-[var(--risk-critical)]",
  MONITOR: "bg-[var(--risk-warning)]",
  TRANSITIONING: "bg-[var(--accent)]",
  HEALTHY: "bg-[var(--risk-positive)]",
  COMPLETE: "bg-[var(--state-unknown)]",
};

const PRIORITY: Record<ActionPriority, { label: string; className: string }> = {
  CRITICAL: { label: "Critical", className: "bg-[var(--risk-critical)] text-[var(--text-on-accent)]" },
  HIGH: { label: "High", className: "bg-[var(--risk-critical-soft)] text-[var(--risk-critical)]" },
  MEDIUM: { label: "Medium", className: "bg-[var(--risk-warning-soft)] text-[var(--risk-warning)]" },
  MONITOR: { label: "Monitor", className: "bg-[var(--state-unknown-soft)] text-[var(--text-secondary)]" },
};

export function PriorityBadge({ priority, className }: { priority: ActionPriority; className?: string }) {
  const config = PRIORITY[priority];
  return (
    <span className={cn(CHIP, "uppercase tracking-[0.06em] text-[10px]", config.className, className)}>
      {config.label}
    </span>
  );
}

const STORE_STATE: Record<StoreStockState, { label: string; className: string }> = {
  LEGACY_ONLY: { label: "Legacy only", className: "bg-[var(--lineage-legacy-soft)] text-[var(--lineage-legacy)]" },
  MIXED: { label: "Selling both", className: "bg-[var(--state-unknown-soft)] text-[var(--text-secondary)]" },
  NEW_ONLY: { label: "Transitioned", className: "bg-[var(--lineage-successor-soft)] text-[var(--lineage-successor)]" },
  NO_STOCK: { label: "No stock", className: "bg-[var(--risk-critical-soft)] text-[var(--risk-critical)]" },
};

export function StoreStateBadge({ state }: { state: StoreStockState }) {
  const config = STORE_STATE[state];
  return <span className={cn(CHIP, config.className)}>{config.label}</span>;
}

export function storeStateLabel(state: StoreStockState): string {
  return STORE_STATE[state].label;
}

const CONFIDENCE: Record<RelationshipConfidence, string> = {
  HIGH: "text-[var(--risk-positive)]",
  MEDIUM: "text-[var(--risk-warning)]",
  LOW: "text-[var(--risk-critical)]",
};

export function ConfidenceText({ confidence }: { confidence: RelationshipConfidence }) {
  return (
    <span className={cn("font-semibold", CONFIDENCE[confidence])}>
      {confidence === "HIGH" ? "High" : confidence === "MEDIUM" ? "Medium" : "Low"}
    </span>
  );
}
