/**
 * The product-family demand table (V2 §42).
 *
 * One row per product family, read left to right as the argument a demand
 * planner makes: last year → this year's target → the formal plan → the gap →
 * what the missing items are worth → whether that explains it. Expanding a
 * family lists its missing SKUs with a units field each; a change moves the
 * SKU's revenue, the family row and the total together.
 *
 * Desktop reads it as a table; below `lg` each family is a stacked card, so
 * nothing scrolls sideways on a phone.
 *
 * All numbers come from `buildDemandPlan`; this only lays them out.
 */

"use client";

import { Fragment, useEffect, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { FieldRow } from "./field-row";
import { NewBadge } from "@/components/shared/new-badge";
import { useSituationScenarioStore } from "@/stores/situation-scenario-store";
import {
  bandTone,
  describeExplanation,
  type DemandFamily,
  type DemandPlan,
  type DemandRow,
  type DemandSku,
  type ExplainedBand,
  type MissingBucket,
} from "@/lib/situations/demand-plan";
import { cn } from "@/lib/utils/cn";
import { fmtMoney, fmtPct, fmtUnits } from "@/lib/utils/format";
import type { ScenarioAdjustments } from "@/types/situation";

export function fmtSignedPct(value: number): string {
  const sign = value > 0.0005 ? "+" : value < -0.0005 ? "−" : "";
  return `${sign}${fmtPct(Math.abs(value), 1)}`;
}

/** Band → risk colour. Text and bar read the same band, so they always move together. */
export const BAND_TEXT: Record<ExplainedBand, string> = {
  no_gap: "text-[var(--text-muted)]",
  covers: "text-[var(--risk-positive)]",
  partial: "text-[var(--risk-warning)]",
  short: "text-[var(--risk-critical)]",
};

const BAND_BAR: Record<ReturnType<typeof bandTone>, string> = {
  neutral: "bg-[var(--state-unknown)]",
  positive: "bg-[var(--risk-positive)]",
  warning: "bg-[var(--risk-warning)]",
  critical: "bg-[var(--risk-critical)]",
};

const BUCKET: Record<MissingBucket, { label: string; className: string }> = {
  carry_forward: {
    label: "Carrying forward",
    className: "bg-[var(--state-validated-soft)] text-[var(--state-validated)]",
  },
  to_decide: { label: "To decide", className: "bg-[var(--state-unknown-soft)] text-[var(--text-secondary)]" },
  exit: { label: "Exiting", className: "bg-[var(--state-historical-soft)] text-[var(--text-muted)]" },
};

const HEAD = "text-[10.5px] font-medium uppercase tracking-[0.06em] text-[var(--text-muted)]";
const SUB = "mt-0.5 truncate text-[11px] font-normal text-[var(--text-muted)]";
const DELTA = "text-[11px] font-medium text-[var(--state-scenario)]";

interface TableProps {
  plan: DemandPlan;
  baselinePlan: DemandPlan;
  scenarioId?: string;
  adjustments: ScenarioAdjustments;
  focusItemId?: string;
}

export function DemandFamilyTable(props: TableProps) {
  const { plan, baselinePlan, focusItemId } = props;
  const focusFamily = focusItemId
    ? plan.families.find((f) => f.skus.some((s) => s.candidateId === focusItemId))?.productFamily
    : undefined;
  const [open, setOpen] = useState<Set<string>>(() => new Set(focusFamily ? [focusFamily] : []));
  const toggle = (family: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(family)) next.delete(family);
      else next.add(family);
      return next;
    });

  const beforeByFamily = new Map(baselinePlan.families.map((f) => [f.productFamily, f]));
  const beforeSkus = new Map(baselinePlan.families.flatMap((f) => f.skus).map((s) => [s.candidateId, s]));

  const skuList = (family: DemandFamily) => (
    <SkuList
      skus={family.skus}
      beforeSkus={beforeSkus}
      currency={plan.currency}
      scenarioId={props.scenarioId}
      adjustments={props.adjustments}
      focusItemId={focusItemId}
    />
  );

  return (
    <>
      {/* Desktop: a fixed-layout table, so every column holds its width and headers sit over their numbers. */}
      <table className="hidden w-full table-fixed border-collapse text-[12.5px] tabular-nums lg:table">
        <colgroup>
          <col />
          <col className="w-[104px]" />
          <col className="w-[104px]" />
          <col className="w-[104px]" />
          <col className="w-[128px]" />
          <col className="w-[112px]" />
          <col className="w-[112px]" />
          <col className="w-[236px] xl:w-[268px]" />
        </colgroup>
        <thead>
          <tr className={cn("border-b border-[var(--border)]", HEAD)}>
            <th className="py-2 pr-3 text-left font-medium">Family</th>
            <Th>Last year</Th>
            <Th>Target</Th>
            <Th>Formal plan</Th>
            <Th>Gap to target</Th>
            <Th>Carrying</Th>
            <Th>To decide</Th>
            <th className="py-2 pl-6 text-left font-medium">Carry-forward explains</th>
          </tr>
        </thead>
        <tbody>
          {plan.families.map((family) => (
            <Fragment key={family.productFamily}>
              <FamilyRow
                row={family}
                before={beforeByFamily.get(family.productFamily)}
                currency={plan.currency}
                open={open.has(family.productFamily)}
                onToggle={family.skus.length > 0 ? () => toggle(family.productFamily) : undefined}
                skuCount={family.skus.length}
              />
              {open.has(family.productFamily) ? (
                <tr className="border-b border-[var(--border)]">
                  <td colSpan={8} className="bg-[var(--surface-sunken)] px-5 py-3">
                    {skuList(family)}
                  </td>
                </tr>
              ) : null}
            </Fragment>
          ))}
          <FamilyRow row={plan.total} before={baselinePlan.total} currency={plan.currency} total />
        </tbody>
      </table>

      {/* Phone and tablet: one card per family. */}
      <div className="flex flex-col gap-2.5 lg:hidden">
        {plan.families.map((family) => (
          <FamilyCard
            key={family.productFamily}
            row={family}
            before={beforeByFamily.get(family.productFamily)}
            currency={plan.currency}
            open={open.has(family.productFamily)}
            onToggle={family.skus.length > 0 ? () => toggle(family.productFamily) : undefined}
            skuCount={family.skus.length}
          >
            {skuList(family)}
          </FamilyCard>
        ))}
        <FamilyCard row={plan.total} before={baselinePlan.total} currency={plan.currency} total />
      </div>
    </>
  );
}

