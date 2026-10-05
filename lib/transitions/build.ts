/**
 * Assembles transitions: dataset (+ planner overrides) (+ one scenario) →
 * `TransitionView[]`.
 *
 * Pure. No React, no storage, no clock — `planningNow` comes from the dataset.
 * Every number on every page is read off a view built here, which is what
 * keeps the Overview, the transition workspace, the simulator and the action
 * queue from disagreeing with one another.
 */

import type { InboundRow, InventoryRow, PlanningDataset, SkuRow, StoreRow, TransitionRow } from "@/types/dataset";
import type {
  CoverageThresholds,
  LegacySellThrough,
  ScenarioAdjustments,
  StoreCoverage,
  TransitionOverrides,
  TransitionView,
} from "@/types/transition";
import {
  DEFAULT_HORIZON_WEEKS,
  DEFAULT_THRESHOLDS,
  RECENT_WEEKS,
  REVIEW_CYCLE_WEEKS,
  resolveAssumptions,
} from "./assumptions";
import { calculateContinuityDemand } from "./demand";
import { calculateNetworkInventory, latestPositions } from "./inventory";
import { calculateStoreCoverage, type StorePositionInput } from "./coverage";
import { calculateReplenishmentRequirement } from "./replenishment";
import { buildLineage, collectTransitions, effectiveRelationship } from "./lineage";
import { deriveHeadline, deriveRiskKind, deriveStatus, generateTransitionActions } from "./actions";
import { salesIndexFor, type SalesIndex } from "./sales";
import { addDaysTo, weeksFrom } from "./time";

export interface BuildOptions {
  overridesByTransition?: Readonly<Record<string, TransitionOverrides>>;
  /** Scenario levers for one transition. Never touches the others. */
  scenario?: { transitionId: string; adjustments: ScenarioAdjustments };
  thresholds?: CoverageThresholds;
}

/** Everything about a dataset that every transition reads — built once. */
interface DatasetContext {
  dataset: PlanningDataset;
  now: string;
  skuById: Map<string, SkuRow>;
  storeById: Map<string, StoreRow>;
  sales: SalesIndex;
  positionsBySku: Map<string, InventoryRow[]>;
  inboundBySku: Map<string, InboundRow[]>;
  profileStoresBySku: Map<string, Set<string>>;
}

const contextCache = new WeakMap<PlanningDataset, DatasetContext>();

function contextFor(dataset: PlanningDataset): DatasetContext {
  const cached = contextCache.get(dataset);
  if (cached) return cached;
  const positionsBySku = new Map<string, InventoryRow[]>();
  for (const row of latestPositions(dataset.inventory)) {
    const list = positionsBySku.get(row.skuId);
    if (list) list.push(row);
    else positionsBySku.set(row.skuId, [row]);
  }
  const inboundBySku = new Map<string, InboundRow[]>();
  for (const row of dataset.inbound) {
    const list = inboundBySku.get(row.skuId);
    if (list) list.push(row);
    else inboundBySku.set(row.skuId, [row]);
  }
  const profileStoresBySku = new Map<string, Set<string>>();
  for (const profile of dataset.sellingProfiles) {
    for (const sku of profile.skuIds) {
      const set = profileStoresBySku.get(sku) ?? new Set<string>();
      for (const store of profile.storeIds) set.add(store);
      profileStoresBySku.set(sku, set);
    }
  }
  const ctx: DatasetContext = {
    dataset,
    now: dataset.metadata.planningNow.slice(0, 10),
    skuById: new Map(dataset.skus.map((s) => [s.skuId, s])),
    storeById: new Map(dataset.stores.map((s) => [s.storeId, s])),
    sales: salesIndexFor(dataset),
    positionsBySku,
    inboundBySku,
    profileStoresBySku,
  };
  contextCache.set(dataset, ctx);
  return ctx;
}

