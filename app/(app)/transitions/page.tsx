"use client";

/**
 * SKU Transitions — which products need me, and why?
 *
 * By default a card per product, grouped the way a planner triages: needs
 * you today, keep an eye on, on the trail, completed. Each card is one
 * sentence and one next step. The dense table — every column a planner
 * might sort by — is one toggle away.
 */

import { Suspense, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, LayoutGrid, LayoutList, Search, X } from "lucide-react";
import { useDataset } from "@/components/dataset/dataset-provider";
import { DataTable, type Column } from "@/components/shared/data-table";
import { NotAvailable, Page, PageHeader } from "@/components/shared/page";
import { LineageChain, LineageLegend, TransitionBar } from "@/components/shared/transition-bar";
import { StatusBadge, statusLabel } from "@/components/shared/state-badge";
import { TransitionCard } from "@/components/shared/transition-card";
import { productIcon } from "@/components/shared/merit-badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  RISK_FILTER_LABEL,
  TYPE_LABEL,
  distinctValues,
  filterTransitions,
  type RiskFilter,
  type TransitionFilters,
} from "@/lib/transitions/filters";
import { STATUS_ORDER, sortForAttention } from "@/lib/transitions/portfolio";
import type { TransitionStatus, TransitionView } from "@/types/transition";
import type { TransitionType } from "@/types/dataset";
import { fmtNum, fmtNum1 } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";

const STATUSES: (TransitionStatus | "ACTIVE")[] = ["ACTIVE", "ACTION_NEEDED", "MONITOR", "TRANSITIONING", "HEALTHY", "COMPLETE"];
const ALL = "__all";

export default function TransitionsPage() {
  return (
    <Suspense fallback={<Page>{null}</Page>}>
      <TransitionsList />
    </Suspense>
  );
}

