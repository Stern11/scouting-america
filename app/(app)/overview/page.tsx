"use client";

/**
 * Overview — where do we have product-transition risk right now?
 *
 * Situation first, charts second: a sentence that says how many products are
 * mid-transition and how many need the planner, then the supporting figures,
 * the transitions themselves, what is at risk across the network, today's
 * work, and finally what this is worth if the pattern holds across the
 * portfolio.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, ArrowRightLeft, PiggyBank, Shirt, Store } from "lucide-react";
import { useDataset } from "@/components/dataset/dataset-provider";
import { useDatasetStore } from "@/stores/dataset-store";
import { useCurrentUser } from "@/components/layout/use-current-user";
import { NotAvailable, Page, SectionRule } from "@/components/shared/page";
import { TransitionCard } from "@/components/shared/transition-card";
import { NetworkImpactPanel } from "@/components/overview/network-impact";
import { ActionSummary } from "@/components/shared/action-summary";
import { OpenArrow } from "@/components/shared/open-arrow";
import { networkImpact, openActions, sortForAttention, summarizePortfolio } from "@/lib/transitions/portfolio";
import { fmtMoney, fmtNum } from "@/lib/utils/format";

export default function OverviewPage() {
  const { dataset, transitions } = useDataset();
  const actionStates = useDatasetStore((s) => s.actionStates);
  const { user } = useCurrentUser();
  const greeting = useGreeting();

  const summary = useMemo(() => summarizePortfolio(transitions, dataset?.stores.length ?? 0), [transitions, dataset]);
  const ranked = useMemo(() => sortForAttention(transitions.filter((t) => t.status !== "COMPLETE")), [transitions]);
  const queue = useMemo(
    () => openActions(transitions, actionStates).filter((a) => a.priority !== "MONITOR"),
    [transitions, actionStates]
  );
  const impact = useMemo(() => networkImpact(transitions), [transitions]);

  if (!dataset || transitions.length === 0) {
    return (
      <Page>
        <NotAvailable
          title="No product transitions found"
          detail="Add SKU_Transitions rows, or replacement SKUs on the SKU master, so Heizen knows which products belong together."
        />
      </Page>
    );
  }

  const currency = dataset.metadata.currency;
  const firstName = user?.name.split(/\s+/)[0];
  const attention = summary.attention;

  const needsYou = ranked.filter((t) => t.status === "ACTION_NEEDED");
  const measured = impact.measured;

  return (
    <Page>
      {/* ---------------- the situation ---------------- */}
      <div className="relative mb-5 overflow-hidden rounded-[18px] border border-[var(--border)] bg-[linear-gradient(120deg,var(--surface)_0%,var(--lineage-legacy-soft)_100%)] px-6 py-6 sm:px-8">
        {/* A trail across the banner — old SKUs behind, new ones ahead. */}
        <svg className="pointer-events-none absolute -bottom-2 left-0 h-16 w-full opacity-50" viewBox="0 0 800 60" preserveAspectRatio="none" aria-hidden>
          <path d="M0 50 C 160 20, 300 58, 460 32 S 700 14, 800 26" fill="none" stroke="var(--border-strong)" strokeWidth="2" strokeDasharray="6 7" />
        </svg>
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <p className="text-[14px] text-[var(--text-secondary)]">
              {greeting}
              {firstName ? `, ${firstName}` : ""}.
            </p>
            <h1 className="mt-1.5 text-[26px] font-semibold leading-[1.2] tracking-[-0.02em] text-[var(--text-primary)] sm:text-[30px]">
              {summary.active} products are switching to Scouting&nbsp;America&nbsp;SKUs.
            </h1>
            <p className="mt-2 text-[15px] text-[var(--text-secondary)]">
              {attention > 0 ? (
                <>
                  <span className="font-semibold text-[var(--risk-critical)]">
                    {attention} need{attention === 1 ? "s" : ""} you today
                  </span>{" "}
                  — the rest are on the trail.
                </>
              ) : (
                <span className="font-semibold text-[var(--risk-positive)]">All on track — nothing needs you today.</span>
              )}
            </p>
          </div>
          <div className="flex flex-none gap-4 sm:gap-6">
            <PatchCount value={attention} label="Need you" ring="var(--risk-critical)" href="/transitions" />
            <PatchCount value={summary.byStatus.MONITOR} label="Keep an eye on" ring="var(--risk-warning)" href="/transitions" />
            <PatchCount
              value={summary.byStatus.TRANSITIONING + summary.byStatus.HEALTHY}
              label="On the trail"
              ring="var(--accent)"
              href="/transitions"
            />
          </div>
        </div>
      </div>

      {/* Four numbers that matter, in the words a planner uses. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile
          icon={Store}
          tone="critical"
          value={fmtNum(summary.storeStockouts)}
          label="Scout Shop stockouts coming"
          sub="before new stock reaches them"
          href="/transitions?risk=stockout"
        />
        <Tile
          icon={Shirt}
          tone="legacy"
          value={fmtNum(measured.legacyUnitsSurfaced)}
          label="Legacy units still sellable"
          sub="counted toward the new SKUs' demand"
          href="/transitions"
        />
        <Tile
          icon={PiggyBank}
          tone="positive"
          value={measured.purchasingAvoidedValue !== null ? fmtMoney(measured.purchasingAvoidedValue, currency) : fmtNum(measured.purchasingAvoidedUnits)}
          label="Purchasing you can defer"
          sub="because legacy stock covers it"
          href="/actions?type=hold"
        />
        <Tile
          icon={ArrowRightLeft}
          tone="accent"
          value={fmtNum(summary.transferUnits)}
          label="Units to move between shops"
          sub="instead of buying more"
          href="/actions?type=transfer"
        />
      </div>

      <div className="mt-8 grid grid-cols-1 gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        {/* ---------------- needs you today ---------------- */}
        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="flex items-center gap-2.5 text-[17px] font-semibold tracking-tight text-[var(--text-primary)]">
              <span className="size-2.5 rounded-full bg-[var(--risk-critical)]" />
              Needs you today <span className="font-normal text-[var(--text-muted)]">{needsYou.length}</span>
            </h2>
            <Link href="/transitions" className="inline-flex items-center gap-1 text-[12.5px] font-medium text-[var(--accent)] hover:underline">
              All {summary.active} products <ArrowRight className="size-3" />
            </Link>
          </div>
          {needsYou.length === 0 ? (
            <p className="rounded-[14px] border border-[var(--border)] bg-[var(--surface)] p-5 text-[13.5px] text-[var(--text-secondary)]">
              No transitions require attention. Every active product has enough usable stock for current demand and inbound
              supply.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {needsYou.slice(0, 4).map((view) => (
                <TransitionCard key={view.id} view={view} />
              ))}
            </div>
          )}
          {needsYou.length > 4 ? (
            <Link href="/transitions" className="mt-3 inline-flex items-center gap-1 text-[12.5px] font-medium text-[var(--accent)] hover:underline">
              {needsYou.length - 4} more need you <ArrowRight className="size-3" />
            </Link>
          ) : null}
        </section>

        {/* ---------------- next moves ---------------- */}
        <aside>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-[17px] font-semibold tracking-tight text-[var(--text-primary)]">Your next moves</h2>
            <Link href="/actions" className="inline-flex items-center gap-1 text-[12.5px] font-medium text-[var(--accent)] hover:underline">
              All {queue.length} <ArrowRight className="size-3" />
            </Link>
          </div>
          <div className="rounded-[14px] border border-[var(--border)] bg-[var(--surface)] px-3">
            {queue.length === 0 ? (
              <p className="py-4 text-[13px] text-[var(--text-muted)]">Nothing to do today.</p>
            ) : (
              queue.slice(0, 3).map((a) => <ActionSummary key={a.id} action={a} />)
            )}
          </div>
        </aside>
      </div>

      {/* ---------------- the business case ---------------- */}
      <SectionRule label="What this is worth across the network" />
      <NetworkImpactPanel impact={impact} currency={currency} />
    </Page>
  );
}

