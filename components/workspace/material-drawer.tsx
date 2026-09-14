/**
 * One component, in full (V2 §18, §15.3).
 *
 * Intent: a planner who has just seen a date on the clock and is deciding
 * whether to act on it. What must they do — believe the date, or not. It
 * should feel like a spec sheet: dense, quiet, everything sourced.
 *
 * Hierarchy: the requirement wins (32px/600/tabular), because that is the
 * number being committed. Coverage sits beside it at half the size. The
 * lead-time comparison is the only place colour appears, because that is the
 * only place a planner is being asked to disagree with their own system.
 *
 * Depth: borders only — this is a dense technical surface, and shadows on a
 * panel already lifted by the drawer would be two elevation strategies at once.
 */

"use client";

import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { MaterialStatusBadge } from "@/components/shared/state-badge";
import { Label } from "@/components/shared/page";
import { SupplierTable } from "@/components/workspace/supplier-table";
import { materialDetail, type MaterialDetail } from "@/lib/situations/material-detail";
import { supplierComparison, type SupplierComparison } from "@/lib/situations/suppliers";
import { cn } from "@/lib/utils/cn";
import { fmtDateShort, fmtNum, fmtPct, fmtWeeks } from "@/lib/utils/format";
import type { PlanningDataset } from "@/types/dataset";
import type { PlanningSituation } from "@/types/situation";

export function MaterialDrawer({
  dataset,
  situation,
  materialId,
  onClose,
}: {
  dataset: PlanningDataset | null;
  situation: PlanningSituation;
  materialId: string | null;
  onClose: () => void;
}) {
  const detail = dataset && materialId ? materialDetail(dataset, situation, materialId) : undefined;
  const comparison =
    dataset && materialId ? supplierComparison(dataset, situation, materialId) : undefined;

  return (
    <Drawer open={detail !== undefined} onOpenChange={(open) => (open ? undefined : onClose())}>
      {detail && comparison ? (
        <DrawerContent
          title={detail.materialName}
          description={`${detail.componentType.replace(/_/g, " ").toLowerCase()} · ${situation.title}`}
          eyebrow={detail.hasInferredSource ? "Partly inferred" : undefined}
        >
          <Body detail={detail} comparison={comparison} />
        </DrawerContent>
      ) : null}
    </Drawer>
  );
}

