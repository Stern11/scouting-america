/**
 * Planner actions, derived — never registered.
 *
 * Every action falls out of the numbers already on the transition: a store
 * that runs out before resupply produces a transfer or a replenishment; legacy
 * stock that covers the horizon produces a hold. Change an assumption and the
 * actions change with it.
 *
 * Priority is a small set of explainable rules, not a score:
 *   CRITICAL  stores run out within the shortage window, or the order-by
 *             date has passed
 *   HIGH      stores run out before resupply; an order is due within three
 *             weeks; material money is at stake
 *   MEDIUM    worth doing this cycle — confirmations, forecast corrections
 *   MONITOR   nothing to do yet
 * Each action carries its reasons and its arithmetic, so the planner never
 * has to take a priority on trust.
 */

import type { SkuRow, StoreRow } from "@/types/dataset";
import type {
  ActionPriority,
  CalculationLine,
  DemandContinuity,
  Lineage,
  LegacySellThrough,
  NetworkInventory,
  PlannerAction,
  Replenishment,
  StoreCoverage,
  TransitionAssumptions,
  TransitionRiskKind,
  TransitionStatus,
} from "@/types/transition";
import type { CoverageThresholds } from "@/types/transition";
import { fmtDateShort, fmtMoney, fmtNum, fmtNum1, fmtPct } from "@/lib/utils/format";
import { daysFrom, weeksFrom } from "./time";
import { productNoun, versionLabels } from "./names";
import { productName } from "./lineage";

export const PRIORITY_ORDER: Record<ActionPriority, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, MONITOR: 3 };

/** Money at stake above which a decision is HIGH rather than MEDIUM. */
const HIGH_VALUE = 10_000;
/** Units at stake used instead when costs are unknown. */
const HIGH_UNITS = 500;

export interface ActionInput {
  transitionId: string;
  transitionName: string;
  planningNow: string;
  currency: string;
  lineage: Lineage;
  demand: DemandContinuity;
  inventory: NetworkInventory;
  coverage: StoreCoverage;
  replenishment: Replenishment;
  sellThrough: LegacySellThrough;
  assumptions: TransitionAssumptions;
  thresholds: CoverageThresholds;
  progress: number;
  closed: boolean;
  storeById: ReadonlyMap<string, StoreRow>;
}

const units = (n: number) => `${fmtNum(Math.round(n))}`;
/** "1 unit", "420 units". */
const unitsOf = (n: number) => `${units(n)} unit${Math.round(n) === 1 ? "" : "s"}`;
const weeks = (n: number | null) => (n === null ? "—" : `${fmtNum1(n)} wks`);
const skuList = (skus: readonly SkuRow[]) => skus.map((s) => s.skuId).join(" + ") || "—";