export function buildTransitions(dataset: PlanningDataset, options: BuildOptions = {}): TransitionView[] {
  const ctx = contextFor(dataset);
  return collectTransitions(dataset).map((row) =>
    buildOne(
      ctx,
      row,
      options.overridesByTransition?.[row.transitionId],
      options.scenario?.transitionId === row.transitionId ? options.scenario.adjustments : undefined,
      options.thresholds ?? DEFAULT_THRESHOLDS
    )
  );
}

/** One transition — what the simulator rebuilds on every lever move. */
export function buildTransition(
  dataset: PlanningDataset,
  transitionId: string,
  options: BuildOptions = {}
): TransitionView | undefined {
  const ctx = contextFor(dataset);
  const row = collectTransitions(dataset).find((t) => t.transitionId === transitionId);
  if (!row) return undefined;
  return buildOne(
    ctx,
    row,
    options.overridesByTransition?.[transitionId],
    options.scenario?.transitionId === transitionId ? options.scenario.adjustments : undefined,
    options.thresholds ?? DEFAULT_THRESHOLDS
  );
}

function buildOne(
  ctx: DatasetContext,
  sourceRow: TransitionRow,
  overrides: TransitionOverrides | undefined,
  scenario: ScenarioAdjustments | undefined,
  thresholds: CoverageThresholds
): TransitionView {
  const { now, dataset } = ctx;
  const relationship = effectiveRelationship(sourceRow, overrides);

  // A partial replacement carries less demand and less interchangeable stock
  // than a like-for-like one — unless the planner has said exactly how much.
  const row: TransitionRow =
    overrides?.relationshipDecision === "PARTIAL_REPLACEMENT"
      ? {
          ...sourceRow,
          transitionType: relationship.transitionType,
          substitutabilityPct: Math.min(sourceRow.substitutabilityPct ?? 0.6, 0.6),
          transferredDemandPct: Math.min(sourceRow.transferredDemandPct ?? 0.7, 0.7),
        }
      : { ...sourceRow, transitionType: relationship.transitionType };

  const assumptions = resolveAssumptions(row, now, overrides, scenario);
  const lineage = buildLineage(sourceRow, relationship, ctx.skuById, overrides);
  const pred = relationship.predecessorSkuIds;
  const succ = relationship.successorSkuIds;

  // Horizon: vendor lead time plus one review cycle — an order placed now
  // has to carry the business until the next one can land.
  const leadDays = Math.max(
    0,
    ...(succ.length > 0 ? succ : pred).map((id) => ctx.skuById.get(id)?.leadTimeDays ?? 0)
  );
  const leadTimeWeeks = leadDays > 0 ? Math.ceil(leadDays / 7) : null;
  const horizonWeeks = leadTimeWeeks !== null ? leadTimeWeeks + REVIEW_CYCLE_WEEKS : DEFAULT_HORIZON_WEEKS;

  const demand = calculateContinuityDemand({
    predecessorSkuIds: pred,
    successorSkuIds: succ,
    sales: ctx.sales,
    planningNow: now,
    horizonWeeks,
    transferredDemandPct: assumptions.transferredDemandPct,
    demandAdjustmentPct: assumptions.demandAdjustmentPct,
    demandOverrideUnits: assumptions.demandOverrideUnits,
    successorSplit: row.successorSplit,
  });

  const lineageIds = [...pred, ...succ];
  const positions = lineageIds.flatMap((id) => ctx.positionsBySku.get(id) ?? []);
  const inbound = lineageIds.flatMap((id) => ctx.inboundBySku.get(id) ?? []);

  const inventory = calculateNetworkInventory({
    predecessorSkuIds: pred,
    successorSkuIds: succ,
    positions,
    inbound,
    skuById: ctx.skuById,
    planningNow: now,
    horizonWeeks,
    substitutabilityPct: assumptions.substitutabilityPct,
    inboundDelayWeeks: assumptions.inboundDelayWeeks,
    weeklyDemand: demand.weeklyUnits,
  });

  const coverage = storeCoverage(ctx, pred, succ, positions, inventory, demand.weeklyUnits, horizonWeeks, leadTimeWeeks, assumptions, thresholds);

  const successorCost = succ.map((id) => ctx.skuById.get(id)?.unitCost).find((c) => c !== undefined);
  const replenishment = calculateReplenishmentRequirement({
    available: demand.available && succ.length > 0,
    planningNow: now,
    horizonWeeks,
    leadTimeWeeks,
    horizonDemand: demand.horizonUnits,
    weeklyDemand: demand.weeklyUnits,
    safetyStockWeeks: assumptions.safetyStockWeeks,
    usableLegacy: inventory.usableLegacy,
    successorOnHand: inventory.successorOnHand,
    eligibleInbound: inventory.eligibleInbound,
    receipts: inventory.receipts.map((r) => ({
      weeksAway: r.weeksAway,
      eligible: r.eligible,
      usableUnits: succ.includes(r.skuId)
        ? r.quantity
        : inventory.legacyBlocked
          ? 0
          : Math.floor(r.quantity * assumptions.substitutabilityPct),
    })),
    orderOverrideUnits: assumptions.orderOverrideUnits,
    noSuccessor: succ.length === 0,
    jda: jdaView(dataset, succ),
    unitCost: successorCost,
  });

  const sellThrough = legacySellThrough(ctx, pred, inventory.legacyOnHand, inventory.dc.legacy, coverage, assumptions, now);

  const progress = transitionProgress(ctx, relationship.transitionType, pred, demand.transitionProgress, inventory.legacyOnHand, row.startDate, now);
  const closed = Boolean(sourceRow.closed || overrides?.closed);
  const name = sourceRow.transitionName;

  const actions = generateTransitionActions({
    transitionId: sourceRow.transitionId,
    transitionName: name,
    planningNow: now,
    currency: dataset.metadata.currency,
    lineage,
    demand,
    inventory,
    coverage,
    replenishment,
    sellThrough,
    assumptions,
    thresholds,
    progress,
    closed,
    storeById: ctx.storeById,
  });

  const status = deriveStatus({
    actions,
    progress,
    legacyOnHand: inventory.legacyOnHand,
    closed,
    hasPredecessor: pred.length > 0,
  });
  const riskKind = status === "COMPLETE" ? "NONE" : deriveRiskKind(actions);
  const anySku = ctx.skuById.get(succ[0] ?? pred[0] ?? "");

  return {
    id: sourceRow.transitionId,
    name,
    category: anySku?.category ?? "Uncategorised",
    program: anySku?.program,
    startDate: row.startDate,
    targetCompletionDate: row.targetCompletionDate,
    planningNow: now,
    currency: dataset.metadata.currency,
    assumptions,
    lineage,
    demand,
    inventory,
    coverage,
    replenishment,
    sellThrough,
    actions,
    status,
    riskKind,
    headline:
      status === "COMPLETE"
        ? "Legacy stock is gone; every sale is on the successor."
        : deriveHeadline({ name, riskKind, lineage, demand, inventory, coverage, replenishment, sellThrough, progress }),
    nextStep: actions.find((a) => a.priority !== "MONITOR")?.title ?? (status === "COMPLETE" ? "Nothing to do" : "Keep monitoring"),
    progress,
    closed,
  };
}

