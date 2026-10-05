/**
 * A calculation, rendered as the column of figures a planner would write on
 * paper: operator, label, value, with the result lines ruled off.
 */

import type { CalculationLine } from "@/types/transition";
import { cn } from "@/lib/utils/cn";

export function CalcLines({ lines, className }: { lines: readonly CalculationLine[]; className?: string }) {
  return (
    <dl className={cn("text-[13px]", className)}>
      {lines.map((line, i) => (
        <div
          key={`${line.label}-${i}`}
          className={cn(
            "grid grid-cols-[16px_minmax(0,1fr)_auto] items-baseline gap-x-2 py-1",
            line.op === "=" && "border-t border-[var(--border-strong)] pt-1.5",
            line.emphasis && "font-semibold"
          )}
        >
          <span className="text-center text-[12px] text-[var(--text-muted)]">{line.op ?? ""}</span>
          <dt className={cn("min-w-0", line.emphasis ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)]")}>{line.label}</dt>
          <dd
            className={cn(
              "text-right tabular-nums",
              line.emphasis ? "text-[15px] text-[var(--accent)]" : "text-[var(--text-primary)]"
            )}
          >
            {line.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
