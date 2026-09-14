/**
 * Who to award an order to (V2 §18, §15).
 *
 * "Release" used to record that a component could be ordered without saying
 * from whom — while the drawer beside it listed two or three suppliers of
 * record. Procurement awards an order on a supplier's record, so this reads
 * each supplier's receipts for one material and states that record:
 *
 * - how many receipts, and what share of quantity;
 * - when they last delivered, and whether they served the latest order;
 * - median lead time ± spread, and the P80 a date is planned on;
 * - on time, in full, and on time in full (OTIF) — only where the history
 *   carries promised dates and received quantities;
 * - whether an order placed today still lands before production starts.
 *
 * Definitions, stated once so the UI can name them:
 *
 * - **Spread** is half the P10–P90 range. It ignores a single freak receipt
 *   that a standard deviation would be dragged by, reads in days like the
 *   median beside it, and still means something on a dozen receipts.
 * - **On time**: received on or before the promised date.
 * - **In full**: received quantity at least the ordered quantity. Strict — a
 *   short shipment of 1% is not in full.
 * - **OTIF**: both, on the same receipt, over receipts that carry both fields.
 *
 * A metric the data cannot support is undefined with a reason, never a
 * plausible number. Nothing here orders anything.
 *
 * Pure: no React.
 */

import type { LeadTimeHistoryRow, PlanningDataset } from "@/types/dataset";
import type { PlanningSituation } from "@/types/situation";
import { addDays, daysBetween, weeksBetween } from "@/lib/dataset/periods";

/** Below this many receipts a supplier has anecdotes, not a record. */
export const MIN_RECORD = 3;

/**
 * At or above this many receipts a record is strong enough to win an award on
 * its own terms — the same threshold the material drawer uses for a lead-time
 * sample. Below it, a rarely used and slower supplier could otherwise take the
 * award on the strength of three or four lucky deliveries.
 */
export const ADEQUATE_RECORD = 5;

/** 2 adequate, 1 limited, 0 anecdotal. */
function recordTier(receipts: number): number {
  return receipts >= ADEQUATE_RECORD ? 2 : receipts >= MIN_RECORD ? 1 : 0;
}

export interface SupplierPerformance {
  supplierId: string;
  supplierName: string;
  receipts: number;
  /** Share of received-history quantity, 0-1. */
  quantityShare: number;
  /** True when there are too few receipts to rank on the record. */
  thinRecord: boolean;

  /** Most recent receipt on or before planning now. */
  lastReceiptDate?: string;
  /** Delivered the material's most recent receipt of any supplier. */
  servedLatestOrder: boolean;

  medianLeadTimeDays: number;
  p80LeadTimeDays: number;
  /** ± half the P10–P90 range, in days. Undefined on a thin record. */
  spreadDays?: number;

  onTimePct?: number;
  inFullPct?: number;
  otifPct?: number;
  /** Receipts each rate was measured over. */
  onTimeSample: number;
  inFullSample: number;
  otifSample: number;
  /** Why OTIF is missing, when it is. */
  otifReason?: string;

  /** Latest order date that still lands by production start on this supplier's P80. */
  orderByDate?: string;
  weeksToOrderBy?: number;
  /** Whether an order placed now lands in time on the P80. Undefined with no production window. */
  landsInTime?: boolean;
}

export interface SupplierComparison {
  /** Ranked: lands in time, then an adequate record, then OTIF, then P80. */
  suppliers: SupplierPerformance[];
  recommended?: { supplierId: string; supplierName: string; reason: string };
  productionStart?: string;
  /** Set when a whole column cannot be calculated from this history. */
  onTimeUnavailable?: string;
  inFullUnavailable?: string;
  /** Set when there are no supplier receipts at all. */
  unavailableReason?: string;
}

export const NO_PROMISED_DATES = "The lead-time history has no promised dates, so on-time delivery is not calculated.";
export const NO_RECEIVED_QTY = "The lead-time history has no received quantities, so in-full delivery is not calculated.";

/** Every supplier of one material, ranked for an award decision. */
export function supplierComparison(
  dataset: PlanningDataset,
  situation: PlanningSituation,
  materialId: string
): SupplierComparison {
  return compareSuppliers(
    dataset.leadTimeHistory.filter((r) => r.materialId === materialId),
    { now: dataset.metadata.planningNow, productionStart: situation.productionWindow?.start }
  );
}

