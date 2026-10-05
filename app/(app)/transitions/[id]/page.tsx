"use client";

/**
 * One product's switch from old SKU to new, told in three beats:
 *
 *   1. The problem — one sentence.
 *   2. The picture — what you need against what you have, with the old-logo
 *      stock counted as the same product.
 *   3. The plan — at most three steps; approving them happens on Actions.
 *
 * Everything that justifies the plan (which shops, why the SKUs belong
 * together, sales, stock by location, the order arithmetic, the history) is
 * one click away, folded, so the page reads as an answer rather than a report.
 */

import { use, useState } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, Calculator, ChevronDown, ChevronRight, History, Link2, SlidersHorizontal, Store, TrendingUp, Warehouse } from "lucide-react";
import { useDataset, useTransition } from "@/components/dataset/dataset-provider";
import { Page } from "@/components/shared/page";
import { StatusBadge } from "@/components/shared/state-badge";
import { MeritBadge } from "@/components/shared/merit-badge";
import { Trail } from "@/components/shared/trail";
import { NeedVsHave } from "@/components/transition/need-vs-have";
import { RecommendedPlan } from "@/components/transition/recommended-plan";
import { LineagePanel } from "@/components/transition/lineage-panel";
import { DemandPanel } from "@/components/transition/demand-panel";
import { InventoryPanel } from "@/components/transition/inventory-panel";
import { StoreCoverage } from "@/components/transition/store-coverage";
import { ReplenishmentPanel } from "@/components/transition/replenishment-panel";
import { TransitionHistory } from "@/components/transition/transition-actions";
import { explanationSteps } from "@/lib/transitions/explain";
import { versionLabels } from "@/lib/transitions/names";
import { cn } from "@/lib/utils/cn";

const DETAIL_TABS = [
  ["shops", "Scout Shops", "Which shops run out and where to move stock", Store],
  ["match", "Why one product", "How the old and new SKUs were matched", Link2],
  ["sales", "Sales history", "Two years of old and new sales together", TrendingUp],
  ["stock", "Stock by location", "DC, shops and deliveries on the way", Warehouse],
  ["order", "Order math", "How the recommended order adds up", Calculator],
  ["history", "History", "Decisions already made on this product", History],
] as const;
type DetailTab = (typeof DETAIL_TABS)[number][0];