export function generateTransitionActions(input: ActionInput): PlannerAction[] {
  if (input.closed) return [];
  const out: PlannerAction[] = [];
  const { lineage, coverage, replenishment: rep, inventory, demand, planningNow: now } = input;
  const legacyIds = skuList(lineage.predecessors);
  const successorIds = skuList(lineage.successors);
  const successor = lineage.successors[0];
  const successorCost = successor?.unitCost;
  const legacyCost = lineage.predecessors[0]?.unitCost;
  const value = (n: number, cost: number | undefined) => (cost === undefined ? undefined : n * cost);
  const isHighStakes = (n: number, cost: number | undefined) =>
    cost === undefined ? n >= HIGH_UNITS : n * cost >= HIGH_VALUE;
  const base = { transitionId: input.transitionId, transitionName: input.transitionName };
  // Plain words for the product: "shirts", "old-logo shirts", "new shirts".
  const labels = versionLabels(lineage.reason, lineage.successors, lineage.predecessors);
  const noun = (n: number) => productNoun(input.transitionName, Math.round(n));
  const count = (n: number, adjective?: string) => `${units(n)} ${adjective ? `${adjective} ` : ""}${noun(n)}`;

  const nextReceipt = inventory.receipts.find((r) => lineage.successors.some((s) => s.skuId === r.skuId));
  const earliestWeeks = coverage.earliestStockout ? weeksFrom(now, coverage.earliestStockout) : null;
  const imminent = earliestWeeks !== null && earliestWeeks <= input.thresholds.shortageWeeks;

  /* ---- Confirm the relationship ----------------------------------- */
  if (!lineage.confirmed && lineage.type !== "NO_SUCCESSOR" && lineage.type !== "NEW_PRODUCT") {
    const blocking = coverage.atRiskCount > 0 || rep.finalOrderUnits > 0;
    const priority: ActionPriority = lineage.confidence === "HIGH" && !blocking ? "MEDIUM" : "HIGH";
    out.push({
      ...base,
      id: `${input.transitionId}:confirm`,
      type: "CONFIRM_SUCCESSOR",
      priority,
      title: `Confirm the replacement ${productNoun(input.transitionName, 1)}`,
      summary: `${legacyIds} → ${successorIds} · confidence ${lineage.confidence.toLowerCase()} · ${lineage.matchedCount} matching, ${lineage.changedCount} changed`,
      reasons: [
        lineage.source === "SUGGESTED"
          ? "JDA records no replacement for the legacy SKU; Heizen matched it on product attributes."
          : "The relationship has not been confirmed by a planner.",
        ...lineage.evidence
          .filter((e) => e.attribute !== "SKU ID" && e.verdict !== "unknown")
          .slice(0, 6)
          .map((e) => `${e.attribute}: ${e.verdict === "match" || e.verdict === "strong" ? "matches" : e.verdict === "partial" ? "partly matches" : "changed"}`),
        blocking ? "Replenishment and store coverage below assume this relationship holds." : "",
      ].filter(Boolean),
      calculation: [],
      impact: "Until confirmed, legacy history and stock are carried on Heizen's match.",
      rank: 50,
    });
  }

  /* ---- Store-level: transfers, DC replenishment, expedite ---------- */
  // A DC top-up of a few units alongside transfers is one piece of work,
  // not two — it rides on the transfer action instead of queuing separately.
  const smallDcTopUp =
    coverage.transfers.length > 0 && coverage.replenishFromDcUnits > 0 && coverage.replenishFromDcUnits < 25;
  if (coverage.available && coverage.transfers.length > 0) {
    const recipients = new Set(coverage.transfers.map((t) => t.toStoreId));
    const donors = new Set(coverage.transfers.map((t) => t.fromStoreId));
    const legacyMoved = coverage.transfers.filter((t) => t.skuRole === "legacy").reduce((n, t) => n + t.units, 0);
    const first = coverage.transfers[0];
    const recipientRows = coverage.rows.filter((r) => recipients.has(r.store.storeId));
    const soonest = recipientRows.map((r) => r.stockoutDate).filter((d): d is string => d !== null).sort()[0];
    out.push({
      ...base,
      id: `${input.transitionId}:transfer`,
      type: "TRANSFER_INVENTORY",
      priority: imminent && recipients.size >= 3 ? "CRITICAL" : "HIGH",
      title: `Move ${count(coverage.transferUnits, legacyMoved === coverage.transferUnits ? labels.oldAdjective : undefined)} between shops`,
      summary:
        `From ${donors.size} shop${donors.size === 1 ? "" : "s"} with too many to ${recipients.size} about to run out` +
        (smallDcTopUp ? ` · plus ${unitsOf(coverage.replenishFromDcUnits)} from the DC` : ""),
      dueDate: soonest,
      quantity: coverage.transferUnits,
      skuId: first?.skuId,
      storesAffected: recipients.size,
      valueAtStake: value(coverage.transferUnits, legacyMoved > 0 ? legacyCost : successorCost),
      reasons: [
        `${recipients.size} store${recipients.size === 1 ? "" : "s"} run out before the next ${successor?.skuId ?? "successor"} shipment can reach them.`,
        `${donors.size} store${donors.size === 1 ? " holds" : "s hold"} more than ${input.thresholds.excessWeeks} weeks of cover${legacyMoved > 0 ? ", mostly legacy stock" : ""}.`,
        `Every donor keeps at least ${input.thresholds.donorFloorWeeks} weeks of cover.`,
        first
          ? `Largest move: ${first.units} units ${storeName(input, first.fromStoreId)} (${fmtNum1(first.fromCoverBefore)} wks) → ${storeName(input, first.toStoreId)} (${fmtNum1(first.toCoverBefore)} wks).`
          : "",
      ].filter(Boolean),
      calculation: [
        { label: "Stores at risk", value: units(coverage.atRiskCount) },
        { label: "Covered by transfers", value: units(recipients.size), op: "−" },
        { label: "Units moved between stores", value: units(coverage.transferUnits) },
        { label: "Donor floor", value: `${input.thresholds.donorFloorWeeks} wks` },
      ],
      impact: `Covers ${recipients.size} store${recipients.size === 1 ? "" : "s"} with stock that already exists — no purchase needed.`,
      rank: soonest ? daysFrom(now, soonest) : 30,
    });
  }

  if (coverage.available && coverage.replenishFromDcUnits > 0 && !smallDcTopUp) {
    const n = coverage.replenishFromDcStores;
    out.push({
      ...base,
      id: `${input.transitionId}:replenish-dc`,
      type: "REPLENISH_SUCCESSOR",
      priority: imminent ? "CRITICAL" : "HIGH",
      title: `Send ${count(coverage.replenishFromDcUnits)} from the DC`,
      summary: `To ${n} Scout Shop${n === 1 ? "" : "s"} before they run out`,
      dueDate: coverage.earliestStockout ?? undefined,
      quantity: coverage.replenishFromDcUnits,
      skuId: successor?.skuId,
      storesAffected: n,
      valueAtStake: value(coverage.replenishFromDcUnits, successorCost),
      reasons: [
        `${units(inventory.dc.successor)} ${successor?.skuId ?? "successor"} units are available at the DC today.`,
        coverage.atRiskOffProfile > 0
          ? `${coverage.atRiskOffProfile} of the at-risk stores are not in ${successor?.skuId ?? "the successor"}'s selling profile, so JDA will not replenish them automatically.`
          : `These stores fall below cover before the next shipment lands.`,
        `Each store is brought up to ${input.thresholds.targetWeeks} weeks of cover or to the next shipment, whichever is longer.`,
      ],
      calculation: [
        { label: "DC available", value: units(inventory.dc.successor) },
        { label: "Sent to at-risk stores", value: units(coverage.replenishFromDcUnits), op: "−" },
        { label: "Left at DC", value: units(Math.max(0, inventory.dc.successor - coverage.replenishFromDcUnits)), op: "=" },
      ],
      impact: `Prevents stockouts at ${n} store${n === 1 ? "" : "s"} using stock already on hand.`,
      rank: coverage.earliestStockout ? daysFrom(now, coverage.earliestStockout) + 1 : 31,
    });
  }

  if (coverage.available && coverage.atRiskAfterPlanCount > 0) {
    const n = coverage.atRiskAfterPlanCount;
    const residual = coverage.rows.filter((r) => r.atRiskAfterPlan);
    const gapDays = Math.max(...residual.map((r) => r.stockoutDays));
    out.push({
      ...base,
      id: `${input.transitionId}:expedite`,
      type: "ACCELERATE_INBOUND",
      priority: "CRITICAL",
      title: nextReceipt
        ? `Speed up the ${count(nextReceipt.quantity, "new")} on order`
        : `Place an urgent order for new ${noun(2)}`,
      summary: `${n} Scout Shop${n === 1 ? "" : "s"} still run out after transfers and DC stock${nextReceipt?.purchaseOrderId ? ` · ${nextReceipt.purchaseOrderId}` : ""}`,
      dueDate: residual.map((r) => r.stockoutDate).filter((d): d is string => d !== null).sort()[0],
      quantity: nextReceipt?.quantity,
      skuId: successor?.skuId,
      storesAffected: n,
      reasons: [
        nextReceipt
          ? `The next shipment is expected ${fmtDateShort(nextReceipt.expectedDate)} — ${fmtNum1(nextReceipt.weeksAway)} weeks out.`
          : "No successor shipment is on order.",
        `Transfers and DC stock cover every store they can; ${n} remain short.`,
        `Longest projected gap: ${gapDays} days without stock.`,
      ],
      calculation: [
        { label: "Stores at risk", value: units(coverage.atRiskCount) },
        { label: "Covered by transfers + DC", value: units(coverage.atRiskCount - n), op: "−" },
        { label: "Still at risk", value: units(n), op: "=", emphasis: true },
      ],
      impact: "Pulling the shipment in, or splitting it to ship part early, closes the gap.",
      rank: 0,
    });
  }

  /* ---- Network order -------------------------------------------------- */
  // An order too small to matter against the requirement is noise, not work.
  const meaningfulOrder = rep.finalOrderUnits >= Math.max(10, 0.03 * rep.requirement);
  if (rep.available && meaningfulOrder && lineage.successors.length > 0) {
    const orderBy = rep.orderByDate;
    const weeksToOrder = orderBy ? weeksFrom(now, orderBy) : null;
    const priority: ActionPriority =
      weeksToOrder !== null && weeksToOrder <= 0 ? "CRITICAL" : weeksToOrder !== null && weeksToOrder <= 3 ? "HIGH" : "MEDIUM";
    out.push({
      ...base,
      id: `${input.transitionId}:order`,
      type: "REPLENISH_SUCCESSOR",
      priority,
      title: `Order ${count(rep.finalOrderUnits, "new")}`,
      summary:
        rep.avoidedUnits > 0
          ? `Not ${units(rep.ignoringLegacyUnits)} — ${units(rep.usableLegacy)} usable legacy units cover the rest`
          : `Covers ${rep.horizonWeeks} weeks of continuity demand plus safety stock`,
      dueDate: orderBy ? (orderBy < now.slice(0, 10) ? now.slice(0, 10) : orderBy) : undefined,
      quantity: rep.finalOrderUnits,
      skuId: successor?.skuId,
      valueAtStake: value(rep.finalOrderUnits, successorCost),
      reasons: [
        `Expected demand over ${rep.horizonWeeks} weeks is ${units(rep.horizonDemand)} units (${rep.leadTimeWeeks ?? "—"}-week lead time + review cycle).`,
        rep.usableLegacy > 0
          ? `${units(rep.usableLegacy)} legacy units can satisfy the same demand (${fmtPct(input.assumptions.substitutabilityPct)} interchangeable).`
          : "No usable legacy stock remains.",
        orderBy
          ? weeksToOrder !== null && weeksToOrder <= 0
            ? "Usable stock falls below safety stock before an order placed today could land."
            : `Order by ${fmtDateShort(orderBy)} to land before stock falls below safety stock.`
          : "",
      ].filter(Boolean),
      calculation: replenishmentLines(rep),
      impact:
        rep.avoidedUnits > 0
          ? `${units(rep.avoidedUnits)} units deferred or avoided versus ordering as if the legacy stock did not exist.`
          : undefined,
      rank: weeksToOrder !== null ? Math.round(weeksToOrder * 7) : 60,
    });
  }

  /* ---- Hold: an order the plan does not need --------------------------- */
  const jdaOrder = rep.jda?.plannedOrderUnits;
  // Only against an order JDA actually plans to place. Without a plan, the
  // avoided purchase is shown on the replenishment panel, not raised as work.
  const holdUnits = jdaOrder !== undefined ? Math.max(0, jdaOrder - rep.finalOrderUnits) : 0;
  const holdThreshold = Math.max(25, 0.1 * (jdaOrder ?? 0));
  if (rep.available && jdaOrder !== undefined && lineage.successors.length > 0 && holdUnits >= holdThreshold) {
    const usableNow = rep.usableLegacy + rep.successorOnHand;
    const coverWeeks = demand.weeklyUnits > 0 ? (usableNow + rep.eligibleInbound) / demand.weeklyUnits : null;
    out.push({
      ...base,
      id: `${input.transitionId}:hold`,
      type: "HOLD_REPLENISHMENT",
      priority: isHighStakes(holdUnits, successorCost) ? "HIGH" : "MEDIUM",
      title: `Hold ${count(holdUnits, "new")} — old stock covers them`,
      summary: `${units(inventory.legacyOnHand)} legacy units provide ${weeks(inventory.networkWeeksOfCover)} of cover`,
      quantity: holdUnits,
      skuId: successor?.skuId,
      valueAtStake: value(holdUnits, successorCost),
      reasons: [
        `JDA plans to order ${units(jdaOrder)} units of ${successorIds}, treating it as a new SKU.`,
        `${units(rep.usableLegacy)} usable legacy units satisfy the same demand.`,
        rep.finalOrderUnits === 0 ? "No additional order is required today." : `Only ${units(rep.finalOrderUnits)} units are needed.`,
      ],
      calculation: [
        { label: `Expected demand, ${rep.horizonWeeks} weeks`, value: units(rep.horizonDemand) },
        { label: "Usable legacy inventory", value: units(rep.usableLegacy) },
        { label: "Successor inventory", value: units(rep.successorOnHand), op: "+" },
        { label: "Inbound inside horizon", value: units(rep.eligibleInbound), op: "+" },
        { label: "Total usable supply", value: units(usableNow + rep.eligibleInbound), op: "=" },
        { label: "Coverage", value: weeks(coverWeeks), emphasis: true },
      ],
      impact: "Purchasing deferred — working capital preserved while legacy stock sells through.",
      rank: 40,
    });
  }

  /* ---- Forecast gap with JDA ------------------------------------------ */
  if (rep.jda && demand.available && lineage.successors.length > 0) {
    const jdaWeeks = Math.max(1, weeksFrom(rep.jda.horizonStart, rep.jda.horizonEnd));
    const continuity = Math.round(demand.weeklyUnits * jdaWeeks);
    const diff = continuity - rep.jda.forecastUnits;
    if (continuity > 0 && Math.abs(diff) / continuity > 0.25) {
      out.push({
        ...base,
        id: `${input.transitionId}:forecast`,
        type: "UPDATE_DEMAND_ASSUMPTION",
        priority: Math.abs(diff) / continuity > 0.5 && coverage.atRiskCount > 0 ? "HIGH" : "MEDIUM",
        title: `Update JDA's forecast for new ${noun(2)}`,
        summary: `JDA ${units(rep.jda.forecastUnits)} · continuity ${units(continuity)} over the same ${Math.round(jdaWeeks)} weeks`,
        quantity: continuity,
        skuId: successor?.skuId,
        reasons: [
          diff > 0
            ? `JDA's forecast rests on ${successorIds}'s own short history and misses demand still running through ${legacyIds}.`
            : `JDA's forecast is above what the combined lineage has been selling.`,
          `Continuity demand runs at ${units(demand.weeklyUnits)} units a week.`,
        ],
        calculation: [
          { label: "JDA forecast", value: units(rep.jda.forecastUnits) },
          { label: "Continuity demand, same window", value: units(continuity) },
          { label: "Difference", value: `${diff > 0 ? "+" : ""}${units(diff)}`, op: "=", emphasis: true },
        ],
        impact: "Store replenishment in JDA follows its forecast — correcting it stops the next shortfall at source.",
        rank: 45,
      });
    }
  }

  /* ---- Legacy left behind --------------------------------------------- */
  const st = input.sellThrough;
  if (st.remainingUnits >= Math.max(100, 0.15 * st.legacyUnits)) {
    out.push({
      ...base,
      id: `${input.transitionId}:sellthrough`,
      type: "REVIEW_TRANSITION",
      priority: isHighStakes(st.remainingUnits, legacyCost) ? "HIGH" : "MEDIUM",
      title: `Sell through ${count(st.remainingUnits, labels.oldAdjective)}`,
      summary: `Projected to remain after ${st.sellThroughWeeks} weeks at today's sell rate`,
      quantity: st.remainingUnits,
      skuId: lineage.predecessors[0]?.skuId,
      valueAtStake: st.remainingValue,
      reasons: [
        `${units(st.legacyUnits)} legacy units on hand, selling ${fmtNum1(st.legacyWeeklySales)} a week.`,
        st.projectedSellThroughDate
          ? `At that rate legacy stock lasts until ${fmtDateShort(st.projectedSellThroughDate)}.`
          : "Legacy stock is not selling at all.",
        st.remainingValue !== undefined ? `${fmtMoney(st.remainingValue, input.currency)} of inventory at cost.` : "",
      ].filter(Boolean),
      calculation: [
        { label: "Legacy on hand", value: units(st.legacyUnits) },
        { label: `Sold in ${st.sellThroughWeeks} weeks`, value: units(st.legacyUnits - st.remainingUnits), op: "−" },
        { label: "Remaining", value: units(st.remainingUnits), op: "=", emphasis: true },
      ],
      impact: "Moving legacy to stores that sell it, or holding successor orders, reduces what is stranded.",
      rank: 55,
    });
  }

  /* ---- Close-out --------------------------------------------------------- */
  if (
    lineage.predecessors.length > 0 &&
    lineage.successors.length > 0 &&
    inventory.legacyOnHand === 0 &&
    input.progress >= 0.98
  ) {
    out.push({
      ...base,
      id: `${input.transitionId}:closeout`,
      type: "MARK_LEGACY_DEPLETION",
      priority: "MONITOR",
      title: `Close out the ${labels.oldAdjective} ${noun(2)}`,
      summary: "No legacy stock remains anywhere in the network",
      skuId: lineage.predecessors[0]?.skuId,
      reasons: ["Legacy inventory is zero at the DC and in every store.", `${fmtPct(input.progress)} of recent sales are on the successor.`],
      calculation: [],
      impact: "Marks the transition complete.",
      rank: 90,
    });
  }

  /* ---- Stores holding stock with no sales -------------------------------- */
  if (coverage.available && coverage.atRiskCount > 0) {
    const dead = coverage.rows.filter((r) => r.weeklyDemand === 0 && r.legacyUnits + r.successorUnits >= 10);
    if (dead.length >= 3) {
      out.push({
        ...base,
        id: `${input.transitionId}:dead-stock`,
        type: "INVESTIGATE_STORE_RISK",
        priority: "MEDIUM",
        title: `Investigate ${dead.length} stores with stock and no sales`,
        summary: `${units(dead.reduce((n, r) => n + r.legacyUnits + r.successorUnits, 0))} units sitting where nothing sold in 8 weeks`,
        storesAffected: dead.length,
        reasons: [
          "No lineage sales in the last 8 weeks, yet these stores hold stock.",
          "It may be a data issue, a display location, or stock to move.",
        ],
        calculation: [],
        rank: 70,
      });
    }
  }

  return out.sort(compareActions);
}

