"use client";

/**
 * One transition, end to end, in the order a planner reasons about it:
 * what it is → why these SKUs belong together → the demand they share → the
 * stock that can serve it → where it runs out → what to order → what to do.
 *
 * Every section reads off the same `TransitionView`, so a change made in one
 * (confirm the successor, set substitutability) moves every number below it.
 */

import { use } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ChevronDown, SlidersHorizontal } from "lucide-react";
import { useDataset, useTransition } from "@/components/dataset/dataset-provider";
import { MetricRow, Page, SectionRule } from "@/components/shared/page";
import { StatusBadge } from "@/components/shared/state-badge";
import { MeritBadge } from "@/components/shared/merit-badge";
import { LineageChain, TransitionBar } from "@/components/shared/transition-bar";
import { Button } from "@/components/ui/button";
import { ContinuityLayer, JdaVersusHeizen } from "@/components/transition/continuity-layer";
import { LineagePanel } from "@/components/transition/lineage-panel";
import { DemandPanel } from "@/components/transition/demand-panel";
import { InventoryPanel } from "@/components/transition/inventory-panel";
import { StoreCoverage } from "@/components/transition/store-coverage";
import { ReplenishmentPanel } from "@/components/transition/replenishment-panel";
import { TransitionActions, TransitionHistory } from "@/components/transition/transition-actions";
import { explanationSteps } from "@/lib/transitions/explain";
import { TYPE_LABEL } from "@/lib/transitions/filters";
import { fmtDateShort, fmtNum, fmtNum1 } from "@/lib/utils/format";

const SECTIONS = [
  ["continuity", "Continuity"],
  ["lineage", "Lineage"],
  ["demand", "Demand"],
  ["inventory", "Inventory"],
  ["stores", "Stores"],
  ["replenishment", "Replenishment"],
  ["actions", "Actions"],
] as const;

export default function TransitionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { dataset, loading } = useDataset();
  const view = useTransition(decodeURIComponent(id));

  if (!view || !dataset) {
    if (loading) return <Page>{null}</Page>;
    notFound();
  }

  const reason = view.lineage.reason
    ? `${view.lineage.reason.charAt(0)}${view.lineage.reason.slice(1).toLowerCase()} transition`
    : `${TYPE_LABEL[view.lineage.type]}`;

  return (
    <Page>
      <Link href="/transitions" className="mb-4 inline-flex items-center gap-1 text-[12.5px] text-[var(--text-muted)] hover:text-[var(--text-primary)]">
        <ArrowLeft className="size-3.5" /> SKU Transitions
      </Link>

      {/* ---------------- summary ---------------- */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 gap-4">
          <MeritBadge name={view.name} category={view.category} status={view.status} size={60} className="mt-1" />
          <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-[24px] font-semibold leading-tight tracking-[-0.015em] text-[var(--text-primary)]">{view.name}</h1>
            <StatusBadge status={view.status} />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] text-[var(--text-secondary)]">
            <span>{reason}</span>
            <LineageChain predecessors={view.lineage.predecessors} successors={view.lineage.successors} size="md" />
            {view.startDate ? <span className="text-[var(--text-muted)]">Started {fmtDateShort(view.startDate)}</span> : null}
            {view.targetCompletionDate ? (
              <span className="text-[var(--text-muted)]">Target completion {fmtDateShort(view.targetCompletionDate)}</span>
            ) : null}
          </div>
          <p className="mt-2 max-w-[720px] text-[13.5px] text-[var(--text-primary)]">{view.headline}</p>
          </div>
        </div>
        <Button asChild variant="outline">
          <Link href={`/simulator?transition=${encodeURIComponent(view.id)}`}>
            <SlidersHorizontal /> Open in simulator
          </Link>
        </Button>
      </div>

      <div className="mt-5 grid grid-cols-1 items-end gap-6 border-y border-[var(--border)] py-4 md:grid-cols-[minmax(0,1fr)_260px]">
        <MetricRow
          items={[
            { label: "Stores affected", value: view.coverage.available ? fmtNum(view.coverage.storeCount) : "—" },
            {
              label: "Network cover",
              value: view.inventory.networkWeeksOfCover === null ? "—" : `${fmtNum1(view.inventory.networkWeeksOfCover)} wks`,
            },
            {
              label: "Stores at risk",
              value: view.coverage.available ? fmtNum(view.coverage.atRiskCount) : "—",
              tone: view.coverage.atRiskCount > 0 ? "critical" : "positive",
            },
            { label: "Legacy left", value: fmtNum(view.inventory.legacyOnHand) },
          ]}
        />
        <div>
          <div className="mb-1.5 flex items-baseline justify-between text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-muted)]">
            <span className="text-[var(--lineage-legacy)]">Legacy</span>
            <span>Transitioned</span>
            <span className="text-[var(--lineage-successor)]">Successor</span>
          </div>
          <TransitionBar progress={view.progress} height={10} />
        </div>
      </div>

      {/* Section index: the page is long by design — this keeps it navigable. */}
      <nav className="sticky top-0 z-20 -mx-4 mb-2 flex gap-1 overflow-x-auto border-b border-[var(--border)] bg-[var(--background)]/95 px-4 py-2 backdrop-blur sm:-mx-8 sm:px-8">
        {SECTIONS.map(([key, label]) => (
          <a
            key={key}
            href={`#${key}`}
            className="flex-none rounded-[var(--radius-sm)] px-2.5 py-1 text-[12.5px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--interaction-hover)] hover:text-[var(--text-primary)]"
            style={{ transitionDuration: "var(--duration-fast)" }}
          >
            {label}
          </a>
        ))}
      </nav>

      <Section id="continuity" label="One product, two SKUs">
        <ContinuityLayer view={view} />
        <div className="mt-6">
          <JdaVersusHeizen view={view} />
        </div>
      </Section>

      <Section id="lineage" label="Product lineage">
        <LineagePanel view={view} dataset={dataset} />
      </Section>

      <Section id="demand" label="Demand continuity">
        <DemandPanel view={view} />
      </Section>

      <Section id="inventory" label="Network inventory">
        <InventoryPanel view={view} />
      </Section>

      <Section id="stores" label="Store coverage">
        <StoreCoverage view={view} />
      </Section>

      <Section id="replenishment" label="Replenishment">
        <ReplenishmentPanel view={view} />
        <details className="group mt-6 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)]">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-[13px] font-medium text-[var(--text-primary)]">
            How this was calculated
            <ChevronDown className="size-4 text-[var(--text-muted)] transition-transform group-open:rotate-180" />
          </summary>
          <ol className="grid grid-cols-1 gap-x-8 gap-y-3 border-t border-[var(--border)] px-4 py-4 md:grid-cols-2">
            {explanationSteps(view).map((step, i) => (
              <li key={step.title} className="flex gap-3">
                <span className="grid size-5 flex-none place-items-center rounded-full bg-[var(--accent-soft)] text-[11px] font-semibold text-[var(--accent)]">
                  {i + 1}
                </span>
                <div>
                  <div className="text-[13px] font-medium text-[var(--text-primary)]">{step.title}</div>
                  <div className="mt-0.5 text-[12.5px] leading-snug text-[var(--text-secondary)]">{step.body}</div>
                </div>
              </li>
            ))}
          </ol>
        </details>
      </Section>

      <Section id="actions" label="Planner actions">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <TransitionActions view={view} />
          <div>
            <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-muted)]">Decision history</div>
            <TransitionHistory view={view} dataset={dataset} />
          </div>
        </div>
      </Section>
    </Page>
  );
}

function Section({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-14 pb-4">
      <SectionRule label={label} />
      {children}
    </section>
  );
}