/** A count stitched into a round patch — the status ring colour carries the meaning. */
function PatchCount({ value, label, ring, href }: { value: number; label: string; ring: string; href: string }) {
  return (
    <Link href={href} className="group flex flex-col items-center gap-2" aria-label={`${value} ${label} — show`}>
      <span
        className="relative grid size-[76px] place-items-center rounded-full bg-[var(--surface)] transition-transform group-hover:-translate-y-0.5"
        style={{ boxShadow: `0 0 0 4px ${ring}, 0 4px 12px -4px rgb(0 0 0 / 0.25)`, transitionDuration: "var(--duration-fast)" }}
      >
        <span className="absolute inset-[5px] rounded-full" style={{ border: `1.5px dashed color-mix(in oklch, ${ring} 55%, transparent)` }} />
        <span className="relative text-[28px] font-bold tabular-nums" style={{ color: ring }}>
          {value}
        </span>
      </span>
      <span className="text-[12px] font-medium text-[var(--text-secondary)]">{label}</span>
    </Link>
  );
}

const TILE_TONE = {
  critical: { fg: "text-[var(--risk-critical)]", bg: "bg-[var(--risk-critical-soft)]" },
  legacy: { fg: "text-[var(--lineage-legacy)]", bg: "bg-[var(--lineage-legacy-soft)]" },
  positive: { fg: "text-[var(--risk-positive)]", bg: "bg-[var(--risk-positive-soft)]" },
  accent: { fg: "text-[var(--accent)]", bg: "bg-[var(--accent-soft)]" },
} as const;

function Tile({
  icon: Icon,
  tone,
  value,
  label,
  sub,
  href,
}: {
  icon: typeof Store;
  tone: keyof typeof TILE_TONE;
  value: string;
  label: string;
  sub: string;
  href: string;
}) {
  const t = TILE_TONE[tone];
  return (
    <div className="rounded-[14px] border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex items-start justify-between">
        <span className={`grid size-9 place-items-center rounded-full ${t.bg}`}>
          <Icon className={`size-[18px] ${t.fg}`} />
        </span>
        <OpenArrow href={href} label={`See ${label.toLowerCase()}`} />
      </div>
      <div className={`mt-3 text-[30px] font-semibold leading-none tabular-nums ${t.fg}`}>{value}</div>
      <div className="mt-2 text-[13.5px] font-medium text-[var(--text-primary)]">{label}</div>
      <div className="mt-0.5 text-[12px] text-[var(--text-muted)]">{sub}</div>
    </div>
  );
}

/** Time-of-day greeting, read after mount so server and client render alike. */
function useGreeting(): string {
  const [greeting, setGreeting] = useState("Welcome back");
  useEffect(() => {
    const hour = new Date().getHours();
    setGreeting(hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening");
  }, []);
  return greeting;
}
