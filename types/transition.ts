/**
 * The derived transition model.
 *
 * A `TransitionView` is what every screen renders: one continuous planning
 * requirement assembled from several SKU records. It is always recomputed from
 * (dataset + planner overrides [+ scenario adjustments]) by
 * `lib/transitions/build.ts` — never stored, never edited in place.
 *
 * The chain every screen follows:
 *   SKU Transition → Product Lineage → Demand Continuity → Network Inventory
 *   → Store Coverage → Replenishment → Rebalancing → Planner Action
 */

import type { RelationshipSource, SkuRow, StoreRow, TransitionReason, TransitionType } from "./dataset";

/* ------------------------------------------------------------------ */
/* Assumptions                                                         */
/* ------------------------------------------------------------------ */

/**
 * Every assumption the transition math reads. Resolved in layers:
 * engine default ← dataset row ← planner override ← scenario adjustment.
 */
export interface TransitionAssumptions {
  /** 0–1. Share of legacy units that can satisfy successor demand. */
  substitutabilityPct: number;
  /** 0–1. Share of predecessor demand that moves to the successor. */
  transferredDemandPct: number;
  /** −0.5…+0.5. Planner or scenario lift on expected demand. */
  demandAdjustmentPct: number;
  /** An explicit horizon demand; replaces the calculated figure when set. */
  demandOverrideUnits?: number;
  safetyStockWeeks: number;
  /** How long legacy stock is given to sell through before it is stranded. */
  sellThroughWeeks: number;
  /** Scenario only: every successor receipt arrives this many weeks late. */
  inboundDelayWeeks: number;
  /** An explicit successor order; replaces the recommendation when set. */
  orderOverrideUnits?: number;
}

/** Store-network thresholds, in weeks of cover. Configurable, not magic. */
export interface CoverageThresholds {
  /** Below this a store is short. */
  shortageWeeks: number;
  /** What a replenished or transferred-to store is brought up to. */
  targetWeeks: number;
  /** Above this a store holds excess and can donate. */
  excessWeeks: number;
  /** A donor is never left below this. */
  donorFloorWeeks: number;
  /** DC to store transit. */
  dcToStoreWeeks: number;
  /** A transfer smaller than this is not worth a truck. */
  minTransferUnits: number;
}

/* ------------------------------------------------------------------ */
/* Status                                                              */
/* ------------------------------------------------------------------ */

/** The five planner-facing states. Nothing else is shown at list level. */
export type TransitionStatus = "ACTION_NEEDED" | "MONITOR" | "TRANSITIONING" | "HEALTHY" | "COMPLETE";

/** The one-word reason a transition is in its state. */
export type TransitionRiskKind =
  | "STOCKOUT"
  | "EXCESS"
  | "IMBALANCE"
  | "INBOUND_DELAY"
  | "UNCONFIRMED"
  | "FORECAST_GAP"
  | "NONE";

/* ------------------------------------------------------------------ */
/* Lineage                                                             */
/* ------------------------------------------------------------------ */

export type AttributeVerdict = "match" | "strong" | "partial" | "changed" | "unknown";

export interface RelationshipEvidence {
  attribute: string;
  verdict: AttributeVerdict;
  legacyValue?: string;
  successorValue?: string;
}

export type RelationshipConfidence = "HIGH" | "MEDIUM" | "LOW";

/** How the planner has classified the relationship. */
export type RelationshipDecision =
  | "CONFIRMED"
  | "PARTIAL_REPLACEMENT"
  | "DISCONTINUED"
  | "NEW_PRODUCT"
  | "INVESTIGATE";

export interface Lineage {
  type: TransitionType;
  reason?: TransitionReason;
  source: RelationshipSource;
  predecessors: SkuRow[];
  successors: SkuRow[];
  confirmed: boolean;
  /** Set once the planner has acted on the relationship. */
  decision?: RelationshipDecision;
  confidence: RelationshipConfidence;
  /** Attribute-by-attribute, so the match explains itself. */
  evidence: RelationshipEvidence[];
  matchedCount: number;
  changedCount: number;
}