export function compareActions(a: PlannerAction, b: PlannerAction): number {
  return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || a.rank - b.rank || a.id.localeCompare(b.id);
}

export function replenishmentLines(rep: Replenishment): CalculationLine[] {
  const lines: CalculationLine[] = [
    { label: `Expected demand, ${rep.horizonWeeks} weeks`, value: units(rep.horizonDemand) },
    { label: `Safety stock (${fmtNum1(rep.safetyStockWeeks)} wks)`, value: units(rep.safetyStockUnits), op: "+" },
    { label: "Total requirement", value: units(rep.requirement), op: "=" },
    { label: "Usable legacy inventory", value: units(rep.usableLegacy), op: "−" },
    { label: "Successor inventory", value: units(rep.successorOnHand), op: "−" },
    { label: "Inbound inside horizon", value: units(rep.eligibleInbound), op: "−" },
    { label: "Recommended replenishment", value: units(rep.recommendedUnits), op: "=", emphasis: true },
  ];
  if (rep.orderOverrideUnits !== undefined) {
    lines.push({ label: "Planner order", value: units(rep.finalOrderUnits), emphasis: true });
  }
  return lines;
}

function storeName(input: ActionInput, id: string): string {
  return input.storeById.get(id)?.storeName ?? id;
}

/* ------------------------------------------------------------------ */
/* Status                                                              */
/* ------------------------------------------------------------------ */