function TransitionsList() {
  const { transitions } = useDataset();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const filters: TransitionFilters = {
    query: params.get("q") ?? undefined,
    status: (params.get("status") as TransitionFilters["status"]) ?? "ACTIVE",
    category: params.get("category") ?? undefined,
    program: params.get("program") ?? undefined,
    type: (params.get("type") as TransitionType | null) ?? undefined,
    risk: (params.get("risk") as RiskFilter | null) ?? undefined,
  };

  const setParam = (key: string, value: string | undefined) => {
    const next = new URLSearchParams(params.toString());
    if (value === undefined || value === "" || value === ALL) next.delete(key);
    else next.set(key, value);
    router.replace(`${pathname}${next.toString() ? `?${next}` : ""}`, { scroll: false });
  };

  const rows = useMemo(() => sortForAttention(filterTransitions(transitions, filters)), [transitions, params]); // eslint-disable-line react-hooks/exhaustive-deps
  const categories = useMemo(() => distinctValues(transitions, (t) => t.category), [transitions]);
  const programs = useMemo(() => distinctValues(transitions, (t) => t.program), [transitions]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { ACTIVE: 0 };
    for (const t of transitions) {
      c[t.status] = (c[t.status] ?? 0) + 1;
      if (t.status !== "COMPLETE") c.ACTIVE = (c.ACTIVE ?? 0) + 1;
    }
    return c;
  }, [transitions]);

  if (transitions.length === 0) {
    return (
      <Page>
        <PageHeader title="SKU Transitions" />
        <NotAvailable
          title="No product transitions found"
          detail="Add SKU_Transitions rows, or replacement SKUs on the SKU master, so the planner knows which products belong together."
        />
      </Page>
    );
  }

  if (params.get("view") !== "table") {
    return <CardView transitions={transitions} filters={filters} setParam={setParam} categories={categories} />;
  }

  const columns: Column<TransitionView>[] = [
    {
      key: "name",
      header: "Transition",
      sortValue: (v) => v.name,
      render: (v) => (
        <div className="min-w-0 py-0.5">
          <div className="truncate font-medium text-[var(--text-primary)]">{v.name}</div>
          <div className="mt-1">
            <LineageChain predecessors={v.lineage.predecessors} successors={v.lineage.successors} />
          </div>
        </div>
      ),
      width: "26%",
    },
    {
      key: "progress",
      header: "Transitioned",
      sortValue: (v) => v.progress,
      render: (v) => <TransitionBar progress={v.progress} className="w-[120px]" />,
      width: "150px",
    },
    {
      key: "stores",
      header: "Stores",
      numeric: true,
      sortValue: (v) => v.coverage.storeCount,
      render: (v) => (v.coverage.available ? fmtNum(v.coverage.storeCount) : <Muted>—</Muted>),
    },
    {
      key: "legacy",
      header: "Legacy left",
      numeric: true,
      sortValue: (v) => v.inventory.legacyOnHand,
      render: (v) => (
        <span className="text-[var(--lineage-legacy)]">{v.lineage.predecessors.length ? fmtNum(v.inventory.legacyOnHand) : "—"}</span>
      ),
    },
    {
      key: "successor",
      header: "Successor",
      numeric: true,
      sortValue: (v) => v.inventory.successorOnHand + v.inventory.eligibleInbound,
      render: (v) =>
        v.lineage.successors.length ? (
          <span className="whitespace-nowrap text-[var(--lineage-successor)]">
            {fmtNum(v.inventory.successorOnHand)}
            {v.inventory.eligibleInbound > 0 ? (
              <span className="text-[var(--text-muted)]"> +{fmtNum(v.inventory.eligibleInbound)}</span>
            ) : null}
          </span>
        ) : (
          <Muted>—</Muted>
        ),
    },
    {
      key: "cover",
      header: "Wks cover",
      numeric: true,
      sortValue: (v) => v.inventory.networkWeeksOfCover ?? 999,
      render: (v) => (v.inventory.networkWeeksOfCover === null ? <Muted>—</Muted> : fmtNum1(v.inventory.networkWeeksOfCover)),
    },
    {
      key: "risk",
      header: "At risk",
      numeric: true,
      sortValue: (v) => v.coverage.atRiskCount,
      render: (v) =>
        !v.coverage.available ? (
          <Muted>—</Muted>
        ) : v.coverage.atRiskCount > 0 ? (
          <span className="font-semibold text-[var(--risk-critical)]">{v.coverage.atRiskCount}</span>
        ) : (
          <Muted>0</Muted>
        ),
    },
    {
      key: "status",
      header: "Status",
      sortValue: (v) => STATUS_ORDER[v.status],
      render: (v) => <StatusBadge status={v.status} />,
    },
    {
      key: "next",
      header: "Next step",
      render: (v) => <span className="block max-w-[220px] truncate text-[12.5px] text-[var(--text-secondary)]">{v.nextStep}</span>,
    },
  ];

  const anyFilter = Boolean(filters.query || filters.category || filters.program || filters.type || filters.risk || filters.status !== "ACTIVE");

  return (
    <Page>
      <PageHeader
        title="SKU Transitions"
        subtitle={`${counts.ACTIVE ?? 0} active · ${counts.COMPLETE ?? 0} complete · old and new SKUs planned as one product`}
        actions={<ViewToggle view="table" onChange={(v) => setParam("view", v === "cards" ? undefined : v)} />}
      />

      {/* Status as a segmented row: the one filter everyone uses. */}
      <div className="-mx-1 mb-3 flex gap-1 overflow-x-auto px-1 pb-1">
        {STATUSES.map((s) => {
          const active = (filters.status ?? "ACTIVE") === s;
          return (
            <button
              key={s}
              type="button"
              onClick={() => setParam("status", s === "ACTIVE" ? undefined : s)}
              className={cn(
                "flex flex-none items-center gap-1.5 rounded-full border px-3 py-1 text-[12.5px] transition-colors",
                active
                  ? "border-[var(--interaction-selected-border)] bg-[var(--interaction-selected)] font-medium text-[var(--text-primary)]"
                  : "border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--interaction-hover)]"
              )}
              style={{ transitionDuration: "var(--duration-fast)" }}
            >
              {s === "ACTIVE" ? "All active" : statusLabel(s)}
              <span className="tabular-nums text-[var(--text-muted)]">{counts[s] ?? 0}</span>
            </button>
          );
        })}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-[280px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--text-muted)]" />
          <Input
            value={filters.query ?? ""}
            onChange={(e) => setParam("q", e.target.value)}
            placeholder="Search SKU, product or category"
            className="pl-8"
            aria-label="Search transitions"
          />
        </div>
        <FilterSelect label="Risk" value={filters.risk} onChange={(v) => setParam("risk", v)} options={Object.entries(RISK_FILTER_LABEL).map(([value, label]) => ({ value, label }))} />
        <FilterSelect label="Category" value={filters.category} onChange={(v) => setParam("category", v)} options={categories.map((c) => ({ value: c, label: c }))} />
        <FilterSelect label="Program" value={filters.program} onChange={(v) => setParam("program", v)} options={programs.map((c) => ({ value: c, label: c }))} />
        <FilterSelect label="Type" value={filters.type} onChange={(v) => setParam("type", v)} options={Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label }))} />
        {anyFilter ? (
          <button
            type="button"
            onClick={() => router.replace(pathname, { scroll: false })}
            className="inline-flex items-center gap-1 text-[12px] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            <X className="size-3" /> Clear
          </button>
        ) : null}
        <LineageLegend inbound={false} className="ml-auto hidden lg:flex" />
      </div>

      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(v) => v.id}
        onRowClick={(v) => router.push(`/transitions/${v.id}`)}
        minWidth={1080}
        empty={
          filters.status === "ACTION_NEEDED" ? (
            <span>No transitions require attention. Every active transition has enough usable stock for current demand and inbound supply.</span>
          ) : (
            <span>No transitions match these filters.</span>
          )
        }
        card={(v) => (
          <div>
            <div className="flex items-start justify-between gap-2">
              <span className="font-medium text-[var(--text-primary)]">{v.name}</span>
              <StatusBadge status={v.status} />
            </div>
            <div className="mt-1.5">
              <LineageChain predecessors={v.lineage.predecessors} successors={v.lineage.successors} />
            </div>
            <TransitionBar progress={v.progress} className="mt-2" />
            <div className="mt-1.5 text-[12px] text-[var(--text-muted)]">{v.headline}</div>
          </div>
        )}
      />
    </Page>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <span className="text-[var(--text-muted)]">{children}</span>;
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <Select value={value ?? ALL} onValueChange={(v) => onChange(v === ALL ? undefined : v)}>
      <SelectTrigger className={cn("min-w-[120px]", value && "border-[var(--interaction-selected-border)]")} aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{`Any ${label.toLowerCase()}`}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/* ------------------------------------------------------------------ */
