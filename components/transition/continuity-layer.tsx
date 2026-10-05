/**
 * The continuity layer — the single most important view in the product.
 *
 * Legacy SKU on the left, successor on the right, and between them the claim
 * the whole product rests on: these records are one continuous requirement.
 * Below, what that claim changes: one demand figure, one usable supply, one
 * order — beside what an item-by-item view would have ordered.
 */

import Link from "next/link";
import { ArrowDown, ArrowRight } from "lucide-react";
import type { SkuRow } from "@/types/dataset";
import type { TransitionView } from "@/types/transition";
import { cn } from "@/lib/utils/cn";
import { fmtDateShort, fmtNum, fmtPct } from "@/lib/utils/format";
import { weeksFrom } from "@/lib/transitions/time";

export function ContinuityLayer({ view }: { view: TransitionView }) {
  const { lineage, demand, inventory: inv, replenishment: rep, coverage } = view;
  const nextReceipt = inv.receipts.find((r) => lineage.successors.some((s) => s.skuId === r.skuId));

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div>
        <div className="grid grid-cols-1 items-stretch gap-3 md:grid-cols-[minmax(0,1fr)_88px_minmax(0,1fr)]">
          <SkuSide
            role="legacy"
            title={lineage.predecessors.length > 1 ? "Legacy SKUs" : "Legacy SKU"}
            skus={lineage.predecessors}
            empty="No legacy SKU — a new product with no history to carry."
            lines={[
              { label: "Sales, last 52 weeks", value: fmtNum(demand.legacyUnitsL52) },
              { label: "Store inventory", value: fmtNum(inv.stores.legacy) },
              { label: "DC inventory", value: fmtNum(inv.dc.legacy) },
            ]}
          />

          <div className="flex flex-row items-center justify-center gap-2 md:flex-col">
            <ArrowRight className="hidden size-5 text-[var(--text-muted)] md:block" />
            <ArrowDown className="size-5 text-[var(--text-muted)] md:hidden" />
            <span className="text-center text-[10px] font-semibold uppercase leading-tight tracking-[0.1em] text-[var(--accent)]">
              Continuity
              <br className="hidden md:block" /> layer
            </span>
          </div>

          <SkuSide
            role="successor"
            title={lineage.successors.length > 1 ? "Successor SKUs" : "Successor SKU"}
            skus={lineage.successors}
            empty="No successor — this demand does not carry forward."
            lines={[
              { label: "Sales, last 52 weeks", value: fmtNum(demand.successorUnitsL52) },
              { label: "On hand, stores + DC", value: fmtNum(inv.successorOnHand) },
              {
                label: "Inbound",
                value: inv.inbound.successor > 0 ? fmtNum(inv.inbound.successor) : "None on order",
                sub: nextReceipt ? `next ${fmtDateShort(nextReceipt.expectedDate)}` : undefined,
              },
            ]}
          />
        </div>

        {/* One stream → one requirement → one order. */}
        <div className="mt-3 grid grid-cols-1 divide-y divide-[var(--border)] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <Outcome
            label={`Expected demand · ${demand.horizonWeeks} wks`}
            value={demand.available ? fmtNum(demand.horizonUnits) : "—"}
            sub={demand.available ? `${fmtNum(demand.weeklyUnits)} a week, legacy history carried forward` : "No sales history"}
          />
          <Outcome
            label="Usable supply"
            value={fmtNum(inv.effectiveSupply)}
            sub={`${fmtNum(inv.usableLegacy)} legacy (${fmtPct(inv.substitutabilityPct)} usable) + ${fmtNum(inv.successorOnHand + inv.eligibleInbound)} successor`}
          />
          <Outcome
            label="Recommended replenishment"
            value={lineage.successors.length === 0 ? "—" : fmtNum(rep.finalOrderUnits)}
            tone="accent"
            sub={
              lineage.successors.length === 0
                ? "Nothing is reordered for a discontinued product"
                : rep.avoidedUnits > 0
                  ? `not ${fmtNum(rep.ignoringLegacyUnits)} — ${fmtNum(rep.avoidedUnits)} deferred or avoided`
                  : "legacy stock does not change this order"
            }
          />
        </div>
      </div>

      {/* The local truth the network total hides. */}
      <div className="flex flex-col justify-center gap-4 border-t border-[var(--border)] pt-5 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
        {coverage.available ? (
          <>
            <p className="text-[15px] leading-snug text-[var(--text-primary)]">
              <span className={cn("text-[22px] font-semibold tabular-nums", coverage.atRiskCount > 0 ? "text-[var(--risk-critical)]" : "text-[var(--risk-positive)]")}>
                {coverage.atRiskCount}
              </span>{" "}
              {coverage.atRiskCount === 1 ? "store still faces" : "stores still face"} local stockout risk
              {inv.networkWeeksOfCover !== null && coverage.atRiskCount > 0
                ? `, though the network holds ${fmtNum(inv.networkWeeksOfCover)} weeks of cover.`
                : "."}
            </p>
            {coverage.transferUnits > 0 ? (
              <p className="text-[15px] leading-snug text-[var(--text-primary)]">
                <span className="text-[22px] font-semibold tabular-nums text-[var(--accent)]">{fmtNum(coverage.transferUnits)}</span>{" "}
                units can be rebalanced between stores before any additional purchasing.
              </p>
            ) : null}
            <Link href="#stores" className="text-[12.5px] font-medium text-[var(--accent)] hover:underline">
              See store coverage →
            </Link>
          </>
        ) : (
          <p className="text-[13px] text-[var(--text-muted)]">{coverage.unavailableReason}</p>
        )}
      </div>
    </div>
  );
}