function Th({ children }: { children: ReactNode }) {
  return <th className="py-2 pl-3 text-right font-medium">{children}</th>;
}

function Delta({ value, currency }: { value: number; currency: string }) {
  return (
    <span className={DELTA}>
      {value > 0 ? "+" : "−"}
      {fmtMoney(Math.abs(value), currency)}
    </span>
  );
}

function Cell({ value, sub, delta, currency }: { value: string; sub?: string; delta?: number; currency: string }) {
  return (
    <td className="py-2.5 pl-3 text-right">
      <div className="truncate text-[var(--text-primary)]">{value}</div>
      {delta !== undefined && Math.abs(delta) >= 1 ? (
        <div className="mt-0.5 truncate">
          <Delta value={delta} currency={currency} />
        </div>
      ) : sub ? (
        <div className={SUB}>{sub}</div>
      ) : null}
    </td>
  );
}

interface RowProps {
  row: DemandRow;
  before?: DemandRow;
  currency: string;
  open?: boolean;
  onToggle?: () => void;
  skuCount?: number;
  total?: boolean;
}

function FamilyName({ row, open, onToggle, skuCount }: Pick<RowProps, "row" | "open" | "onToggle" | "skuCount">) {
  const unassigned = (row as Partial<DemandFamily>).unassigned === true;
  const name = (
    <span
      className={cn("min-w-0 truncate", unassigned && "italic text-[var(--text-secondary)]")}
      title={unassigned ? "Business plan rows with no product family" : row.productFamily}
    >
      {row.productFamily}
    </span>
  );
  if (!onToggle) {
    return <span className="flex min-w-0 items-baseline gap-1.5 pl-5 text-[var(--text-primary)]">{name}</span>;
  }
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="flex min-w-0 max-w-full items-baseline gap-1.5 text-left font-medium text-[var(--text-primary)]"
    >
      <ChevronRight
        className={cn(
          "size-3.5 flex-none self-center text-[var(--text-muted)] transition-transform",
          open && "rotate-90"
        )}
        aria-hidden
      />
      {name}
      <span className="flex-none whitespace-nowrap text-[11px] font-normal text-[var(--text-muted)]">
        {skuCount} missing
      </span>
    </button>
  );
}

