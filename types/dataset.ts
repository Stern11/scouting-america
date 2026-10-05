/**
 * The normalized planning input model.
 *
 * Every input adapter — the seeded demo generator and the uploaded Excel
 * workbook (and, later, a JDA MMS extract) — produces a `PlanningDataset`.
 * Nothing downstream of `normalizePlanningInput()` knows or cares which
 * adapter it came from.
 *
 * These are *input* rows, deliberately close to the shape a merchandise
 * planner exports from JDA MMS: the SKU master, stores, sales, inventory
 * snapshots, open purchase orders. `lib/transitions/build.ts` turns them into
 * `TransitionView`s; keeping the two separate is what lets the workbook schema
 * evolve without touching the planning logic.
 *
 * The one idea the whole model exists to express: **item identity is not the
 * same thing as business continuity.** JDA holds SKU rows. A transition row
 * says that several SKU rows are one continuous planning requirement.
 */

/** Source adapter that produced a dataset. Never mix the two. */
export type DatasetMode = "DEMO" | "UPLOADED";

export interface DatasetMetadata {
  id: string;
  name: string;
  mode: DatasetMode;
  /** Seed for DEMO datasets; undefined for uploads. */
  seed?: string;
  /** Original filename for UPLOADED datasets; undefined for demo. */
  sourceFileName?: string;
  createdAt: string;
  /** The "now" every derived date is measured against. Never `Date.now()`. */
  planningNow: string;
  currency: string;
  /** Which optional data was actually supplied — drives honest empty states. */
  capabilities: DatasetCapabilities;
}

/**
 * What this dataset can legitimately answer. Missing data degrades one
 * analysis and says so; it never yields a plausible-looking placeholder.
 */
export interface DatasetCapabilities {
  /** Any sales history at all — the basis of continuity demand. */
  salesHistory: boolean;
  /** Sales rows carry a store — enables store-level demand and coverage. */
  storeLevelDemand: boolean;
  /** Inventory rows at STORE locations. */
  storeInventory: boolean;
  /** Inventory rows at DC locations. */
  dcInventory: boolean;
  /** Inbound_Supply present — open purchase orders and projected receipts. */
  inboundSupply: boolean;
  /** Current_Plan present — the JDA forecast and planned replenishment. */
  currentPlan: boolean;
  /** Selling_Profiles present — which stores each SKU is set up to sell in. */
  sellingProfiles: boolean;
  /** Every SKU in a transition carries a unit cost — enables $ figures. */
  unitCosts: boolean;
}

/* ------------------------------------------------------------------ */
/* Stores                                                              */
/* ------------------------------------------------------------------ */

export interface StoreRow {
  storeId: string;
  storeName: string;
  city?: string;
  state?: string;
  region?: string;
  cluster?: string;
}

/* ------------------------------------------------------------------ */
/* SKU master                                                          */
/* ------------------------------------------------------------------ */

export const SKU_STATUSES = ["ACTIVE", "NEW", "DISCONTINUED", "BLOCKED"] as const;
/**
 * `DISCONTINUED` still sells what is on the shelf; `BLOCKED` may not be sold
 * at all (a recall, a compliance hold) — so its stock is never usable.
 */
export type SkuStatus = (typeof SKU_STATUSES)[number];

export interface SkuRow {
  skuId: string;
  skuName: string;
  productFamily: string;
  category: string;
  program?: string;
  brand?: string;
  /** e.g. "Youth XS–Adult XL". Compared, never parsed. */
  sizeRange?: string;
  color?: string;
  vendor?: string;
  packaging?: string;
  status: SkuStatus;
  launchDate?: string;
  discontinueDate?: string;
  /** What JDA records as this SKU's replacement, when it records one. */
  replacementSkuId?: string;
  unitCost?: number;
  retailPrice?: number;
  /** Vendor lead time, order to DC receipt. */
  leadTimeDays?: number;
}

/* ------------------------------------------------------------------ */
/* SKU transitions                                                     */
/* ------------------------------------------------------------------ */

export const TRANSITION_TYPES = ["ONE_TO_ONE", "MANY_TO_ONE", "ONE_TO_MANY", "NO_SUCCESSOR", "NEW_PRODUCT"] as const;
/**
 * The shape of a lineage:
 *   ONE_TO_ONE    A → B
 *   MANY_TO_ONE   A + B → C   (consolidation)
 *   ONE_TO_MANY   A → B + C   (split — predecessor demand is divided, never copied)
 *   NO_SUCCESSOR  A → ∅       (discontinued; demand does not carry forward)
 *   NEW_PRODUCT   ∅ → B       (no legacy history to carry)
 */
export type TransitionType = (typeof TRANSITION_TYPES)[number];

