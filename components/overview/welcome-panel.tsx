"use client";

/**
 * First-visit orientation on Overview (PRD §10.2).
 *
 * Intent: a planner who has just signed in and is looking at a page of
 * figures for a product they have not used. What must they do — understand the
 * one idea the whole product rests on, and know where to click next.
 *
 * Deliberately dismissible and never shown again: an explanation that reappears
 * every visit is an explanation the interface failed to make unnecessary, and
 * it becomes furniture within a week.
 */

import Link from "next/link";
import { ArrowRight, X } from "lucide-react";
import { useSessionStore } from "@/stores/session-store";
import { useCurrentUser } from "@/components/layout/use-current-user";
import { fmtMoney } from "@/lib/utils/format";
import type { PortfolioSummary } from "@/lib/situations/portfolio";

export function WelcomePanel({
  summary,
  firstSituationId,
}: {
  summary: PortfolioSummary;
  firstSituationId?: string;
}) {
  // The greeting follows whoever is actually signed in; the dismissal is a
  // local preference and stays local.
  const { user } = useCurrentUser();
  const dismissed = useSessionStore((s) => s.welcomeDismissed);
  const dismissWelcome = useSessionStore((s) => s.dismissWelcome);
  const hasHydrated = useSessionStore((s) => s.hasHydrated);

  // Rendering before hydration would flash the panel at a planner who
  // dismissed it weeks ago.
  if (!hasHydrated || dismissed) return null;

  const firstName = user?.name.split(" ")[0];

  return (
    <div className="relative mb-6 overflow-hidden rounded-[var(--radius-lg)] border border-[var(--accent)] bg-[var(--accent-soft)] px-4 py-5 sm:px-7 sm:py-6">
      <button
        type="button"
        onClick={dismissWelcome}
        aria-label="Dismiss"
        className="absolute right-2.5 top-2.5 grid size-8 place-items-center rounded-[var(--radius-sm)] text-[var(--text-muted)] transition-colors hover:bg-[var(--interaction-hover)] hover:text-[var(--text-primary)]"
        style={{ transitionDuration: "var(--duration-fast)" }}
      >
        <X className="size-3.5" />
      </button>

      <h2 className="pr-10 text-[17px] font-semibold tracking-[-0.01em] text-[var(--text-primary)]">
        {firstName ? `Welcome, ${firstName}.` : "Welcome."} Here is what your plan cannot see yet.
      </h2>

      <p className="mt-2 max-w-[720px] text-[13px] leading-relaxed text-[var(--text-secondary)]">
        Everything below starts from one question:{" "}
        <span className="font-medium text-[var(--text-primary)]">
          which products sold last season and have nothing standing for them this year
        </span>
        . There are {summary.unrepresentedSkuCount} of them
        {summary.valuesComparable ? `, worth ${fmtMoney(summary.unresolvedValue, summary.currency)}` : ""}.
        Decide what carries forward, and the
        line hours, component dates and material orders all follow from that one decision.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
        {firstSituationId ? (
          <Link
            href={`/workspace/${firstSituationId}/reconcile`}
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--accent)] px-3.5 py-2 text-[13px] font-medium text-[var(--text-on-accent)] transition-opacity hover:opacity-90"
            style={{ transitionDuration: "var(--duration-fast)" }}
          >
            Start with the first programme
            <ArrowRight className="size-3.5" />
          </Link>
        ) : null}
        <button
          type="button"
          onClick={dismissWelcome}
          className="text-[12.5px] text-[var(--text-secondary)] underline-offset-2 transition-colors hover:text-[var(--text-primary)] hover:underline"
          style={{ transitionDuration: "var(--duration-fast)" }}
        >
          I know my way around
        </button>
      </div>
    </div>
  );
}
