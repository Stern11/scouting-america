/**
 * Store coverage, stockout risk, and the plan that resolves it.
 *
 * Network inventory can look healthy while individual stores run dry: legacy
 * stock sits where it no longer sells, and the stores that switched first
 * have nothing behind them. This is where that shows.
 *
 *   store usable    = legacy × substitutability + successor (+ store inbound)
 *   store demand    = network weekly demand × the store's share of recent
 *                     lineage sales — so store demand always sums back to
 *                     the network figure
 *   weeks of cover  = usable ÷ weekly demand
 *   stockout date   = planning date + weeks of cover
 *   at risk         = runs out before the next successor shipment can reach
 *                     it (next receipt + DC→store transit)
 *
 * The plan, in the order a planner would want it:
 *   1. Transfer from stores with excess cover — sell what already exists.
 *   2. Replenish from available DC stock.
 *   3. What is left needs the inbound expedited.
 */

import type { StoreRow } from "@/types/dataset";
import type {
  CoverageThresholds,
  StoreCoverage,
  StoreCoverageRow,
  StoreRecommendation,
  StoreStockState,
  TransferRecommendation,
} from "@/types/transition";
import { addDaysTo } from "./time";

export function calculateWeeksOfCover(usableUnits: number, weeklyDemand: number): number | null {
  if (!(weeklyDemand > 0)) return null;
  return Math.max(0, usableUnits) / weeklyDemand;
}

export function calculateProjectedStockout(planningNow: string, weeksOfCover: number | null): string | null {
  if (weeksOfCover === null) return null;
  return addDaysTo(planningNow, Math.floor(weeksOfCover * 7));
}

export interface StorePositionInput {
  store: StoreRow;
  legacyUnits: number;
  successorUnits: number;
  /** Successor units arriving at the store inside the horizon. */
  storeInbound: number;
  /** Lineage units sold here over the recent window. */
  recentUnits: number;
  /** Legacy units sold here over the recent window. */
  recentLegacyUnits: number;
  onSuccessorProfile: boolean | null;
}

export interface StoreCoverageInput {
  stores: readonly StorePositionInput[];
  planningNow: string;
  networkWeeklyDemand: number;
  recentWeeks: number;
  substitutabilityPct: number;
  legacyBlocked: boolean;
  /** Weeks until the next successor receipt lands at the DC; null if none is on order. */
  nextReceiptWeeks: number | null;
  /** Vendor lead time — how soon new stock could land if nothing is on order. */
  leadTimeWeeks: number | null;
  horizonWeeks: number;
  /** DC stock free to send to stores, in usable units. */
  dcAvailableUsable: number;
  sellThroughWeeks: number;
  demandAdjustmentPct: number;
  thresholds: CoverageThresholds;
  /** SKU ids used to label transfers. */
  legacySkuId?: string;
  successorSkuId?: string;
}

/** A store's position while the plan is being built. Mutated as stock moves. */
export interface StoreWorkingPosition {
  row: StoreCoverageRow;
  legacy: number;
  successor: number;
  usable: number;
}