/* ------------------------------------------------------------------ */

function storeCoverage(
  ctx: DatasetContext,
  pred: readonly string[],
  succ: readonly string[],
  positions: readonly InventoryRow[],
  inventory: ReturnType<typeof calculateNetworkInventory>,
  weeklyDemand: number,
  horizonWeeks: number,
  leadTimeWeeks: number | null,
  assumptions: ReturnType<typeof resolveAssumptions>,
  thresholds: CoverageThresholds
): StoreCoverage {
  const lineageIds = [...pred, ...succ];
  const caps = ctx.dataset.metadata.capabilities;
  const hasStoreSales = lineageIds.some((id) => ctx.sales.hasStoreRows(id));
  const hasStoreStock = positions.some((p) => p.locationType === "STORE");
  if (!caps.storeLevelDemand || !hasStoreSales) {
    return unavailableCoverage("Add store-level sales to see where stock will run out.");
  }
  if (!caps.storeInventory || !hasStoreStock) {
    return unavailableCoverage("Add store inventory to see coverage by store.");
  }

  const legacy = new Set(pred);
  const successor = new Set(succ);
  const storeIds = new Set<string>();
  for (const p of positions) if (p.locationType === "STORE") storeIds.add(p.locationId);
  for (const id of lineageIds) for (const s of ctx.sales.storesFor(id)) storeIds.add(s);

  const profileStores = new Set<string>();
  for (const id of succ) for (const s of ctx.profileStoresBySku.get(id) ?? []) profileStores.add(s);
  const hasProfiles = ctx.dataset.metadata.capabilities.sellingProfiles && profileStores.size > 0;

  const recentFrom = addDaysTo(ctx.now, -RECENT_WEEKS * 7);
  const horizonEnd = addDaysTo(ctx.now, horizonWeeks * 7);
  const byStore = new Map<string, { legacy: number; successor: number; inbound: number }>();
  for (const p of positions) {
    if (p.locationType !== "STORE") continue;
    const entry = byStore.get(p.locationId) ?? { legacy: 0, successor: 0, inbound: 0 };
    if (legacy.has(p.skuId)) entry.legacy += p.available;
    else if (successor.has(p.skuId)) entry.successor += p.available;
    byStore.set(p.locationId, entry);
  }
  for (const id of succ) {
    for (const r of ctx.inboundBySku.get(id) ?? []) {
      if (r.locationType !== "STORE" || r.expectedReceiptDate.slice(0, 10) >= horizonEnd) continue;
      const entry = byStore.get(r.locationId) ?? { legacy: 0, successor: 0, inbound: 0 };
      entry.inbound += r.quantity;
      byStore.set(r.locationId, entry);
    }
  }

  const inputs: StorePositionInput[] = [];
  for (const storeId of [...storeIds].sort()) {
    const store = ctx.storeById.get(storeId) ?? { storeId, storeName: storeId };
    const stock = byStore.get(storeId) ?? { legacy: 0, successor: 0, inbound: 0 };
    let recentLegacy = 0;
    let recentSuccessor = 0;
    for (const id of pred) recentLegacy += ctx.sales.storeUnits(id, storeId, recentFrom, ctx.now);
    for (const id of succ) recentSuccessor += ctx.sales.storeUnits(id, storeId, recentFrom, ctx.now);
    inputs.push({
      store,
      legacyUnits: stock.legacy,
      successorUnits: stock.successor,
      storeInbound: stock.inbound,
      recentUnits: recentLegacy * assumptions.transferredDemandPct + recentSuccessor,
      recentLegacyUnits: recentLegacy,
      onSuccessorProfile: hasProfiles ? profileStores.has(storeId) : null,
    });
  }

  const nextReceipt = inventory.receipts.find((r) => successor.has(r.skuId) && r.quantity > 0);
  const subst = inventory.legacyBlocked ? 0 : assumptions.substitutabilityPct;
  return calculateStoreCoverage({
    stores: inputs,
    planningNow: ctx.now,
    networkWeeklyDemand: weeklyDemand,
    recentWeeks: RECENT_WEEKS,
    substitutabilityPct: assumptions.substitutabilityPct,
    legacyBlocked: inventory.legacyBlocked,
    nextReceiptWeeks: nextReceipt ? nextReceipt.weeksAway : null,
    leadTimeWeeks,
    horizonWeeks,
    dcAvailableUsable: inventory.dc.successor + Math.floor(inventory.dc.legacy * subst),
    sellThroughWeeks: assumptions.sellThroughWeeks,
    demandAdjustmentPct: assumptions.demandAdjustmentPct,
    thresholds,
    legacySkuId: pred[0],
    successorSkuId: succ[0],
  });
}