export default function TransitionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { dataset, loading } = useDataset();
  const view = useTransition(decodeURIComponent(id));
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<DetailTab>("shops");

  if (!view || !dataset) {
    if (loading) return <Page>{null}</Page>;
    notFound();
  }

  const labels = versionLabels(view.lineage.reason, view.lineage.successors, view.lineage.predecessors);
  const openTab = (t: DetailTab) => {
    setTab(t);
    setOpen(true);
    requestAnimationFrame(() => document.getElementById("details")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  return (
    <Page className="max-w-[1180px]">
      <Link href="/transitions" className="mb-5 inline-flex items-center gap-1 text-[12.5px] text-[var(--text-muted)] hover:text-[var(--text-primary)]">
        <ArrowLeft className="size-3.5" /> All products
      </Link>

      {/* ---------------- 1. the problem ---------------- */}
      <header className="flex flex-wrap items-center gap-5">
        {/* Inset by the ring's width so its outer edge lines up with the cards below. */}
        <MeritBadge name={view.name} category={view.category} status={view.status} size={64} className="ml-[3px]" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em] text-[var(--text-primary)]">{view.name}</h1>
            <StatusBadge status={view.status} />
          </div>
          <p className="mt-1.5 max-w-[720px] text-[17px] leading-snug text-[var(--text-primary)]">{view.headline}</p>
        </div>
        <Link
          href={`/simulator?transition=${encodeURIComponent(view.id)}`}
          className="group flex items-center gap-3 rounded-[14px] border border-[var(--border)] bg-[var(--surface)] py-2.5 pl-2.5 pr-3.5 shadow-[0_1px_2px_rgb(0_0_0/0.04)] transition-all hover:-translate-y-0.5 hover:border-[var(--accent)] hover:shadow-[0_8px_20px_-10px_rgb(0_0_0/0.3)]"
          style={{ transitionDuration: "var(--duration-fast)" }}
        >
          <span className="grid size-10 flex-none place-items-center rounded-[10px] bg-[var(--accent)] text-[var(--text-on-accent)]">
            <SlidersHorizontal className="size-[18px]" />
          </span>
          <span className="leading-tight">
            <span className="block text-[14px] font-semibold text-[var(--text-primary)]">Try a what-if</span>
            <span className="mt-0.5 block text-[12px] text-[var(--text-muted)]">What if the shipment is 2 weeks late?</span>
          </span>
          <ArrowRight className="ml-1 size-4 text-[var(--text-muted)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--accent)]" />
        </Link>
      </header>

      {/* Where sales are today — full width, on the same edges as everything below. */}
      <div className="mt-6">
        <Trail from={view.lineage.predecessors} to={view.lineage.successors} progress={view.progress} labels={labels} />
      </div>

      {/* ---------------- 2. the picture ---------------- */}
      <section className="mt-6">
        <NeedVsHave view={view} />
      </section>

      {/* ---------------- the working, folded ---------------- */}
      <section id="details" className="mt-6 scroll-mt-4">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex w-full items-center justify-between rounded-[14px] border border-[var(--border)] bg-[var(--surface)] px-5 py-3.5 text-left transition-colors hover:border-[var(--border-strong)]"
        >
          <span>
            <span className="block text-[14.5px] font-semibold text-[var(--text-primary)]">See how this was worked out</span>
            <span className="block text-[12.5px] text-[var(--text-muted)]">
              Which shops, why these SKUs are one product, sales, stock and the order math
            </span>
          </span>
          <ChevronDown className={cn("size-5 text-[var(--text-muted)] transition-transform", open && "rotate-180")} />
        </button>

        {open ? (
          <div className="mt-3 rounded-[14px] border border-[var(--border)] bg-[var(--surface)]">
            <div className="flex gap-1 overflow-x-auto border-b border-[var(--border)] px-3 pt-2">
              {DETAIL_TABS.map(([key, label, , Icon]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTab(key)}
                  className={cn(
                    "flex-none border-b-2 px-3 py-2 text-[13px] transition-colors",
                    tab === key
                      ? "border-[var(--accent)] font-medium text-[var(--text-primary)]"
                      : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  )}
                >
                  <span className="inline-flex items-center gap-1.5">
                    <Icon className="size-3.5" />
                    {label}
                  </span>
                </button>
              ))}
            </div>
            <div className="p-5">
              {tab === "shops" ? <StoreCoverage view={view} /> : null}
              {tab === "match" ? <LineagePanel view={view} dataset={dataset} /> : null}
              {tab === "sales" ? <DemandPanel view={view} /> : null}
              {tab === "stock" ? <InventoryPanel view={view} /> : null}
              {tab === "order" ? (
                <>
                  <ReplenishmentPanel view={view} />
                  <ol className="mt-6 grid grid-cols-1 gap-x-8 gap-y-3 border-t border-[var(--border)] pt-5 md:grid-cols-2">
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
                </>
              ) : null}
              {tab === "history" ? <TransitionHistory view={view} dataset={dataset} /> : null}
            </div>
          </div>
        ) : (
          <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {DETAIL_TABS.map(([key, label, hint, Icon]) => (
              <button
                key={key}
                type="button"
                onClick={() => openTab(key)}
                className="group flex items-center gap-3 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-3.5 text-left shadow-[0_1px_2px_rgb(0_0_0/0.04)] transition-all hover:-translate-y-0.5 hover:border-[var(--accent)] hover:shadow-[0_6px_16px_-8px_rgb(0_0_0/0.25)] focus-visible:border-[var(--accent)]"
                style={{ transitionDuration: "var(--duration-fast)" }}
              >
                <span className="grid size-9 flex-none place-items-center rounded-[10px] bg-[var(--accent-soft)] text-[var(--accent)] transition-colors group-hover:bg-[var(--accent)] group-hover:text-[var(--text-on-accent)]">
                  <Icon className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-semibold text-[var(--text-primary)]">{label}</span>
                  <span className="block truncate text-[12px] text-[var(--text-muted)]">{hint}</span>
                </span>
                <ChevronRight className="size-4 flex-none text-[var(--text-muted)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--accent)]" />
              </button>
            ))}
          </div>
        )}
      </section>
      {/* ---------------- 3. the plan ---------------- */}
      <section className="mt-8">
        <h2 className="mb-3 text-[18px] font-semibold tracking-tight text-[var(--text-primary)]">Recommended plan</h2>
        <RecommendedPlan view={view} />
      </section>

    </Page>
  );
}