export function calculateStoreCoverage(input: StoreCoverageInput): StoreCoverage {
  const { thresholds: t } = input;
  const subst = input.legacyBlocked ? 0 : Math.min(1, Math.max(0, input.substitutabilityPct));
  const totalRecent = input.stores.reduce((n, s) => n + s.recentUnits, 0);

  // Stock reaches a store one transit after it reaches the DC. With nothing
  // on order, the soonest new stock could arrive is one vendor lead time away.
  const resupplyWeeks =
    input.nextReceiptWeeks !== null
      ? input.nextReceiptWeeks + t.dcToStoreWeeks
      : input.leadTimeWeeks !== null
        ? input.leadTimeWeeks + t.dcToStoreWeeks
        : null;
  const riskWindow = resupplyWeeks ?? input.horizonWeeks;

  const working: StoreWorkingPosition[] = input.stores.map((s) => {
    const share = totalRecent > 0 ? s.recentUnits / totalRecent : 0;
    const weeklyDemand = input.networkWeeklyDemand * share;
    const usable = s.legacyUnits * subst + s.successorUnits + s.storeInbound;
    const woc = calculateWeeksOfCover(usable, weeklyDemand);
    const atRisk = woc !== null && woc < riskWindow;
    const legacyWeeklySales = (s.recentLegacyUnits / Math.max(1, input.recentWeeks)) * (1 + input.demandAdjustmentPct);
    const stranded = Math.max(0, Math.round(s.legacyUnits - legacyWeeklySales * input.sellThroughWeeks));
    const row: StoreCoverageRow = {
      store: s.store,
      legacyUnits: s.legacyUnits,
      successorUnits: s.successorUnits + s.storeInbound,
      usableUnits: Math.floor(usable),
      weeklyDemand,
      weeksOfCover: woc,
      stockoutDate: calculateProjectedStockout(input.planningNow, woc),
      legacyWeeklySales,
      stockState: stockState(s.legacyUnits, s.successorUnits + s.storeInbound),
      onSuccessorProfile: s.onSuccessorProfile,
      atRisk,
      stockoutDays: atRisk && woc !== null ? Math.max(1, Math.round((riskWindow - woc) * 7)) : 0,
      atRiskAfterPlan: atRisk,
      transferIn: 0,
      transferOut: 0,
      replenishFromDc: 0,
      weeksOfCoverAfterPlan: woc,
      recommendation: "OK",
      strandedLegacyUnits: s.legacyUnits > 0 ? stranded : 0,
    };
    return { row, legacy: s.legacyUnits, successor: s.successorUnits + s.storeInbound, usable };
  });

  // A recipient is brought up to whichever is longer: target cover, or the
  // time until the next shipment — capped at the excess line so a transfer
  // never manufactures a new overstock.
  const recipientTarget = Math.min(Math.max(t.targetWeeks, riskWindow), t.excessWeeks);

  const transfers = generateTransferRecommendations(working, {
    thresholds: t,
    substitutabilityPct: subst,
    recipientTargetWeeks: recipientTarget,
    riskWindowWeeks: riskWindow,
    legacySkuId: input.legacySkuId,
    successorSkuId: input.successorSkuId,
  });

  // DC replenishment for whatever transfers did not cover, most urgent first.
  let dcLeft = Math.max(0, Math.floor(input.dcAvailableUsable));
  const stillShort = working
    .filter((w) => w.row.weeklyDemand > 0 && w.usable / w.row.weeklyDemand < riskWindow)
    .sort((a, b) => a.usable / a.row.weeklyDemand - b.usable / b.row.weeklyDemand);
  for (const w of stillShort) {
    if (dcLeft <= 0) break;
    const need = Math.ceil(recipientTarget * w.row.weeklyDemand - w.usable);
    const units = Math.min(need, dcLeft);
    if (units <= 0) continue;
    w.row.replenishFromDc = units;
    w.successor += units;
    w.usable += units;
    dcLeft -= units;
  }

  for (const w of working) {
    const after = calculateWeeksOfCover(w.usable, w.row.weeklyDemand);
    w.row.weeksOfCoverAfterPlan = after;
    w.row.atRiskAfterPlan = after !== null && after < riskWindow - 1e-9;
    w.row.recommendation = recommend(w.row, t);
  }

  const rows = working.map((w) => w.row).sort(byUrgency);
  const stateCounts: Record<StoreStockState, number> = { LEGACY_ONLY: 0, MIXED: 0, NEW_ONLY: 0, NO_STOCK: 0 };
  for (const r of rows) stateCounts[r.stockState] += 1;
  const atRiskRows = rows.filter((r) => r.atRisk);
  const earliest = atRiskRows
    .map((r) => r.stockoutDate)
    .filter((d): d is string => d !== null)
    .sort()[0];

  return {
    available: true,
    rows,
    storeCount: rows.length,
    stateCounts,
    atRiskCount: atRiskRows.length,
    atRiskAfterPlanCount: rows.filter((r) => r.atRiskAfterPlan).length,
    excessCount: rows.filter((r) => r.weeksOfCover !== null && r.weeksOfCover > t.excessWeeks).length,
    resupplyWeeks,
    transfers,
    transferUnits: transfers.reduce((n, x) => n + x.units, 0),
    replenishFromDcUnits: rows.reduce((n, r) => n + r.replenishFromDc, 0),
    replenishFromDcStores: rows.filter((r) => r.replenishFromDc > 0).length,
    earliestStockout: earliest ?? null,
    atRiskOffProfile: atRiskRows.filter((r) => r.onSuccessorProfile === false).length,
  };
}

function stockState(legacy: number, successor: number): StoreStockState {
  if (legacy > 0 && successor > 0) return "MIXED";
  if (legacy > 0) return "LEGACY_ONLY";
  if (successor > 0) return "NEW_ONLY";
  return "NO_STOCK";
}

function recommend(row: StoreCoverageRow, t: CoverageThresholds): StoreRecommendation {
  if (row.atRiskAfterPlan) return "EXPEDITE";
  if (row.transferIn > 0) return "TRANSFER_IN";
  if (row.replenishFromDc > 0) return "REPLENISH";
  if (row.transferOut > 0) return "TRANSFER_OUT";
  if (row.weeksOfCover !== null && row.weeksOfCover > t.excessWeeks) return "HOLD";
  return "OK";
}

/** At-risk first (soonest stockout first), then lowest cover, then name. */
function byUrgency(a: StoreCoverageRow, b: StoreCoverageRow): number {
  if (a.atRisk !== b.atRisk) return a.atRisk ? -1 : 1;
  const ca = a.weeksOfCover ?? Number.POSITIVE_INFINITY;
  const cb = b.weeksOfCover ?? Number.POSITIVE_INFINITY;
  if (ca !== cb) return ca - cb;
  return a.store.storeName.localeCompare(b.store.storeName);
}