function SkuSide({
  role,
  title,
  skus,
  empty,
  lines,
}: {
  role: "legacy" | "successor";
  title: string;
  skus: readonly SkuRow[];
  empty: string;
  lines: { label: string; value: string; sub?: string }[];
}) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius-lg)] border bg-[var(--surface)] p-4",
        role === "legacy" ? "border-[var(--lineage-legacy)]/40" : "border-[var(--lineage-successor)]/40"
      )}
    >
      <div
        className={cn(
          "text-[10.5px] font-semibold uppercase tracking-[0.1em]",
          role === "legacy" ? "text-[var(--lineage-legacy)]" : "text-[var(--lineage-successor)]"
        )}
      >
        {title}
      </div>
      {skus.length === 0 ? (
        <p className="mt-3 text-[12.5px] text-[var(--text-muted)]">{empty}</p>
      ) : (
        <>
          <div className="mt-2 space-y-1.5">
            {skus.map((s) => (
              <div key={s.skuId}>
                <div className="font-mono text-[17px] font-semibold tracking-tight text-[var(--text-primary)]">{s.skuId}</div>
                <div className="truncate text-[12px] text-[var(--text-secondary)]" title={s.skuName}>
                  {s.skuName}
                </div>
              </div>
            ))}
          </div>
          <dl className="mt-3 space-y-1.5 border-t border-[var(--border)] pt-3">
            {lines.map((l) => (
              <div key={l.label} className="flex items-baseline justify-between gap-3">
                <dt className="text-[12px] text-[var(--text-muted)]">{l.label}</dt>
                <dd className="text-right text-[13.5px] font-semibold tabular-nums text-[var(--text-primary)]">
                  {l.value}
                  {l.sub ? <span className="ml-1 text-[11px] font-normal text-[var(--text-muted)]">{l.sub}</span> : null}
                </dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </div>
  );
}

function Outcome({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: "accent" }) {
  return (
    <div className="px-4 py-3.5">
      <div className="text-[11px] font-medium uppercase tracking-[0.07em] text-[var(--text-muted)]">{label}</div>
      <div
        className={cn(
          "mt-1 text-[26px] font-semibold leading-none tabular-nums",
          tone === "accent" ? "text-[var(--accent)]" : "text-[var(--text-primary)]"
        )}
      >
        {value}
      </div>
      <div className="mt-1.5 text-[11.5px] leading-snug text-[var(--text-muted)]">{sub}</div>
    </div>
  );
}

/**
 * JDA plan vs Heizen view: the same products, read two ways.
 */
export function JdaVersusHeizen({ view }: { view: TransitionView }) {
  const { lineage, replenishment: rep, inventory: inv, demand } = view;
  const jda = rep.jda;
  return (
    <div className="grid grid-cols-1 overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] md:grid-cols-2">
      <div className="bg-[var(--surface-sunken)] p-5">
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">JDA sees</div>
        <p className="mt-1 text-[12.5px] text-[var(--text-secondary)]">
          {lineage.predecessors.length + lineage.successors.length} separate SKU records
        </p>
        <div className="mt-3 space-y-3">
          {lineage.predecessors.map((s) => (
            <SkuRecord
              key={s.skuId}
              sku={s}
              facts={[
                s.status === "DISCONTINUED" ? "Discontinued" : s.status === "BLOCKED" ? "Blocked" : "Active",
                `DC inventory ${fmtNum(view.inventory.dc.legacy)}`,
                "Not planned forward",
              ]}
            />
          ))}
          {lineage.successors.map((s) => (
            <SkuRecord
              key={s.skuId}
              sku={s}
              facts={[
                s.status === "NEW" ? "New SKU" : "Active",
                s.launchDate ? `History: ${Math.max(0, Math.round(weeksFrom(s.launchDate, view.planningNow)))} weeks` : "History: limited",
                jda ? `Forecast ${fmtNum(jda.forecastUnits)}` : "No JDA forecast supplied",
                ...(jda?.plannedOrderUnits !== undefined ? [`Planned order ${fmtNum(jda.plannedOrderUnits)}`] : []),
              ]}
            />
          ))}
        </div>
      </div>
      <div className="border-t border-[var(--border)] bg-[var(--surface)] p-5 md:border-l md:border-t-0">
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--accent)]">Heizen sees</div>
        <p className="mt-1 text-[12.5px] text-[var(--text-secondary)]">One continuous product requirement</p>
        <dl className="mt-3 space-y-2">
          <Fact label="Legacy still sellable" value={fmtNum(inv.usableLegacy)} />
          <Fact label="Successor inventory" value={`${fmtNum(inv.successorOnHand)}${inv.eligibleInbound > 0 ? ` + ${fmtNum(inv.eligibleInbound)} inbound` : ""}`} />
          <Fact label={`Continuity demand, ${demand.horizonWeeks} wks`} value={demand.available ? fmtNum(demand.horizonUnits) : "—"} />
          <Fact label="Recommended replenishment" value={lineage.successors.length ? fmtNum(rep.finalOrderUnits) : "—"} strong />
          {jda?.plannedOrderUnits !== undefined ? (
            <Fact
              label="Versus JDA planned order"
              value={`${rep.finalOrderUnits - jda.plannedOrderUnits > 0 ? "+" : ""}${fmtNum(rep.finalOrderUnits - jda.plannedOrderUnits)}`}
            />
          ) : null}
        </dl>
      </div>
    </div>
  );
}

function SkuRecord({ sku, facts }: { sku: SkuRow; facts: string[] }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5">
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-[13px] font-semibold text-[var(--text-primary)]">{sku.skuId}</span>
        <span className="truncate text-[11.5px] text-[var(--text-muted)]">{sku.skuName}</span>
      </div>
      <div className="mt-1 text-[12px] text-[var(--text-secondary)]">{facts.join(" · ")}</div>
    </div>
  );
}

function Fact({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-dashed border-[var(--border)] pb-1.5 last:border-b-0">
      <dt className="text-[12.5px] text-[var(--text-secondary)]">{label}</dt>
      <dd className={cn("tabular-nums", strong ? "text-[16px] font-semibold text-[var(--accent)]" : "text-[13.5px] font-medium text-[var(--text-primary)]")}>
        {value}
      </dd>
    </div>
  );
}