function unavailableCoverage(reason: string): StoreCoverage {
  return {
    available: false,
    unavailableReason: reason,
    rows: [],
    storeCount: 0,
    stateCounts: { LEGACY_ONLY: 0, MIXED: 0, NEW_ONLY: 0, NO_STOCK: 0 },
    atRiskCount: 0,
    atRiskAfterPlanCount: 0,
    excessCount: 0,
    resupplyWeeks: null,
    transfers: [],
    transferUnits: 0,
    replenishFromDcUnits: 0,
    replenishFromDcStores: 0,
    earliestStockout: null,
    atRiskOffProfile: 0,
  };
}

function legacySellThrough(
  ctx: DatasetContext,
  pred: readonly string[],
  legacyOnHand: number,
  legacyAtDc: number,
  coverage: StoreCoverage,
  assumptions: ReturnType<typeof resolveAssumptions>,
  now: string
): LegacySellThrough {
  const from = addDaysTo(now, -RECENT_WEEKS * 7);
  const recent = pred.reduce((n, id) => n + ctx.sales.networkUnits(id, from, now), 0);
  const weekly = (recent / RECENT_WEEKS) * (1 + assumptions.demandAdjustmentPct);
  const window = assumptions.sellThroughWeeks;
  // Store by store when we can see stores: legacy sitting where it does not
  // sell is stranded even if the network rate looks healthy.
  const remaining = coverage.available
    ? coverage.rows.reduce((n, r) => n + r.strandedLegacyUnits, 0) + Math.max(0, Math.round(legacyAtDc - weekly * window))
    : Math.max(0, Math.round(legacyOnHand - weekly * window));
  const cost = pred.map((id) => ctx.skuById.get(id)?.unitCost).find((c) => c !== undefined);
  return {
    legacyUnits: legacyOnHand,
    legacyWeeklySales: weekly,
    sellThroughWeeks: window,
    remainingUnits: Math.min(legacyOnHand, remaining),
    remainingValue: cost === undefined ? undefined : Math.min(legacyOnHand, remaining) * cost,
    projectedSellThroughDate: legacyOnHand === 0 ? now : weekly > 0 ? addDaysTo(now, Math.ceil((legacyOnHand / weekly) * 7)) : null,
  };
}