/* ------------------------------------------------------------------ */
/* Transfers                                                           */
/* ------------------------------------------------------------------ */

export interface TransferOptions {
  thresholds: CoverageThresholds;
  substitutabilityPct: number;
  /** Weeks a recipient is brought up to. */
  recipientTargetWeeks: number;
  /** A store below this many weeks is a recipient. */
  riskWindowWeeks: number;
  legacySkuId?: string;
  successorSkuId?: string;
}

/**
 * Move stock from stores that will not sell it in time to stores that will
 * run out — before buying more.
 *
 * Deterministic heuristic:
 *   1. Recipients: stores running out before resupply, most urgent first.
 *   2. Donors: stores above the excess line, most excess first, same region
 *      preferred — "nearby" without a distance table.
 *   3. A donor is never taken below its floor; a recipient never receives
 *      more than it needs to reach its target.
 *   4. Legacy units move first: they are the stock the transition strands.
 *
 * Mutates the working positions passed in so later steps see the result.
 */
export function generateTransferRecommendations(
  working: StoreWorkingPosition[],
  options: TransferOptions
): TransferRecommendation[] {
  const { thresholds: t, substitutabilityPct: subst } = options;
  const cover = (w: StoreWorkingPosition) => (w.row.weeklyDemand > 0 ? w.usable / w.row.weeklyDemand : Number.POSITIVE_INFINITY);

  const recipients = working
    .filter((w) => w.row.weeklyDemand > 0 && cover(w) < options.riskWindowWeeks)
    .sort((a, b) => cover(a) - cover(b));

  // A store with stock and no demand at all is the purest donor there is.
  const isDonor = (w: StoreWorkingPosition) => w.usable > 0 && cover(w) > t.excessWeeks;
  const transfers: TransferRecommendation[] = [];
  let seq = 0;

  for (const recipient of recipients) {
    const donors = working
      .filter((d) => d !== recipient && isDonor(d))
      .sort((a, b) => {
        const sameA = a.row.store.region === recipient.row.store.region ? 0 : 1;
        const sameB = b.row.store.region === recipient.row.store.region ? 0 : 1;
        if (sameA !== sameB) return sameA - sameB;
        return donorSurplus(b, t) - donorSurplus(a, t);
      });

    let usedDonors = 0;
    for (const donor of donors) {
      if (usedDonors >= 2) break;
      const need = options.recipientTargetWeeks * recipient.row.weeklyDemand - recipient.usable;
      if (need < t.minTransferUnits) break;
      const surplus = donorSurplus(donor, t);
      if (surplus < t.minTransferUnits) continue;

      // Legacy first, if it can stand in for the successor at all.
      const moveLegacy = donor.legacy > 0 && subst > 0;
      const perUnit = moveLegacy ? subst : 1;
      const physicalAvailable = moveLegacy ? donor.legacy : donor.successor;
      const units = Math.min(
        physicalAvailable,
        Math.floor(surplus / perUnit),
        Math.ceil(need / perUnit)
      );
      if (units < t.minTransferUnits) continue;

      const fromBefore = cover(donor);
      const toBefore = cover(recipient);
      const toBeforeUsable = recipient.usable;
      if (moveLegacy) {
        donor.legacy -= units;
        recipient.legacy += units;
      } else {
        donor.successor -= units;
        recipient.successor += units;
      }
      donor.usable -= units * perUnit;
      recipient.usable += units * perUnit;
      donor.row.transferOut += units;
      recipient.row.transferIn += units;
      usedDonors += 1;

      const toAfter = cover(recipient);
      const bridged = Math.min(options.riskWindowWeeks, toAfter) - (toBeforeUsable / recipient.row.weeklyDemand);
      seq += 1;
      transfers.push({
        id: `xfer-${seq}`,
        skuId: (moveLegacy ? options.legacySkuId : options.successorSkuId) ?? "",
        skuRole: moveLegacy ? "legacy" : "successor",
        fromStoreId: donor.row.store.storeId,
        toStoreId: recipient.row.store.storeId,
        units,
        fromCoverBefore: finite(fromBefore),
        fromCoverAfter: finite(cover(donor)),
        toCoverBefore: finite(toBefore),
        toCoverAfter: finite(toAfter),
        avoidedStockoutDays: Math.max(0, Math.round(bridged * 7)),
        sameRegion: donor.row.store.region === recipient.row.store.region,
      });
    }
  }
  return transfers;
}

/** Usable units a donor can give without dropping below its floor. */
function donorSurplus(w: StoreWorkingPosition, t: CoverageThresholds): number {
  return Math.max(0, w.usable - t.donorFloorWeeks * w.row.weeklyDemand);
}

/** Weeks for display: a store with no demand shows its cover as very large, not infinite. */
function finite(weeks: number): number {
  return Number.isFinite(weeks) ? weeks : 99;
}
