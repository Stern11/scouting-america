/**
 * What changes once the carried-forward SKUs count (V2 §39, feedback: "show
 * the final plan before/after absence inclusion", and "not sure what is
 * material moving").
 *
 * Two plain before → after figures — the demand plan and factory hours — and
 * the components a planner would have to order because of these SKUs, each
 * with its order-by date and a word for what can actually be done today.
 * Packaging whose artwork or specification is unsettled reads "Can't order
 * yet", never softened (V2 §15.6).
 *
 * A rollup of numbers already derived by `summarizePortfolio`, not a fabricated
 * MRP/PO object.
 */

import Link from "next/link";
import type { ReactNode } from "react";
import { Label } from "@/components/shared/page";
import { formatMonthLabel } from "@/lib/dataset/periods";
import { cn } from "@/lib/utils/cn";
import { fmtDateShort, fmtHours, fmtMoney, fmtPct, fmtUnits, fmtWeeks } from "@/lib/utils/format";
import type { ComponentToOrder, OrderAction, PortfolioBeforeAfter } from "@/lib/situations/portfolio";

const SHOWN = 5;

const ACTION_LABEL: Record<OrderAction, string> = {
  order_now: "Order now",
  review_first: "Review first",
  cannot_order_yet: "Can't order yet",
};