export const TRANSITION_REASONS = ["REBRAND", "REPLACEMENT", "CONSOLIDATION", "SPLIT", "DISCONTINUATION", "NEW"] as const;
export type TransitionReason = (typeof TRANSITION_REASONS)[number];

/**
 * Where a relationship came from:
 *   PLANNER    the SKU_Transitions sheet — a planner said so
 *   SYSTEM     JDA's own replacement field on the SKU master
 *   SUGGESTED  Heizen matched a discontinued SKU to a new one; needs confirming
 */
export type RelationshipSource = "PLANNER" | "SYSTEM" | "SUGGESTED";

export interface TransitionRow {
  transitionId: string;
  transitionName: string;
  predecessorSkuIds: string[];
  successorSkuIds: string[];
  transitionType: TransitionType;
  reason?: TransitionReason;
  startDate?: string;
  targetCompletionDate?: string;
  /** 0–1. Share of legacy units that can satisfy successor demand. */
  substitutabilityPct?: number;
  /** 0–1. Share of predecessor demand expected to move to the successor. */
  transferredDemandPct?: number;
  /** ONE_TO_MANY only: how predecessor demand divides. Shares sum to 1. */
  successorSplit?: Record<string, number>;
  safetyStockWeeks?: number;
  plannerConfirmed: boolean;
  source: RelationshipSource;
  /** Closed out by the planner. A closed transition is complete whatever its stock says. */
  closed?: boolean;
}

/* ------------------------------------------------------------------ */
/* Sales history                                                       */
/* ------------------------------------------------------------------ */

/**
 * Units sold over a period. A period can be a week, a month, or any window.
 *
 * `storeId` absent = a network total. When a SKU has network rows they are its
 * authoritative history and store rows are used only for *where* it sells —
 * never added on top, which would count the same sale twice.
 */
export interface SalesRow {
  skuId: string;
  storeId?: string;
  /** Inclusive. */
  periodStart: string;
  /** Inclusive. */
  periodEnd: string;
  units: number;
  value?: number;
}

/* ------------------------------------------------------------------ */
/* Inventory                                                           */
/* ------------------------------------------------------------------ */

export type LocationType = "STORE" | "DC";

export interface InventoryRow {
  snapshotDate: string;
  skuId: string;
  locationId: string;
  locationType: LocationType;
  onHand: number;
  /** Committed to open orders (council, online) — not available to stores. */
  allocated: number;
  /** onHand − allocated, never negative. Derived when not supplied. */
  available: number;
}

/* ------------------------------------------------------------------ */
/* Inbound supply                                                      */
/* ------------------------------------------------------------------ */

export interface InboundRow {
  id: string;
  skuId: string;
  locationId: string;
  locationType: LocationType;
  quantity: number;
  expectedReceiptDate: string;
  source?: string;
  purchaseOrderId?: string;
}

/* ------------------------------------------------------------------ */
/* Current plan (JDA)                                                  */
/* ------------------------------------------------------------------ */

/** What JDA currently plans for a SKU over a window. */
export interface CurrentPlanRow {
  skuId: string;
  horizonStart: string;
  horizonEnd: string;
  forecastUnits: number;
  plannedReplenishmentUnits?: number;
}

/* ------------------------------------------------------------------ */
/* Selling profiles                                                    */
/* ------------------------------------------------------------------ */

/** JDA's selling profile: a SKU and the stores it is set up to sell in. */
export interface SellingProfile {
  id: string;
  name: string;
  skuIds: string[];
  storeIds: string[];
}

/* ------------------------------------------------------------------ */
/* History                                                             */
/* ------------------------------------------------------------------ */

/** A prior planner decision on a transition. Demo data seeds a few. */
export interface HistoryEntry {
  id: string;
  date: string;
  actor: string;
  transitionId: string;
  text: string;
}

/* ------------------------------------------------------------------ */

export interface PlanningDataset {
  metadata: DatasetMetadata;
  stores: StoreRow[];
  skus: SkuRow[];
  transitions: TransitionRow[];
  sales: SalesRow[];
  inventory: InventoryRow[];
  inbound: InboundRow[];
  currentPlan: CurrentPlanRow[];
  sellingProfiles: SellingProfile[];
  history: HistoryEntry[];
}

/* ------------------------------------------------------------------ */
/* Raw input — what an adapter hands to normalize                       */
/* ------------------------------------------------------------------ */

/** A loose row keyed by the workbook's snake_case column names. */
export type RawRow = Record<string, unknown>;

export interface RawPlanningInput {
  metadata: Omit<DatasetMetadata, "capabilities">;
  stores?: RawRow[];
  skus?: RawRow[];
  transitions?: RawRow[];
  sales?: RawRow[];
  inventory?: RawRow[];
  inbound?: RawRow[];
  currentPlan?: RawRow[];
  sellingProfiles?: RawRow[];
  history?: RawRow[];
}