/* ------------------------------------------------------------------ */
/* Demand continuity                                                   */
/* ------------------------------------------------------------------ */

export interface YearlySales {
  /** Calendar year, e.g. 2025. */
  year: number;
  /** True for the current, incomplete year. */
  ytd: boolean;
  legacyUnits: number;
  successorUnits: number;
}

export interface MonthlyLineagePoint {
  /** `YYYY-MM`. */
  month: string;
  legacyUnits: number;
  successorUnits: number;
}

export interface DemandContinuity {
  available: boolean;
  /** Last 52 weeks. */
  legacyUnitsL52: number;
  successorUnitsL52: number;
  transferredDemandPct: number;
  /** legacy × transferred + successor — one stream, never two. */
  baselineAnnualUnits: number;
  /** Year-over-year change of the combined lineage, clamped. */
  trendFactor: number;
  demandAdjustmentPct: number;
  expectedAnnualUnits: number;
  horizonWeeks: number;
  /** Horizon demand ÷ a flat run rate. 1.18 = the horizon is a busy stretch. */
  seasonalityFactor: number;
  seasonalityBasis: "history" | "flat";
  /** Expected units over the horizon, after any planner override. */
  horizonUnits: number;
  /** Before the override — so an override never hides what the math said. */
  calculatedHorizonUnits: number;
  overridden: boolean;
  weeklyUnits: number;
  /** ONE_TO_MANY: horizon units per successor. Sums to `horizonUnits`. */
  bySuccessor: { skuId: string; share: number; horizonUnits: number }[];
  yearly: YearlySales[];
  monthly: MonthlyLineagePoint[];
  /** Successor share of lineage units, last 8 weeks. */
  transitionProgress: number;
}

/* ------------------------------------------------------------------ */
/* Inventory                                                           */
/* ------------------------------------------------------------------ */

export interface InventoryCell {
  legacy: number;
  successor: number;
}

export interface InboundReceipt {
  id: string;
  skuId: string;
  quantity: number;
  /** As the data says. */
  plannedDate: string;
  /** After any scenario delay. */
  expectedDate: string;
  weeksAway: number;
  /** Arrives inside the replenishment horizon. */
  eligible: boolean;
  purchaseOrderId?: string;
  source?: string;
}

export interface NetworkInventory {
  /** Available units (on hand − allocated), by location type. */
  dc: InventoryCell;
  stores: InventoryCell;
  inbound: InventoryCell;
  /** DC units committed to open orders and excluded from supply. */
  dcAllocated: InventoryCell;
  legacyOnHand: number;
  successorOnHand: number;
  substitutabilityPct: number;
  /** All predecessors blocked from sale. */
  legacyBlocked: boolean;
  /** legacy on hand × substitutability. */
  usableLegacy: number;
  /** Successor inbound arriving inside the horizon. */
  eligibleInbound: number;
  /** Successor inbound arriving after it. */
  laterInbound: number;
  /** usable legacy + successor on hand + eligible inbound. */
  effectiveSupply: number;
  receipts: InboundReceipt[];
  /** (usable legacy + successor on hand) ÷ weekly demand. */
  networkWeeksOfCover: number | null;
  /** Value of legacy + successor on hand, when every SKU has a cost. */
  onHandValue?: number;
}

/* ------------------------------------------------------------------ */
/* Store coverage                                                      */
/* ------------------------------------------------------------------ */

export type StoreStockState = "LEGACY_ONLY" | "MIXED" | "NEW_ONLY" | "NO_STOCK";

export type StoreRecommendation =
  | "TRANSFER_IN"
  | "TRANSFER_OUT"
  | "REPLENISH"
  | "EXPEDITE"
  | "HOLD"
  | "OK";