/* Card view                                                           */
/* ------------------------------------------------------------------ */

const GROUPS: { key: string; title: string; blurb: string; statuses: TransitionStatus[]; dot: string }[] = [
  { key: "now", title: "Needs you today", blurb: "Stores about to run out, orders to hold, matches to confirm", statuses: ["ACTION_NEEDED"], dot: "bg-[var(--risk-critical)]" },
  { key: "watch", title: "Keep an eye on", blurb: "Nothing urgent — worth a look this cycle", statuses: ["MONITOR"], dot: "bg-[var(--risk-warning)]" },
  { key: "trail", title: "On the trail", blurb: "Moving to the new SKU as planned", statuses: ["TRANSITIONING", "HEALTHY"], dot: "bg-[var(--accent)]" },
];

function CardView({
  transitions,
  filters,
  setParam,
  categories,
}: {
  transitions: TransitionView[];
  filters: TransitionFilters;
  setParam: (key: string, value: string | undefined) => void;
  categories: string[];
}) {
  const [showDone, setShowDone] = useState(false);
  const matching = useMemo(
    () => sortForAttention(filterTransitions(transitions, { query: filters.query, category: filters.category, risk: filters.risk })),
    [transitions, filters.query, filters.category, filters.risk]
  );
  const done = matching.filter((t) => t.status === "COMPLETE");
  const active = transitions.filter((t) => t.status !== "COMPLETE").length;

  return (
    <Page>
      <PageHeader
        title="SKU Transitions"
        subtitle={`${active} products moving from legacy to Scouting America SKUs`}
        actions={<ViewToggle view="cards" onChange={(v) => setParam("view", v === "cards" ? undefined : v)} />}
      />

      <div className="mb-6 flex flex-col gap-3">
        <div className="relative w-full sm:w-[340px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--text-muted)]" />
          <Input
            value={filters.query ?? ""}
            onChange={(e) => setParam("q", e.target.value)}
            placeholder="Find a product or SKU — e.g. neckerchief, CS-2841"
            className="h-10 rounded-full pl-9 text-[14px]"
            aria-label="Search transitions"
          />
        </div>
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
          <CategoryChip active={!filters.category} onClick={() => setParam("category", undefined)} label="Everything" />
          {categories.map((c) => (
            <CategoryChip key={c} active={filters.category === c} onClick={() => setParam("category", c)} label={c} category={c} />
          ))}
        </div>
        {filters.risk ? (
          <button
            type="button"
            onClick={() => setParam("risk", undefined)}
            className="inline-flex w-fit items-center gap-1.5 rounded-full bg-[var(--accent-soft)] px-3 py-1 text-[12.5px] font-medium text-[var(--accent)]"
          >
            Showing: {RISK_FILTER_LABEL[filters.risk]} <X className="size-3" />
          </button>
        ) : null}
      </div>

      {GROUPS.map((g) => {
        const items = matching.filter((t) => g.statuses.includes(t.status));
        if (items.length === 0) return null;
        return (
          <section key={g.key} className="mb-9">
            <div className="mb-3 flex items-baseline gap-2.5">
              <span className={cn("size-2.5 translate-y-[-1px] rounded-full", g.dot)} />
              <h2 className="text-[17px] font-semibold tracking-tight text-[var(--text-primary)]">
                {g.title} <span className="font-normal text-[var(--text-muted)]">{items.length}</span>
              </h2>
              <span className="hidden text-[12.5px] text-[var(--text-muted)] sm:inline">{g.blurb}</span>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {items.map((t) => (
                <TransitionCard key={t.id} view={t} />
              ))}
            </div>
          </section>
        );
      })}

      {done.length > 0 ? (
        <section>
          <button
            type="button"
            onClick={() => setShowDone((v) => !v)}
            className="mb-3 flex items-center gap-2 text-[15px] font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            <span className="size-2.5 rounded-full bg-[var(--state-unknown)]" />
            Completed <span className="font-normal text-[var(--text-muted)]">{done.length}</span>
            <ChevronDown className={cn("size-4 transition-transform", showDone && "rotate-180")} />
          </button>
          {showDone ? (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
              {done.map((t) => (
                <TransitionCard key={t.id} view={t} compact />
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      {matching.length === 0 ? (
        <NotAvailable title="No products match" detail="Try another search, or clear the category." />
      ) : null}
    </Page>
  );
}

function CategoryChip({ active, onClick, label, category }: { active: boolean; onClick: () => void; label: string; category?: string }) {
  const Icon = category ? productIcon(label, category) : LayoutGrid;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-none items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px] transition-colors",
        active
          ? "border-[var(--accent)] bg-[var(--accent)] font-medium text-[var(--text-on-accent)]"
          : "border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)] hover:border-[var(--border-strong)]"
      )}
      style={{ transitionDuration: "var(--duration-fast)" }}
    >
      <Icon className="size-3.5" />
      {label}
    </button>
  );
}

function ViewToggle({ view, onChange }: { view: "cards" | "table"; onChange: (v: "cards" | "table") => void }) {
  return (
    <div className="flex rounded-full border border-[var(--border)] bg-[var(--surface)] p-0.5">
      {(
        [
          ["cards", "Cards", LayoutGrid],
          ["table", "Detailed table", LayoutList],
        ] as const
      ).map(([key, label, Icon]) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          className={cn(
            "flex items-center gap-1.5 rounded-full px-3 py-1 text-[12.5px] transition-colors",
            view === key ? "bg-[var(--accent)] font-medium text-[var(--text-on-accent)]" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          )}
        >
          <Icon className="size-3.5" />
          {label}
        </button>
      ))}
    </div>
  );
}
