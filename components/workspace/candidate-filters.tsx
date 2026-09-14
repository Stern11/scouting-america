/**
 * Narrowing the contributor list (V2 §42).
 *
 * The filters are the dimensions a planner already thinks in, plus the one
 * question the page is about — what has nothing in the plan standing for it.
 * Whatever is selected, the band underneath restates what the *visible* rows
 * are worth, so narrowing never leaves a total on screen that describes a
 * different set of rows.
 */

"use client";

import { Search, X } from "lucide-react";
import {
  activeFilterCount,
  filteredTotals,
  type CandidateFilters,
  type FilterOptions,
} from "@/lib/situations/filters";
import { DISPOSITION_ORDER, dispositionLabel } from "@/components/shared/state-badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils/cn";
import { fmtMoney, fmtUnits } from "@/lib/utils/format";
import type { CandidateItem } from "@/types/situation";

/** Sentinel for "no filter on this dimension" — Radix Select rejects "". */
const ANY = "__any__";

export function CandidateFilterBar({
  filters,
  options,
  visible,
  total,
  currency,
  onChange,
}: {
  filters: CandidateFilters;
  options: FilterOptions;
  visible: readonly CandidateItem[];
  total: number;
  currency: string;
  onChange: (next: CandidateFilters) => void;
}) {
  const active = activeFilterCount(filters);
  const totals = filteredTotals(visible);
  const set = (patch: Partial<CandidateFilters>) => onChange({ ...filters, ...patch });
  // Selects shown in the two-column phone grid (a dimension with one value is
  // hidden). With an even count the toggle would sit alone in half a row.
  const selectCount =
    1 +
    [options.productFamilies, options.brands, options.customers].filter((items) => items.length > 1).length;

  return (
    <div className="mb-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-auto">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            value={filters.search ?? ""}
            onChange={(e) => set({ search: e.target.value })}
            placeholder="Find an item"
            aria-label="Find an item"
            className="h-8 w-full rounded-[var(--radius-sm)] sm:w-[190px] border border-[var(--border)] bg-[var(--surface)] pl-8 pr-2.5 text-[12.5px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus-visible:border-[var(--ring)] focus-visible:outline-none"
          />
        </div>

        <div className="grid w-full grid-cols-2 gap-2 sm:contents">
        <FilterSelect
          label="Family"
          value={filters.productFamily}
          items={options.productFamilies}
          onChange={(v) => set({ productFamily: v })}
        />
        <FilterSelect
          label="Brand"
          value={filters.brand}
          items={options.brands}
          onChange={(v) => set({ brand: v })}
        />
        {options.customers.length > 0 ? (
          <FilterSelect
            label="Customer"
            value={filters.customer}
            items={options.customers}
            onChange={(v) => set({ customer: v })}
          />
        ) : null}

        <Select
          value={filters.disposition ?? ANY}
          onValueChange={(v) =>
            set({ disposition: v === ANY ? undefined : (v as CandidateFilters["disposition"]) })
          }
        >
          <SelectTrigger className="h-8 w-full text-[12.5px] sm:w-[152px] 2xl:w-[168px]">
            <SelectValue placeholder="Any decision" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Any decision</SelectItem>
            {DISPOSITION_ORDER.map((d) => (
              <SelectItem key={d} value={d}>
                {dispositionLabel(d)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <button
          type="button"
          onClick={() => set({ uncoveredOnly: !filters.uncoveredOnly })}
          aria-pressed={filters.uncoveredOnly ?? false}
          className={cn(
            "h-8 min-w-0 truncate rounded-[var(--radius-sm)] border px-2.5 text-[12.5px] transition-colors",
            selectCount % 2 === 0 && "col-span-2",
            filters.uncoveredOnly
              ? "border-[var(--interaction-selected-border)] bg-[var(--interaction-selected)] font-medium text-[var(--text-primary)]"
              : "border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          )}
          style={{ transitionDuration: "var(--duration-fast)" }}
        >
          Nothing in the plan
        </button>
        </div>

        {active > 0 ? (
          <button
            type="button"
            onClick={() => onChange({})}
            className="inline-flex h-8 items-center gap-1 px-1.5 text-[12px] text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
            style={{ transitionDuration: "var(--duration-fast)" }}
          >
            <X className="size-3" />
            Clear {active}
          </button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-[12.5px] text-[var(--text-muted)]">
        <span>
          <span className="font-medium tabular-nums text-[var(--text-primary)]">{totals.count}</span>
          {active > 0 ? ` of ${total}` : ""} item{totals.count === 1 ? "" : "s"}
        </span>
        <span>
          <span className="font-medium tabular-nums text-[var(--text-secondary)]">
            {totals.carryForwardCount}
          </span>{" "}
          carrying forward · {fmtUnits(totals.plannedUnits, true)} ·{" "}
          {fmtMoney(totals.plannedValue, currency)}
        </span>
        {totals.undecidedCount > 0 ? (
          <span className="text-[var(--risk-warning)]">
            {totals.undecidedCount} still to decide
          </span>
        ) : null}
      </div>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  items,
  onChange,
}: {
  label: string;
  value: string | undefined;
  items: string[];
  onChange: (value: string | undefined) => void;
}) {
  if (items.length <= 1) return null;
  return (
    <Select value={value ?? ANY} onValueChange={(v) => onChange(v === ANY ? undefined : v)}>
      {/* 152px until 2xl (xl begins at exactly 1280), so search, four selects and
          the toggle share one row on a 1280 screen. */}
      <SelectTrigger className="h-8 w-full text-[12.5px] sm:w-[152px] 2xl:w-[168px]">
        <SelectValue placeholder={`Any ${label.toLowerCase()}`} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ANY}>{`Any ${label.toLowerCase()}`}</SelectItem>
        {items.map((item) => (
          <SelectItem key={item} value={item}>
            {item}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