export function deriveStatus(input: {
  actions: readonly PlannerAction[];
  progress: number;
  legacyOnHand: number;
  closed: boolean;
  hasPredecessor: boolean;
}): TransitionStatus {
  if (input.closed) return "COMPLETE";
  const open = input.actions.filter((a) => a.type !== "MARK_LEGACY_DEPLETION");
  if (open.some((a) => a.priority === "CRITICAL" || a.priority === "HIGH")) return "ACTION_NEEDED";
  if (open.some((a) => a.priority === "MEDIUM")) return "MONITOR";
  if (input.hasPredecessor && input.legacyOnHand === 0 && input.progress >= 0.98) return "COMPLETE";
  if (input.progress < 0.85) return "TRANSITIONING";
  return "HEALTHY";
}

const RISK_BY_ACTION: Partial<Record<PlannerAction["type"], TransitionRiskKind>> = {
  ACCELERATE_INBOUND: "INBOUND_DELAY",
  TRANSFER_INVENTORY: "IMBALANCE",
  REPLENISH_SUCCESSOR: "STOCKOUT",
  HOLD_REPLENISHMENT: "EXCESS",
  REVIEW_TRANSITION: "EXCESS",
  CONFIRM_SUCCESSOR: "UNCONFIRMED",
  UPDATE_DEMAND_ASSUMPTION: "FORECAST_GAP",
  INVESTIGATE_STORE_RISK: "STOCKOUT",
};