export interface StoreCoverageRow {
  store: StoreRow;
  legacyUnits: number;
  successorUnits: number;
  /** legacy × substitutability + successor. */
  usableUnits: number;
  weeklyDemand: number;
  /** Null when the store has no recent demand. */
  weeksOfCover: number | null;
  /** Planning date + cover. Null when cover is null. */
  stockoutDate: string | null;
  /** Legacy units sold per week here, last 8 weeks. */
  legacyWeeklySales: number;
  stockState: StoreStockState;
  /** In the successor's selling profile — JDA will replenish it. */
  onSuccessorProfile: boolean | null;
  /** Runs out before the next successor shipment can reach it. */
  atRisk: boolean;
  /** Days without stock before resupply, when at risk. */
  stockoutDays: number;
  /** After the recommended transfers and DC replenishment. */
  atRiskAfterPlan: boolean;
  transferIn: number;
  transferOut: number;
  replenishFromDc: number;
  weeksOfCoverAfterPlan: number | null;
  recommendation: StoreRecommendation;
  /** Legacy units still here when the sell-through window closes. */
  strandedLegacyUnits: number;
}

export interface TransferRecommendation {
  id: string;
  skuId: string;
  /** Legacy units move first — the whole point is to sell what exists. */
  skuRole: "legacy" | "successor";
  fromStoreId: string;
  toStoreId: string;
  units: number;
  fromCoverBefore: number;
  fromCoverAfter: number;
  toCoverBefore: number;
  toCoverAfter: number;
  /** Days the recipient would otherwise be out of stock. */
  avoidedStockoutDays: number;
  sameRegion: boolean;
}

export interface StoreCoverage {
  available: boolean;
  /** Why not, in one planner sentence. */
  unavailableReason?: string;
  rows: StoreCoverageRow[];
  storeCount: number;
  stateCounts: Record<StoreStockState, number>;
  atRiskCount: number;
  atRiskAfterPlanCount: number;
  excessCount: number;
  /** Weeks until the next successor shipment can reach a store. */
  resupplyWeeks: number | null;
  transfers: TransferRecommendation[];
  transferUnits: number;
  replenishFromDcUnits: number;
  replenishFromDcStores: number;
  /** Earliest projected store stockout among at-risk stores. */
  earliestStockout: string | null;
  /** At-risk stores not in the successor's selling profile. */
  atRiskOffProfile: number;
}

/* ------------------------------------------------------------------ */
/* Replenishment                                                       */
/* ------------------------------------------------------------------ */

export interface WeeklyProjectionPoint {
  week: number;
  date: string;
  /** Usable units at the start of the week. */
  usableUnits: number;
  receipts: number;
  demand: number;
}

export interface Replenishment {
  available: boolean;
  horizonWeeks: number;
  leadTimeWeeks: number | null;
  horizonDemand: number;
  safetyStockWeeks: number;
  safetyStockUnits: number;
  /** horizon demand + safety stock. */
  requirement: number;
  usableLegacy: number;
  successorOnHand: number;
  eligibleInbound: number;
  /** max(0, requirement − effective supply). */
  recommendedUnits: number;
  /** What the order would be if legacy stock were ignored. */
  ignoringLegacyUnits: number;
  /** ignoringLegacy − recommended: purchasing deferred or avoided. */
  avoidedUnits: number;
  /** The planner's order, if overridden. */
  orderOverrideUnits?: number;
  finalOrderUnits: number;
  /** Supply beyond requirement — excess the plan is carrying. */
  excessUnits: number;
  /** When usable stock first dips below safety stock. */
  neededByDate: string | null;
  /** neededBy − lead time. Past = order now. */
  orderByDate: string | null;
  projection: WeeklyProjectionPoint[];
  /** JDA's view, when Current_Plan is supplied. */
  jda?: { forecastUnits: number; plannedOrderUnits?: number; horizonStart: string; horizonEnd: string };
  unitCost?: number;
}

/* ------------------------------------------------------------------ */
/* Legacy sell-through                                                 */
/* ------------------------------------------------------------------ */