function FamilyRow({ row, before, currency, open = false, onToggle, skuCount, total = false }: RowProps) {
  const band = row.explainedBand;
  const openDelta = before ? row.remainingGapValue - before.remainingGapValue : 0;
  return (
    <tr
      className={cn(
        "align-top",
        total ? "border-t-2 border-[var(--border-strong)] font-semibold" : "border-b border-[var(--border)]"
      )}
    >
      <td className="py-2.5 pr-3">
        <FamilyName row={row} open={open} onToggle={onToggle} skuCount={skuCount} />
      </td>
      <Cell value={fmtMoney(row.lyValue, currency)} sub={fmtUnits(row.lyUnits, true)} currency={currency} />
      <td className="py-2.5 pl-3 text-right">
        <div className="truncate text-[var(--text-primary)]">{fmtMoney(row.targetValue, currency)}</div>
        {row.targetGrowthPct !== undefined ? (
          <div
            className={SUB}
            title={
              row.businessGrowthPct !== undefined
                ? `Business plan growth ${fmtSignedPct(row.businessGrowthPct)}`
                : undefined
            }
          >
            {fmtSignedPct(row.targetGrowthPct)} vs LY
          </div>
        ) : null}
      </td>
      <Cell
        value={fmtMoney(row.formalValue, currency)}
        sub={row.planVsLyPct !== undefined ? `${fmtSignedPct(row.planVsLyPct)} vs LY` : undefined}
        currency={currency}
      />
      <td className="py-2.5 pl-3 text-right">
        <div className={cn("truncate", BAND_TEXT[band])}>{fmtMoney(row.gapToTargetValue, currency)}</div>
        {row.gapToTargetValue > 0.5 ? (
          <div className={SUB}>
            {fmtMoney(row.remainingGapValue, currency)} open
            {Math.abs(openDelta) >= 1 ? (
              <>
                {" "}
                <Delta value={openDelta} currency={currency} />
              </>
            ) : null}
          </div>
        ) : null}
      </td>
      <Cell
        value={fmtMoney(row.missing.carryForwardValue, currency)}
        delta={before ? row.missing.carryForwardValue - before.missing.carryForwardValue : undefined}
        currency={currency}
      />
      <Cell
        value={fmtMoney(row.missing.toDecideValue, currency)}
        delta={before ? row.missing.toDecideValue - before.missing.toDecideValue : undefined}
        sub={row.missing.exitValue > 0.5 ? `${fmtMoney(row.missing.exitValue, currency)} exiting` : undefined}
        currency={currency}
      />
      <td className="py-2.5 pl-6" title={describeExplanation(row, currency)}>
        <Explains row={row} before={before} currency={currency} />
      </td>
    </tr>
  );
}