export function BeforeAfterPlan({
  beforeAfter,
  materialsUnavailable,
}: {
  beforeAfter: PortfolioBeforeAfter;
  materialsUnavailable: boolean;
}) {
  const {
    demandValueBefore,
    demandValueAfter,
    addedValue,
    carriedForwardSkuCount,
    hoursBefore,
    hoursAfter,
    addedHours,
    peak,
    components,
    currency,
    valuesComparable,
  } = beforeAfter;

  const shown = components.slice(0, SHOWN);
  const hidden = components.slice(SHOWN);
  const multiProgramme = new Set(components.map((c) => c.situationId)).size > 1;

  return (
    <div className="grid grid-cols-1 gap-px overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--border)] lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <div className="grid grid-cols-1 gap-px bg-[var(--border)] sm:grid-cols-2 lg:grid-cols-1">
        <Figure
          heading="Demand plan"
          before={valuesComparable ? fmtMoney(demandValueBefore, currency) : "—"}
          after={valuesComparable ? fmtMoney(demandValueAfter, currency) : "—"}
          change={
            valuesComparable ? (
              <>
                <span className="font-medium text-[var(--state-validated)]">+{fmtMoney(addedValue, currency)}</span>{" "}
                from {carriedForwardSkuCount} carried-forward SKU{carriedForwardSkuCount === 1 ? "" : "s"}
              </>
            ) : (
              "Not summed — programmes are planned in more than one currency"
            )
          }
        />
        <Figure
          heading="Factory hours"
          before={fmtHours(hoursBefore)}
          after={fmtHours(hoursAfter)}
          change={
            <>
              <span className="font-medium text-[var(--state-validated)]">+{fmtHours(addedHours)}</span>
              {peak ? (
                <>
                  {" "}
                  · peak {peak.lineName} at{" "}
                  <span
                    className={cn(
                      "font-medium",
                      peak.effectiveUtilization > peak.targetUtilizationPct
                        ? "text-[var(--risk-critical)]"
                        : "text-[var(--text-primary)]"
                    )}
                  >
                    {fmtPct(peak.effectiveUtilization)}
                  </span>{" "}
                  in {formatMonthLabel(peak.period)}
                </>
              ) : null}
            </>
          }
        />
      </div>

      <div className="bg-[var(--surface)] px-5 py-4">
        <Label>Components to order because of these SKUs</Label>
        {materialsUnavailable && components.length === 0 ? (
          <p className="mt-3 text-[12.5px] text-[var(--text-muted)]">
            Add BOM data to see which components these SKUs need.
          </p>
        ) : components.length === 0 ? (
          <p className="mt-3 text-[12.5px] text-[var(--text-muted)]">No carried-forward SKU needs a component yet.</p>
        ) : (
          <>
            <ul className="mt-2 divide-y divide-[var(--border)]">
              {shown.map((c) => (
                <ComponentRow key={`${c.situationId}-${c.materialId}`} component={c} showProgramme={multiProgramme} />
              ))}
            </ul>
            {hidden.length > 0 ? (
              <Link
                href="/decisions"
                className="mt-2 inline-block text-[12px] text-[var(--text-secondary)] underline-offset-2 hover:text-[var(--text-primary)] hover:underline"
              >
                +{hidden.length} more
              </Link>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function Figure({
  heading,
  before,
  after,
  change,
}: {
  heading: string;
  before: string;
  after: string;
  change: ReactNode;
}) {
  return (
    <div className="bg-[var(--surface)] px-5 py-4">
      <Label>{heading}</Label>
      <div className="mt-2.5 flex items-end gap-3">
        <div>
          <div className="text-[18px] font-medium leading-none tabular-nums text-[var(--text-muted)]">{before}</div>
          <div className="mt-1 text-[10.5px] text-[var(--text-muted)]">in the plan today</div>
        </div>
        <span className="pb-4 text-[14px] text-[var(--text-muted)]">→</span>
        <div>
          <div className="text-[22px] font-semibold leading-none tabular-nums text-[var(--text-primary)]">{after}</div>
          <div className="mt-1 text-[10.5px] text-[var(--text-muted)]">once these SKUs count</div>
        </div>
      </div>
      <div className="mt-2 text-[12px] leading-snug text-[var(--text-secondary)]">{change}</div>
    </div>
  );
}

function ComponentRow({ component: c, showProgramme }: { component: ComponentToOrder; showProgramme: boolean }) {
  // A net requirement of nothing is not "order 0 kg" — stock already covers it.
  const quantity = c.quantity < 0.5 ? "covered by stock" : `${fmtUnits(c.quantity)} ${c.uom}`;
  const detail = [c.action === "cannot_order_yet" ? c.reason : undefined, showProgramme ? c.situationTitle : undefined]
    .filter(Boolean)
    .join(" · ");
  return (
    <li className="flex items-baseline justify-between gap-3 py-2">
      <div className="min-w-0">
        <div className="truncate text-[13px] text-[var(--text-primary)]" title={c.materialName}>
          {c.materialName}
          {/* Beside the name where there is room; on a phone it leads the second line. */}
          <span
            className="ml-2 hidden text-[12px] tabular-nums text-[var(--text-muted)] sm:inline"
            title={c.netOfStock ? "Net of stock" : "Gross requirement"}
          >
            {quantity}
          </span>
        </div>
        <div className="truncate text-[11.5px] text-[var(--text-muted)]" title={detail || undefined}>
          <span className="tabular-nums sm:hidden">
            {quantity}
            {detail ? " · " : ""}
          </span>
          {detail}
        </div>
      </div>
      <div className="flex-none text-right">
        <div
          className={cn(
            "text-[12px] font-medium",
            c.action === "order_now" && "text-[var(--risk-positive)]",
            c.action === "review_first" && "text-[var(--risk-warning)]",
            c.action === "cannot_order_yet" && "text-[var(--text-muted)]"
          )}
          title={c.reason}
        >
          {ACTION_LABEL[c.action]}
        </div>
        <div className="text-[11.5px] tabular-nums text-[var(--text-muted)]">
          by {fmtDateShort(c.decisionDate)} ·{" "}
          <span className={c.weeksToDecision <= 0 ? "font-medium text-[var(--risk-critical)]" : undefined}>
            {c.weeksToDecision > 0 ? `${c.weeksToDecision}w left` : fmtWeeks(c.weeksToDecision)}
          </span>
        </div>
      </div>
    </li>
  );
}
