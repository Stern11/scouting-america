/**
 * Network inventory across a lineage.
 *
 * JDA shows the legacy SKU and the successor as two unrelated balances. The
 * question here is different: how much of what exists can satisfy the *same*
 * demand. Legacy stock is not blindly added to successor stock — it is first
 * discounted by substitutability (a rebranded shirt is fully interchangeable;
 * a pack whose sizes no longer map is not), and a blocked SKU contributes
 * nothing at all.
 *
 *   usable legacy      = legacy available × substitutability
 *   effective supply   = usable legacy + successor available + eligible inbound
 *
 * "Available" is on hand less what is allocated to open orders. Inbound is
 * eligible when it lands inside the replenishment horizon; anything later is
 * shown but never counted against this horizon's demand.
 */

import type { InboundRow, InventoryRow, SkuRow } from "@/types/dataset";
import type { InboundReceipt, InventoryCell, NetworkInventory } from "@/types/transition";
import { addDaysTo, parseDay, weeksFrom } from "./time";

export function calculateUsableLegacyInventory(
  legacyUnits: number,
  substitutabilityPct: number,
  legacyBlocked = false
): number {
  if (legacyBlocked) return 0;
  return Math.floor(Math.max(0, legacyUnits) * Math.min(1, Math.max(0, substitutabilityPct)));
}

export function calculateEffectiveInventory(parts: {
  usableLegacy: number;
  successorOnHand: number;
  eligibleInbound: number;
}): number {
  return Math.max(0, parts.usableLegacy) + Math.max(0, parts.successorOnHand) + Math.max(0, parts.eligibleInbound);
}

/** The latest snapshot per SKU × location — an older one is history, not stock. */
export function latestPositions(rows: readonly InventoryRow[]): InventoryRow[] {
  const latest = new Map<string, InventoryRow>();
  for (const row of rows) {
    const key = `${row.skuId}|${row.locationId}`;
    const current = latest.get(key);
    if (!current || row.snapshotDate > current.snapshotDate) latest.set(key, row);
  }
  return [...latest.values()];
}

export interface NetworkInventoryInput {
  predecessorSkuIds: readonly string[];
  successorSkuIds: readonly string[];
  /** Latest positions for every SKU in the lineage. */
  positions: readonly InventoryRow[];
  inbound: readonly InboundRow[];
  skuById: ReadonlyMap<string, SkuRow>;
  planningNow: string;
  horizonWeeks: number;
  substitutabilityPct: number;
  inboundDelayWeeks: number;
  weeklyDemand: number;
}

const cell = (): InventoryCell => ({ legacy: 0, successor: 0 });

export function calculateNetworkInventory(input: NetworkInventoryInput): NetworkInventory {
  const legacy = new Set(input.predecessorSkuIds);
  const successor = new Set(input.successorSkuIds);
  const dc = cell();
  const stores = cell();
  const dcAllocated = cell();

  for (const row of input.positions) {
    const role = legacy.has(row.skuId) ? "legacy" : successor.has(row.skuId) ? "successor" : null;
    if (!role) continue;
    if (row.locationType === "DC") {
      dc[role] += row.available;
      dcAllocated[role] += row.allocated;
    } else {
      stores[role] += row.available;
    }
  }

  const legacyBlocked =
    input.predecessorSkuIds.length > 0 &&
    input.predecessorSkuIds.every((id) => input.skuById.get(id)?.status === "BLOCKED");

  const horizonEnd = addDaysTo(input.planningNow, input.horizonWeeks * 7);
  const receipts: InboundReceipt[] = [];
  const inbound = cell();
  let eligibleSuccessor = 0;
  let eligibleLegacy = 0;
  let laterInbound = 0;

  for (const row of input.inbound) {
    const role = legacy.has(row.skuId) ? "legacy" : successor.has(row.skuId) ? "successor" : null;
    if (!role || row.quantity <= 0) continue;
    // An overdue receipt is still expected — from today, not from the past.
    const from = parseDay(row.expectedReceiptDate) < parseDay(input.planningNow) ? input.planningNow : row.expectedReceiptDate;
    const expectedDate = addDaysTo(from, input.inboundDelayWeeks * 7);
    const eligible = parseDay(expectedDate) < parseDay(horizonEnd);
    inbound[role] += row.quantity;
    if (role === "successor") {
      if (eligible) eligibleSuccessor += row.quantity;
      else laterInbound += row.quantity;
    } else if (eligible) {
      eligibleLegacy += row.quantity;
    }
    receipts.push({
      id: row.id,
      skuId: row.skuId,
      quantity: row.quantity,
      plannedDate: row.expectedReceiptDate.slice(0, 10),
      expectedDate,
      weeksAway: Math.max(0, weeksFrom(input.planningNow, expectedDate)),
      eligible,
      purchaseOrderId: row.purchaseOrderId,
      source: row.source,
    });
  }
  receipts.sort((a, b) => a.expectedDate.localeCompare(b.expectedDate));

  const legacyOnHand = dc.legacy + stores.legacy;
  const successorOnHand = dc.successor + stores.successor;
  const usableLegacy = calculateUsableLegacyInventory(legacyOnHand, input.substitutabilityPct, legacyBlocked);
  const eligibleInbound =
    eligibleSuccessor + calculateUsableLegacyInventory(eligibleLegacy, input.substitutabilityPct, legacyBlocked);
  const effectiveSupply = calculateEffectiveInventory({ usableLegacy, successorOnHand, eligibleInbound });

  let onHandValue: number | undefined = 0;
  for (const row of input.positions) {
    if (!legacy.has(row.skuId) && !successor.has(row.skuId)) continue;
    const cost = input.skuById.get(row.skuId)?.unitCost;
    if (cost === undefined) {
      onHandValue = undefined;
      break;
    }
    onHandValue += row.onHand * cost;
  }

  return {
    dc,
    stores,
    inbound,
    dcAllocated,
    legacyOnHand,
    successorOnHand,
    substitutabilityPct: input.substitutabilityPct,
    legacyBlocked,
    usableLegacy,
    eligibleInbound,
    laterInbound,
    effectiveSupply,
    receipts,
    networkWeeksOfCover:
      input.weeklyDemand > 0 ? (usableLegacy + successorOnHand) / input.weeklyDemand : null,
    onHandValue,
  };
}