/** The same row as a card: the name, three headline figures, and the explained band. */
function FamilyCard({
  row,
  before,
  currency,
  open = false,
  onToggle,
  skuCount,
  total = false,
  children,
}: RowProps & { children?: ReactNode }) {
  const band = row.explainedBand;
  const carryDelta = before ? row.missing.carryForwardValue - before.missing.carryForwardValue : 0;
  return (
    <div
      className={cn(
        "rounded-[var(--radius-md)] border bg-[var(--surface)]",
        total ? "border-[var(--border-strong)]" : "border-[var(--border)]"
      )}
    >
      <div className="px-3.5 py-3">
        <div className="flex items-baseline justify-between gap-3 text-[13px]">
          {total ? (
            <span className="font-semibold text-[var(--text-primary)]">Total</span>
          ) : (
            <FamilyName row={row} open={open} onToggle={onToggle} skuCount={skuCount} />
          )}
          <span className="flex-none text-[11px] tabular-nums text-[var(--text-muted)]">
            LY {fmtMoney(row.lyValue, currency)}
          </span>
        </div>

        <dl className="mt-2.5 grid grid-cols-3 gap-x-3 text-[12.5px] tabular-nums">
          <Figure label="Target" value={fmtMoney(row.targetValue, currency)} />
          <Figure label="Formal plan" value={fmtMoney(row.formalValue, currency)} />
          <Figure
            label="Gap"
            value={fmtMoney(row.gapToTargetValue, currency)}
            valueClassName={BAND_TEXT[band]}
          />
        </dl>

        <div className="mt-2 flex items-baseline justify-between gap-3 text-[11.5px] tabular-nums text-[var(--text-muted)]">
          <span className="truncate">
            Carrying {fmtMoney(row.missing.carryForwardValue, currency)}
            {Math.abs(carryDelta) >= 1 ? (
              <>
                {" "}
                <Delta value={carryDelta} currency={currency} />
              </>
            ) : null}
          </span>
          <span className="flex-none">To decide {fmtMoney(row.missing.toDecideValue, currency)}</span>
        </div>

        <div className="mt-2.5 border-t border-[var(--border)] pt-2.5">
          <Explains row={row} before={before} currency={currency} />
        </div>
      </div>
      {open && children ? (
        <div className="border-t border-[var(--border)] bg-[var(--surface-sunken)] px-3.5 py-3">{children}</div>
      ) : null}
    </div>
  );
}

function Figure({ label, value, valueClassName }: { label: string; value: string; valueClassName?: string }) {
  return (
    <div className="min-w-0">
      <dt className={HEAD}>{label}</dt>
      <dd className={cn("mt-0.5 truncate font-medium text-[var(--text-primary)]", valueClassName)}>{value}</dd>
    </div>
  );
}

function Explains({ row, before, currency }: { row: DemandRow; before?: DemandRow; currency: string }) {
  const band = row.explainedBand;
  if (band === "no_gap") {
    return <span className="text-[12px] font-normal text-[var(--text-muted)]">No gap to target</span>;
  }
  const carry = row.explainedByCarryPct ?? 0;
  const withToDecide = row.explainsTargetPct ?? carry;
  const carryW = Math.min(100, carry * 100);
  const toDecideW = Math.max(0, Math.min(100, withToDecide * 100) - carryW);
  const prior = before?.explainedByCarryPct;
  const moved = prior !== undefined && Math.abs(prior - carry) >= 0.005;
  return (
    <div className="min-w-0 font-normal">
      <div className="flex items-center gap-2">
        <span className="flex h-1.5 w-16 flex-none overflow-hidden rounded-full bg-[var(--surface-sunken)]">
          <span className={cn("block h-full", BAND_BAR[bandTone(band)])} style={{ width: `${carryW}%` }} />
          <span className="block h-full bg-[var(--state-unknown)]" style={{ width: `${toDecideW}%` }} />
        </span>
        <span className={cn("whitespace-nowrap text-[12px] font-medium", BAND_TEXT[band])}>
          {band === "covers" ? "Covers it" : `${fmtPct(carry)} explained`}
        </span>
        {moved ? <span className={cn("whitespace-nowrap", DELTA)}>was {fmtPct(prior)}</span> : null}
      </div>
      <div className="mt-0.5 truncate text-[11px] text-[var(--text-muted)]">
        {row.missing.toDecideValue > 0.5 ? `${fmtPct(Math.min(9.99, withToDecide))} with to-decide` : "Carry-forward only"}
        {row.unexplainedValue > 0.5 ? ` · ${fmtMoney(row.unexplainedValue, currency)} unexplained` : ""}
      </div>
    </div>
  );
}

