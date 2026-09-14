"use client";

/**
 * The situation frame (V2 §41).
 *
 * A programme is one view: Reconcile. There is no Decide step — whatever the
 * planner does here (carry an item forward, exit it) creates dated decisions,
 * and those are handled on Decisions with every other programme's. The
 * situation header stays put so the context never disappears.
 *
 * There is deliberately no Plan Supply or Check Capacity step. Material and
 * capacity consequences are not separate subjects a planner visits — they are
 * what a *particular* unrepresented item does, and reading them as portfolio
 * aggregates hid the very thing that caused them. They live inside the SKU
 * drawer on Reconcile, and roll up on Decisions.
 */

import Link from "next/link";
import { use } from "react";
import { ArrowLeft, FlaskConical } from "lucide-react";
import { useSituation } from "@/components/dataset/dataset-provider";
import { StateBadge } from "@/components/shared/state-badge";
import { NotAvailable, Page } from "@/components/shared/page";
import { fmtDateShort } from "@/lib/utils/format";

export default function SituationLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ situationId: string }>;
}) {
  const { situationId } = use(params);
  const situation = useSituation(situationId);

  if (!situation) {
    return (
      <Page>
        <NotAvailable
          title="Situation not found"
          detail="It may belong to a dataset that is no longer loaded."
          action={
            <Link
              href="/workspace"
              className="rounded-[var(--radius-sm)] bg-[var(--accent)] px-3 py-1.5 text-[13px] font-medium text-[var(--text-on-accent)]"
            >
              Back to workspace
            </Link>
          }
        />
      </Page>
    );
  }

  return (
    <div>
      {/* Sticky so the programme stays visible while you scroll a long list —
          losing your place is the fastest way to stop trusting a number you
          are looking at. */}
      {/* Not sticky on a phone: pinned, it took a quarter of the screen from
          the list it is meant to keep in context. */}
      <div className="relative z-30 border-b border-[var(--border)] bg-[var(--surface)] sm:sticky sm:top-0">
        <div className="mx-auto w-full max-w-[1360px] px-4 py-3 sm:px-8 sm:py-4">
          <Link
            href="/workspace"
            className="-my-1.5 mb-1.5 inline-flex h-8 items-center gap-1.5 text-[12px] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            <ArrowLeft className="size-3" />
            Planning Workspace
          </Link>

          <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
            <div className="min-w-0">
              <div className="flex items-center gap-2.5">
                <h1 className="text-[19px] font-semibold tracking-[-0.01em] text-[var(--text-primary)]">
                  {situation.title}
                </h1>
                <StateBadge state={situation.state} />
              </div>
              <p className="mt-1 text-[12.5px] text-[var(--text-secondary)] sm:truncate">
                {situation.businessScope}
                {situation.salesWindow
                  ? ` · Sells ${fmtDateShort(situation.salesWindow.start)} – ${fmtDateShort(situation.salesWindow.end)}`
                  : ""}
              </p>
            </div>

            <Link
              href={`/scenario-lab?situation=${situation.id}`}
              className="inline-flex flex-none items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--border-strong)] px-3 py-1.5 text-[13px] font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--interaction-hover)]"
            >
              <FlaskConical className="size-3.5" />
              Open in Scenario Lab
            </Link>
          </div>
        </div>
      </div>

      {children}
    </div>
  );
}