export function compareSuppliers(
  history: readonly LeadTimeHistoryRow[],
  { now, productionStart }: { now: string; productionStart?: string }
): SupplierComparison {
  // A receipt with no elapsed time or no supplier cannot say anything about
  // who to award to.
  const receipts = history.filter(
    (r) => Number.isFinite(r.actualLeadTimeDays) && r.actualLeadTimeDays > 0 && (r.supplierId || r.supplierName)
  );
  if (receipts.length === 0) {
    return {
      suppliers: [],
      productionStart,
      unavailableReason:
        history.length === 0
          ? "No receipts for this material in the lead-time history."
          : "The lead-time history does not name a supplier for this material.",
    };
  }

  const today = now.slice(0, 10);
  const anyPromised = receipts.some((r) => r.promisedDate);
  const anyReceived = receipts.some((r) => r.receivedQuantity !== undefined);
  const totalQty = receipts.reduce((sum, r) => sum + r.quantity, 0);

  // The latest receipt already in — one dated after planning now has not
  // been served yet, whatever the row says.
  const delivered = receipts.filter((r) => r.receiptDate.slice(0, 10) <= today);
  const latestReceipt = delivered.map((r) => r.receiptDate.slice(0, 10)).sort().at(-1);

  const bySupplier = new Map<string, LeadTimeHistoryRow[]>();
  for (const r of receipts) {
    const key = r.supplierId ?? r.supplierName!;
    bySupplier.set(key, [...(bySupplier.get(key) ?? []), r]);
  }

  const suppliers: SupplierPerformance[] = [...bySupplier.entries()].map(([supplierId, rows]) => {
    const days = rows.map((r) => r.actualLeadTimeDays);
    const qty = rows.reduce((sum, r) => sum + r.quantity, 0);
    const lastReceiptDate = rows
      .map((r) => r.receiptDate.slice(0, 10))
      .filter((d) => d <= today)
      .sort()
      .at(-1);

    const promised = rows.filter((r) => r.promisedDate);
    const received = rows.filter((r) => r.receivedQuantity !== undefined);
    const both = rows.filter((r) => r.promisedDate && r.receivedQuantity !== undefined);
    const onTime = (r: LeadTimeHistoryRow) => r.receiptDate.slice(0, 10) <= r.promisedDate!.slice(0, 10);
    const inFull = (r: LeadTimeHistoryRow) => r.receivedQuantity! >= r.quantity;

    const p80 = percentile(days, 0.8);
    const orderByDate = productionStart ? addDays(productionStart, -Math.round(p80)) : undefined;

    return {
      supplierId,
      supplierName: rows[0]?.supplierName ?? supplierId,
      receipts: rows.length,
      quantityShare: totalQty > 0 ? qty / totalQty : 0,
      thinRecord: rows.length < MIN_RECORD,
      lastReceiptDate,
      servedLatestOrder: lastReceiptDate !== undefined && lastReceiptDate === latestReceipt,
      medianLeadTimeDays: percentile(days, 0.5),
      p80LeadTimeDays: p80,
      spreadDays:
        rows.length >= MIN_RECORD ? (percentile(days, 0.9) - percentile(days, 0.1)) / 2 : undefined,
      onTimePct: promised.length > 0 ? promised.filter(onTime).length / promised.length : undefined,
      inFullPct: received.length > 0 ? received.filter(inFull).length / received.length : undefined,
      otifPct:
        both.length > 0 ? both.filter((r) => onTime(r) && inFull(r)).length / both.length : undefined,
      onTimeSample: promised.length,
      inFullSample: received.length,
      otifSample: both.length,
      otifReason:
        both.length > 0
          ? undefined
          : !anyPromised
            ? NO_PROMISED_DATES
            : !anyReceived
              ? NO_RECEIVED_QTY
              : "None of this supplier's receipts carry both a promised date and a received quantity.",
      orderByDate,
      weeksToOrderBy: orderByDate ? weeksBetween(now, orderByDate) : undefined,
      landsInTime: orderByDate ? daysBetween(today, orderByDate) >= 0 : undefined,
    };
  });

  suppliers.sort(byAwardOrder);
  const recommended = recommend(suppliers);

  return {
    suppliers,
    recommended,
    productionStart,
    onTimeUnavailable: anyPromised ? undefined : NO_PROMISED_DATES,
    inFullUnavailable: anyReceived ? undefined : NO_RECEIVED_QTY,
  };
}

/**
 * Lands in time first — a better record is no use after the build has
 * started. Among those that land, a stronger record before a weaker one
 * (adequate, limited, anecdotal), then OTIF, then the shorter P80. When none
 * lands, the closest is the useful one, so P80 decides.
 */
function byAwardOrder(a: SupplierPerformance, b: SupplierPerformance): number {
  const landsA = a.landsInTime !== false;
  const landsB = b.landsInTime !== false;
  if (landsA !== landsB) return landsA ? -1 : 1;
  if (landsA) {
    const tier = recordTier(b.receipts) - recordTier(a.receipts);
    if (tier !== 0) return tier;
    const otif = (b.otifPct ?? -1) - (a.otifPct ?? -1);
    if (otif !== 0) return otif;
  }
  return (
    a.p80LeadTimeDays - b.p80LeadTimeDays ||
    b.quantityShare - a.quantityShare ||
    a.supplierName.localeCompare(b.supplierName)
  );
}

function recommend(ranked: readonly SupplierPerformance[]): SupplierComparison["recommended"] {
  const [top, runner] = ranked;
  if (!top) return undefined;
  const pick = { supplierId: top.supplierId, supplierName: top.supplierName };
  const thin =
    recordTier(top.receipts) < 2 ? ` — on only ${top.receipts} receipt${top.receipts === 1 ? "" : "s"}` : "";

  if (!runner) {
    return {
      ...pick,
      reason:
        top.landsInTime === false
          ? "The only supplier of record, and it does not land before production on its P80."
          : `The only supplier of record${thin}.`,
    };
  }
  if (top.landsInTime === false) {
    return { ...pick, reason: "None lands before production on its P80; this one is the closest." };
  }
  if (top.landsInTime === true && runner.landsInTime === false) {
    return { ...pick, reason: `The only one that lands before production on its P80${thin}.` };
  }
  if (top.otifPct !== undefined && (runner.otifPct === undefined || top.otifPct > runner.otifPct)) {
    return { ...pick, reason: `Best on-time-in-full record (${Math.round(top.otifPct * 100)}%)${thin}.` };
  }
  return { ...pick, reason: `Shortest P80 lead time (${Math.round(top.p80LeadTimeDays)} days)${thin}.` };
}

/** Linear-interpolated percentile of an unsorted sample. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const low = sorted[lower] ?? 0;
  if (lower === upper) return low;
  const high = sorted[upper] ?? low;
  return low + (high - low) * (index - lower);
}