/**
 * How far along a transition is. For a replacement: the successor's share of
 * recent lineage sales. For a discontinuation with no successor: how much of
 * the legacy stock at the start has sold.
 */
function transitionProgress(
  ctx: DatasetContext,
  type: TransitionRow["transitionType"],
  pred: readonly string[],
  salesMix: number,
  legacyOnHand: number,
  startDate: string | undefined,
  now: string
): number {
  if (type !== "NO_SUCCESSOR") return salesMix;
  const from = startDate && startDate < now ? startDate : addDaysTo(now, -RECENT_WEEKS * 7);
  const sold = pred.reduce((n, id) => n + ctx.sales.networkUnits(id, from, now), 0);
  return sold + legacyOnHand > 0 ? sold / (sold + legacyOnHand) : 1;
}

/** JDA's view of the successor, summed across successors, for the plan that covers today. */
function jdaView(dataset: PlanningDataset, succ: readonly string[]) {
  if (!dataset.metadata.capabilities.currentPlan || succ.length === 0) return undefined;
  const now = dataset.metadata.planningNow.slice(0, 10);
  const rows = dataset.currentPlan.filter(
    (r) => succ.includes(r.skuId) && r.horizonStart.slice(0, 10) <= now && r.horizonEnd.slice(0, 10) >= now
  );
  if (rows.length === 0) return undefined;
  const planned = rows.some((r) => r.plannedReplenishmentUnits !== undefined)
    ? rows.reduce((n, r) => n + (r.plannedReplenishmentUnits ?? 0), 0)
    : undefined;
  return {
    forecastUnits: rows.reduce((n, r) => n + r.forecastUnits, 0),
    plannedOrderUnits: planned,
    horizonStart: rows[0]!.horizonStart.slice(0, 10),
    horizonEnd: rows[0]!.horizonEnd.slice(0, 10),
  };
}

/** Weeks until a date, from the planning date. */
export function weeksUntil(view: Pick<TransitionView, "planningNow">, date: string): number {
  return weeksFrom(view.planningNow, date);
}