export interface LegacySellThrough {
  legacyUnits: number;
  /** Network legacy units per week, last 8 weeks. */
  legacyWeeklySales: number;
  sellThroughWeeks: number;
  /** Legacy units projected to remain when the window closes. */
  remainingUnits: number;
  remainingValue?: number;
  /** When legacy stock runs out at today's rate. Null if it isn't selling. */
  projectedSellThroughDate: string | null;
}

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

export type ActionType =
  | "CONFIRM_SUCCESSOR"
  | "REPLENISH_SUCCESSOR"
  | "HOLD_REPLENISHMENT"
  | "TRANSFER_INVENTORY"
  | "ACCELERATE_INBOUND"
  | "REVIEW_TRANSITION"
  | "MARK_LEGACY_DEPLETION"
  | "UPDATE_DEMAND_ASSUMPTION"
  | "INVESTIGATE_STORE_RISK";

export type ActionPriority = "CRITICAL" | "HIGH" | "MEDIUM" | "MONITOR";

export interface CalculationLine {
  label: string;
  value: string;
  /** How the line combines: "+" "−" "=" "×", or none for an input. */
  op?: "+" | "−" | "=" | "×";
  emphasis?: boolean;
}

export interface PlannerAction {
  id: string;
  transitionId: string;
  transitionName: string;
  type: ActionType;
  priority: ActionPriority;
  /** "Replenish 420 units". */
  title: string;
  /** One line: why now. */
  summary: string;
  dueDate?: string;
  quantity?: number;
  skuId?: string;
  storesAffected?: number;
  /** $ at stake, when costs are known. */
  valueAtStake?: number;
  /** Bulleted, plain-language reasons. */
  reasons: string[];
  calculation: CalculationLine[];
  /** What changes if the planner does it. */
  impact?: string;
  /** Lower sorts first within a priority. */
  rank: number;
}

/* ------------------------------------------------------------------ */
/* The view                                                            */
/* ------------------------------------------------------------------ */

export interface TransitionView {
  id: string;
  name: string;
  category: string;
  program?: string;
  startDate?: string;
  targetCompletionDate?: string;
  planningNow: string;
  currency: string;
  assumptions: TransitionAssumptions;
  lineage: Lineage;
  demand: DemandContinuity;
  inventory: NetworkInventory;
  coverage: StoreCoverage;
  replenishment: Replenishment;
  sellThrough: LegacySellThrough;
  actions: PlannerAction[];
  status: TransitionStatus;
  riskKind: TransitionRiskKind;
  /** One sentence for list rows. */
  headline: string;
  /** Short label for the next step, e.g. "Transfer 84 units". */
  nextStep: string;
  progress: number;
  closed: boolean;
}

/* ------------------------------------------------------------------ */
/* Planner overrides (baseline decisions, not scenarios)               */
/* ------------------------------------------------------------------ */

export interface TransitionOverrides {
  relationshipDecision?: RelationshipDecision;
  /** Replaces the successor list (Change successor). */
  successorSkuIds?: string[];
  substitutabilityPct?: number;
  transferredDemandPct?: number;
  demandAdjustmentPct?: number;
  demandOverrideUnits?: number;
  safetyStockWeeks?: number;
  sellThroughWeeks?: number;
  orderOverrideUnits?: number;
  closed?: boolean;
}

/** Scenario levers — a strict subset of the assumptions. */
export type ScenarioAdjustments = Partial<
  Pick<
    TransitionAssumptions,
    | "substitutabilityPct"
    | "transferredDemandPct"
    | "demandAdjustmentPct"
    | "safetyStockWeeks"
    | "sellThroughWeeks"
    | "inboundDelayWeeks"
  >
>;

export type ActionDisposition = "DONE" | "DISMISSED" | "SNOOZED";

export interface ActionState {
  disposition: ActionDisposition;
  at: string;
  note?: string;
}

export interface AuditEntry {
  id: string;
  at: string;
  actor: string;
  transitionId: string;
  text: string;
}
