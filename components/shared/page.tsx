/**
 * Page-level layout primitives for V2.
 *
 * The V1 surface leaned on bordered cards for everything, which flattened the
 * hierarchy — a headline number and a footnote looked equally important. These
 * primitives use whitespace and rules instead, so each screen can answer one
 * question at a glance (V2 §59, §61).
 */

import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

export function Page({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mx-auto w-full max-w-[1360px] px-4 pb-16 pt-5 sm:px-8 sm:pt-7", className)}>{children}</div>;
}

/**
 * One title, at most one line of subtitle (V2 §60). Anything longer belongs in
 * a drawer or a tooltip, not the header.
 */
export function PageHeader({
  title,
  subtitle,
  eyebrow,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-6 pb-6">
      <div className="min-w-0">
        {eyebrow ? <div className="mb-1.5">{eyebrow}</div> : null}
        <h1 className="text-[20px] font-semibold leading-tight tracking-[-0.01em] text-[var(--text-primary)]">
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-1 text-[13px] leading-snug text-[var(--text-secondary)]">{subtitle}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-none items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** A labelled hairline. Replaces a card border as the way to separate sections. */
/**
 * A section label.
 *
 * The rule that used to run from the label to the edge of the page pushed the
 * heading away from what it was heading — at a glance the label read as the
 * end of the section above it rather than the start of the one below. The
 * separation is now vertical space alone, and the label itself carries enough
 * contrast to be read rather than merely noticed.
 */
export function SectionRule({ label, action }: { label: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-2 pb-2 pt-7 first:pt-0">
      <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-secondary)]">
        {label}
      </span>
      {action}
    </div>
  );
}

/** The small uppercase caption that sits above a number. */
export function Label({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "block text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-muted)]",
        className
      )}
    >
      {children}
    </span>
  );
}

export type MetricTone = "neutral" | "positive" | "warning" | "critical" | "muted";

const TONE_COLOR: Record<MetricTone, string> = {
  neutral: "text-[var(--text-primary)]",
  positive: "text-[var(--risk-positive)]",
  warning: "text-[var(--risk-warning)]",
  critical: "text-[var(--risk-critical)]",
  muted: "text-[var(--text-muted)]",
};

/**
 * The one number a screen is about. Deliberately only one per screen — a row
 * of equally-large numbers is a dashboard, not an answer (V2 §75).
 */
export function HeroMetric({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  tone?: MetricTone;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <div
        className={cn(
          "mt-1 text-[32px] font-semibold leading-none tracking-[-0.02em] tabular-nums sm:text-[42px]",
          TONE_COLOR[tone]
        )}
      >
        {value}
      </div>
      {sub ? <div className="mt-2 text-[13px] text-[var(--text-secondary)]">{sub}</div> : null}
    </div>
  );
}

export interface MetricItem {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  tone?: MetricTone;
}

/**
 * Supporting figures, sized well below the hero so the hierarchy reads
 * instantly. Separated by rules rather than boxed individually.
 */
export function MetricRow({ items, className }: { items: MetricItem[]; className?: string }) {
  return (
    // A two-column grid on a phone, so the figures line up in columns instead
    // of wrapping wherever each one happens to run out of room.
    <div
      className={cn(
        "grid w-full grid-cols-2 items-start gap-x-6 gap-y-5 sm:flex sm:w-auto sm:flex-wrap sm:gap-x-10",
        className
      )}
    >
      {items.map((item, i) => (
        <div key={i} className="min-w-0 sm:min-w-[110px]">
          <Label>{item.label}</Label>
          <div
            className={cn(
              "mt-1 text-[20px] font-semibold leading-none tracking-[-0.01em] tabular-nums",
              TONE_COLOR[item.tone ?? "neutral"]
            )}
          >
            {item.value}
          </div>
          {item.sub ? (
            <div className="mt-1.5 text-[12px] leading-snug text-[var(--text-muted)]">{item.sub}</div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/**
 * An honest empty state. Says what is missing and what would fix it, and never
 * substitutes a plausible-looking number (V2 §66).
 */
export function NotAvailable({ title, detail, action }: { title: string; detail?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-[var(--radius-md)] border border-dashed border-[var(--border)] bg-[var(--surface-sunken)] px-5 py-6">
      <div>
        <p className="text-[13px] font-medium text-[var(--text-primary)]">{title}</p>
        {detail ? <p className="mt-1 text-[12.5px] text-[var(--text-secondary)]">{detail}</p> : null}
      </div>
      {action}
    </div>
  );
}