/** SKU name · sold LY · units this year · revenue. A grid on desktop, stacked on a phone. */
const SKU_GRID = "sm:grid sm:grid-cols-[minmax(0,1fr)_88px_minmax(230px,300px)_104px] sm:items-center sm:gap-x-4";

function SkuList({
  skus,
  beforeSkus,
  currency,
  scenarioId,
  adjustments,
  focusItemId,
}: {
  skus: DemandSku[];
  beforeSkus: Map<string, DemandSku>;
  currency: string;
  scenarioId?: string;
  adjustments: ScenarioAdjustments;
  focusItemId?: string;
}) {
  const setVolumeUnits = useSituationScenarioStore((s) => s.setVolumeUnits);
  const clearAdjustment = useSituationScenarioStore((s) => s.clearAdjustment);

  useEffect(() => {
    if (!focusItemId || typeof document === "undefined") return;
    // Both layouts render the list; scroll to whichever is visible.
    const target = [...document.querySelectorAll<HTMLElement>(`[data-sku="${focusItemId}"]`)].find(
      (el) => el.offsetParent !== null
    );
    target?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focusItemId]);

  return (
    <div className="font-normal">
      <div className={cn("hidden border-b border-[var(--border)] pb-1.5", SKU_GRID, HEAD)}>
        <span>Missing SKU</span>
        <span className="text-right">Sold LY</span>
        <span>Units this year</span>
        <span className="text-right">Revenue</span>
      </div>
      <ul className="text-[12.5px] tabular-nums">
        {skus.map((sku) => {
          const before = beforeSkus.get(sku.candidateId);
          const delta = before ? sku.plannedValue - before.plannedValue : 0;
          const editable = scenarioId !== undefined && sku.bucket !== "exit";
          return (
            <li
              key={sku.candidateId}
              data-sku={sku.candidateId}
              className={cn(
                "border-b border-[var(--border)] py-2.5 last:border-b-0 sm:py-2",
                SKU_GRID,
                sku.candidateId === focusItemId && "-mx-2 rounded-[var(--radius-sm)] bg-[var(--interaction-selected)] px-2"
              )}
            >
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="min-w-0 truncate font-medium text-[var(--text-primary)]" title={sku.itemName}>
                    {sku.itemName}
                  </span>
                  {sku.isNewThisSeason ? <NewBadge /> : null}
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <span
                    className={cn(
                      "inline-block rounded-[var(--radius-sm)] px-1.5 py-px text-[10.5px] font-medium",
                      BUCKET[sku.bucket].className
                    )}
                  >
                    {BUCKET[sku.bucket].label}
                  </span>
                  <span className="text-[11px] text-[var(--text-muted)] sm:hidden">
                    Sold LY {fmtUnits(sku.actualUnits, true)}
                  </span>
                </div>
              </div>
              <div className="hidden text-right text-[var(--text-secondary)] sm:block">{fmtUnits(sku.actualUnits)}</div>
              <div className="mt-2 flex items-center justify-between gap-3 sm:contents">
                <div className="min-w-0 flex-1">
                  {editable ? (
                    <FieldRow
                      label={sku.itemName}
                      labelWidth={0}
                      baseline={sku.basisUnits}
                      override={adjustments.volumeUnits?.[sku.candidateId]}
                      onCommit={(value) => setVolumeUnits(scenarioId, sku.candidateId, value)}
                      onClear={() => clearAdjustment(scenarioId, "volumeUnits", sku.candidateId)}
                      display="units"
                      min={0}
                      inputWidth={96}
                    />
                  ) : (
                    <span className="text-[var(--text-muted)]">{fmtUnits(sku.plannedUnits, true)}</span>
                  )}
                </div>
                <div className="flex-none text-right">
                  <div className="text-[var(--text-primary)]">{fmtMoney(sku.plannedValue, currency)}</div>
                  {Math.abs(delta) >= 1 ? (
                    <div>
                      <Delta value={delta} currency={currency} />
                    </div>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-2.5 text-[11.5px] text-[var(--text-muted)]">
        Only carrying-forward SKUs bear load. Decide the rest on Reconcile.
      </p>
    </div>
  );
}