export function deriveRiskKind(actions: readonly PlannerAction[]): TransitionRiskKind {
  const top = actions.find((a) => a.priority !== "MONITOR");
  if (!top) return "NONE";
  return RISK_BY_ACTION[top.type] ?? "NONE";
}

/** One sentence for a list row. Numbers only — never "AI found an anomaly". */
export function deriveHeadline(input: {
  name: string;
  riskKind: TransitionRiskKind;
  lineage: Lineage;
  demand: DemandContinuity;
  inventory: NetworkInventory;
  coverage: StoreCoverage;
  replenishment: Replenishment;
  sellThrough: LegacySellThrough;
  progress: number;
}): string {
  const { coverage: c, inventory: inv, lineage } = input;
  const shops = (n: number) => `${n} Scout Shop${n === 1 ? "" : "s"}`;
  const noun = productNoun(input.name);
  switch (input.riskKind) {
    case "INBOUND_DELAY":
      return `${shops(c.atRiskAfterPlanCount)} run out of ${noun} before the late shipment lands.`;
    case "IMBALANCE":
      return inv.networkWeeksOfCover !== null && inv.networkWeeksOfCover >= 4
        ? `${shops(c.atRiskCount)} run out of ${noun} soon — yet there's ${fmtNum1(inv.networkWeeksOfCover)} weeks of stock in the network.`
        : `${shops(c.atRiskCount)} run out of ${noun} before new stock arrives.`;
    case "STOCKOUT":
      return `${shops(c.atRiskCount)} run out of ${noun} before new stock arrives.`;
    case "EXCESS":
      return input.sellThrough.remainingUnits > 0
        ? `${fmtNum(input.sellThrough.remainingUnits)} ${versionLabels(lineage.reason, lineage.successors, lineage.predecessors).oldAdjective} ${noun} won't sell in time.`
        : `Old stock covers ${fmtNum1(inv.networkWeeksOfCover ?? 0)} weeks — the new order can wait.`;
    case "UNCONFIRMED":
      return `Heizen matched the new ${lineage.successors.map((x) => productName(x)).join(" + ")} to the ${lineage.predecessors.map((x) => productName(x)).join(" + ")}. Is that the right replacement?`;
    case "FORECAST_GAP":
      return `JDA's forecast for new ${noun} misses what the old ones still sell.`;
    default:
      if (lineage.type === "NO_SUCCESSOR") return `${fmtNum(inv.legacyOnHand)} ${noun} left to sell — no replacement coming.`;
      if (lineage.type === "NEW_PRODUCT") return "New product selling to plan.";
      return "On track — legacy stock is selling down as planned.";
  }
}