function Body({ detail, comparison }: { detail: MaterialDetail; comparison: SupplierComparison }) {
  return (
    <div className="flex flex-col gap-7">
      {/* The figure being committed leads; everything else is support. */}
      <section>
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <Label>Required this season</Label>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-[32px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-[var(--text-primary)]">
                {fmtNum(Math.round(detail.requiredBase))}
              </span>
              <span className="text-[15px] text-[var(--text-secondary)]">{detail.uom}</span>
            </div>
            <div className="mt-2 text-[12px] tabular-nums text-[var(--text-muted)]">
              {fmtNum(Math.round(detail.requiredLow))} – {fmtNum(Math.round(detail.requiredHigh))}{" "}
              {detail.uom} range
              {detail.hasInferredSource ? " · widened because part of it is inferred" : ""}
            </div>
          </div>

          <div className="flex items-end gap-7">
            {detail.priorSeasonRequirement !== undefined ? (
              <Stat
                label="Last season"
                value={fmtNum(Math.round(detail.priorSeasonRequirement))}
                sub={
                  detail.vsPriorSeason !== undefined
                    ? `${detail.vsPriorSeason >= 0 ? "+" : ""}${Math.round(detail.vsPriorSeason * 100)}%`
                    : undefined
                }
                subTone={
                  detail.vsPriorSeason === undefined
                    ? "muted"
                    : detail.vsPriorSeason >= 0
                      ? "positive"
                      : "critical"
                }
              />
            ) : null}
            <div>
              <Label>Readiness</Label>
              <div className="mt-1.5">
                <MaterialStatusBadge status={detail.status} />
              </div>
            </div>
          </div>
        </div>
        <p className="mt-3 text-[12.5px] text-[var(--text-secondary)]">{detail.reason}</p>
      </section>

      {/* ---------------- coverage ---------------- */}
      <section>
        <Heading>How much is already covered</Heading>
        <Coverage detail={detail} />
      </section>

      {/* ---------------- lead time ---------------- */}
      <section>
        <Heading
          aside={
            detail.sample
              ? `${detail.sample.count} receipts${detail.sample.from ? ` since ${fmtDateShort(detail.sample.from)}` : ""}`
              : undefined
          }
        >
          How long it takes to arrive
        </Heading>
        {detail.sample ? (
          <LeadTime detail={detail} />
        ) : (
          <p className="text-[12.5px] text-[var(--text-muted)]">{detail.sampleUnavailableReason}</p>
        )}
      </section>

      {/* ---------------- suppliers ---------------- */}
      {/* The same table the release dialog awards from, off the same
          derivation — the drawer and the decision cannot disagree. */}
      <section>
        <Heading
          aside={comparison.suppliers.length > 0 ? `${comparison.suppliers.length} of record` : undefined}
        >
          Who supplies it
        </Heading>
        {comparison.suppliers.length > 0 ? (
          <SupplierTable comparison={comparison} layout="list" />
        ) : (
          <p className="text-[12.5px] text-[var(--text-muted)]">{comparison.unavailableReason}</p>
        )}
      </section>

      {/* ---------------- who needs it ---------------- */}
      <section>
        <Heading aside={`${detail.contributors.length} product${detail.contributors.length === 1 ? "" : "s"}`}>
          What it is for
        </Heading>
        <div className="flex flex-col">
          {detail.contributors.slice(0, 8).map((c) => (
            <div
              key={c.candidateId}
              className="flex items-baseline justify-between gap-4 border-b border-[var(--border)] py-2 last:border-b-0"
            >
              <span className="min-w-0 truncate text-[12.5px] text-[var(--text-primary)]">
                {c.itemName}
                {c.derivation === "analogue" ? (
                  <span className="ml-2 text-[11px] text-[var(--state-inferred)]">inferred</span>
                ) : null}
              </span>
              <span className="flex-none text-[12px] tabular-nums text-[var(--text-secondary)]">
                {fmtNum(Math.round(c.requirement))} {detail.uom}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/* ------------------------------------------------------------------ */

/**
 * On hand, on order, and still to buy — as one bar rather than three figures,
 * because the question is what proportion of the requirement is settled.
 */
function Coverage({ detail }: { detail: MaterialDetail }) {
  const total = Math.max(detail.requiredBase, detail.coveredQty, 1);
  const seg = (qty: number) => (qty / total) * 100;

  return (
    <div>
      <div className="relative h-[26px] overflow-hidden rounded-[4px] bg-[var(--chart-track)]">
        <div
          className="absolute inset-y-0 left-0 bg-[var(--state-formal)]"
          style={{ width: `${seg(detail.onHandQty)}%` }}
          title={`On hand ${fmtNum(Math.round(detail.onHandQty))} ${detail.uom}`}
        />
        <div
          className="absolute inset-y-0 bg-[var(--state-validated)]"
          style={{ left: `${seg(detail.onHandQty)}%`, width: `${seg(detail.openPoQty)}%` }}
          title={`On order ${fmtNum(Math.round(detail.openPoQty))} ${detail.uom}`}
        />
        <div
          className="absolute inset-y-0 bg-[var(--state-scenario)]"
          style={{
            left: `${seg(detail.onHandQty + detail.openPoQty)}%`,
            width: `${seg(detail.plannedReceiptQty)}%`,
          }}
          title={`Planned receipts ${fmtNum(Math.round(detail.plannedReceiptQty))} ${detail.uom}`}
        />
        {/* Where the requirement sits, so an over-covered bar still reads. */}
        <div
          className="absolute inset-y-[-2px] w-[2px] bg-[var(--text-primary)]"
          style={{ left: `${seg(detail.requiredBase)}%` }}
          title={`Required ${fmtNum(Math.round(detail.requiredBase))} ${detail.uom}`}
        />
      </div>

      <div className="mt-2.5 grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-4">
        <Legend swatch="var(--state-formal)" label="On hand" value={detail.onHandQty} uom={detail.uom} />
        <Legend swatch="var(--state-validated)" label="On order" value={detail.openPoQty} uom={detail.uom} />
        <Legend
          swatch="var(--state-scenario)"
          label="Planned receipts"
          value={detail.plannedReceiptQty}
          uom={detail.uom}
        />
        <Legend
          swatch="transparent"
          label="Still to buy"
          value={detail.outstandingQty}
          uom={detail.uom}
          strong
        />
      </div>

      <p className="mt-2.5 text-[12px] text-[var(--text-secondary)]">
        <span className="font-semibold tabular-nums text-[var(--text-primary)]">
          {fmtPct(detail.coveragePct)}
        </span>{" "}
        of this season&rsquo;s requirement is already on hand or on order.
        {detail.outstandingQty > 0
          ? ` ${fmtNum(Math.round(detail.outstandingQty))} ${detail.uom} still has to be bought, by ${fmtDateShort(detail.decisionDate)}.`
          : " Nothing further has to be bought."}
      </p>
    </div>
  );
}

/**
 * The system assumption against what actually happened.
 *
 * Deliberately not framed as the system being wrong — a contractual lead time
 * and an elapsed process time are different measurements, and history differing
 * is a reason to look rather than proof of an error (V2 §18.5).
 */
function LeadTime({ detail }: { detail: MaterialDetail }) {
  const sample = detail.sample;
  if (!sample) return null;

  const max = Math.max(sample.maxDays, sample.systemDays ?? 0, detail.leadTimeDays) * 1.05;
  const bar = (days: number) => `${Math.max(1, (days / max) * 100)}%`;

  const rows: { label: string; days: number; token: string; active: boolean }[] = [
    ...(sample.systemDays !== undefined
      ? [{ label: "System assumption", days: sample.systemDays, token: "--state-formal", active: false }]
      : []),
    { label: "Observed median", days: sample.medianDays, token: "--state-historical", active: false },
    { label: "Observed P80", days: sample.p80Days, token: "--state-inferred", active: false },
    {
      label: "Planning on",
      days: detail.leadTimeDays,
      token: "--state-validated",
      active: true,
    },
  ];

  const drift =
    sample.systemDays !== undefined ? sample.medianDays - sample.systemDays : undefined;

  return (
    <div>
      <div className="flex flex-col gap-1.5">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center gap-2 sm:gap-3">
            <span
              className={cn(
                "w-[118px] flex-none truncate whitespace-nowrap text-[11.5px] sm:w-[132px]",
                row.active
                  ? "font-medium text-[var(--text-primary)]"
                  : "text-[var(--text-muted)]"
              )}
            >
              {row.label}
            </span>
            <div className="h-[16px] flex-1 rounded-[3px] bg-[var(--chart-track)]">
              <div
                className="h-full rounded-[3px] transition-[width]"
                style={{
                  width: bar(row.days),
                  background: `var(${row.token})`,
                  transitionDuration: "var(--duration-medium)",
                  transitionTimingFunction: "var(--ease-out)",
                }}
              />
            </div>
            <span
              className={cn(
                "w-[52px] flex-none text-right text-[12px] tabular-nums",
                row.active
                  ? "font-semibold text-[var(--text-primary)]"
                  : "text-[var(--text-secondary)]"
              )}
            >
              {Math.round(row.days)}d
            </span>
          </div>
        ))}
      </div>

      <p className="mt-2.5 text-[12px] leading-relaxed text-[var(--text-secondary)]">
        {drift !== undefined && Math.abs(drift) >= 3 ? (
          <>
            Observed receipts run{" "}
            <span
              className={cn(
                "font-semibold tabular-nums",
                drift > 0 ? "text-[var(--risk-warning)]" : "text-[var(--risk-positive)]"
              )}
            >
              {drift > 0 ? "+" : ""}
              {Math.round(drift)} days
            </span>{" "}
            against the system assumption. That is a reason to review the assumption, not proof it
            is wrong — a contractual lead time and an elapsed process time measure different things.
          </>
        ) : (
          <>History and the system assumption agree closely enough to plan on either.</>
        )}{" "}
        <span className="text-[var(--text-muted)]">
          Range {Math.round(sample.minDays)}–{Math.round(sample.maxDays)}d across {sample.count}{" "}
          receipts.
        </span>
      </p>

      <div className="mt-3 text-[12px] text-[var(--text-muted)]">
        Order by{" "}
        <span className="font-medium tabular-nums text-[var(--text-primary)]">
          {fmtDateShort(detail.decisionDate)}
        </span>{" "}
        · {fmtWeeks(detail.weeksToDecision)} away · planning on {basisWord(detail.leadTimeBasis)}
      </div>
    </div>
  );
}

function Legend({
  swatch,
  label,
  value,
  uom,
  strong,
}: {
  swatch: string;
  label: string;
  value: number;
  uom: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <span
        className={cn(
          "size-2.5 flex-none translate-y-[1px] rounded-[2px]",
          swatch === "transparent" && "border border-[var(--border-strong)]"
        )}
        style={swatch === "transparent" ? undefined : { background: swatch }}
      />
      <span className="min-w-0">
        <span className="block text-[11px] text-[var(--text-muted)]">{label}</span>
        <span
          className={cn(
            "block text-[12.5px] tabular-nums",
            strong ? "font-semibold text-[var(--text-primary)]" : "text-[var(--text-secondary)]"
          )}
        >
          {fmtNum(Math.round(value))} {uom}
        </span>
      </span>
    </div>
  );
}

function Heading({ children, aside }: { children: React.ReactNode; aside?: string }) {
  return (
    // Each part stays on one line; when both do not fit, the aside drops below
    // whole rather than both breaking into a ragged four-line block.
    <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
      <span className="whitespace-nowrap text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-secondary)]">
        {children}
      </span>
      {aside ? <span className="whitespace-nowrap text-[11.5px] text-[var(--text-muted)]">{aside}</span> : null}
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  subTone,
}: {
  label: string;
  value: string;
  sub?: string;
  subTone: "positive" | "critical" | "muted";
}) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="mt-1 text-[16px] font-medium tabular-nums text-[var(--text-primary)]">
        {value}
      </div>
      {sub ? (
        <div
          className={cn(
            "text-[11.5px] font-medium tabular-nums",
            subTone === "positive" && "text-[var(--risk-positive)]",
            subTone === "critical" && "text-[var(--risk-critical)]",
            subTone === "muted" && "text-[var(--text-muted)]"
          )}
        >
          {sub} vs last season
        </div>
      ) : null}
    </div>
  );
}

function basisWord(basis: string): string {
  if (basis === "historical_p80") return "the observed P80";
  if (basis === "historical_median") return "the observed median";
  if (basis === "scenario") return "a scenario value";
  return "the system assumption";
}
