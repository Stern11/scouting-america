/**
 * The normalized planning input model.
 *
 * Every input adapter — the seeded demo generator and the uploaded Excel
 * workbook — produces a `PlanningDataset`. Nothing downstream of
 * `normalizePlanningInput()` knows or cares which adapter it came from
 * (V2 §31, §67).
 *
 * These are *input* rows, deliberately close to the shape a planner exports
 * from SAP / Kinaxis / a warehouse. `lib/situations/build.ts` turns them into
 * `PlanningSituation`s; keeping the two separate is what lets the workbook
 * schema evolve without touching the planning logic.
 */

import type { DateRange } from "./shared";

/** Source adapter that produced a dataset. Never mix the two (V2 §33). */
export type DatasetMode = "DEMO" | "UPLOADED";

/**
 * A planning period label. Two shapes are legal and they mean different things:
 *   - a calendar month, `YYYY-MM` (e.g. "2027-06") — used by capacity
 *   - a program label, `YYYY-<Program>` (e.g. "2027-Halloween") — used by
 *     business plan / current plan rows that are governed at event level
 * `lib/dataset/periods.ts` is the only place allowed to interpret them.
 */
export type PeriodKey = string;

/** `YYYY-MM`. Capacity and material time-phasing are always monthly. */
export type MonthKey = string;

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
  /** Which optional sheets were actually supplied — drives honest empty states. */
  capabilities: DatasetCapabilities;
}

/**
 * What this dataset can legitimately answer. A missing sheet must degrade one
 * analysis, never block the workflow (V2 §24, §66).
 */
export interface DatasetCapabilities {
  /** Business_Plan + Current_Plan + Historical_Items present. */
  reconciliation: boolean;
  /** Line_Capacity + Item_Line_Mapping present. */
  capacity: boolean;
  /** BOM present. */
  materials: boolean;
  /** Lead_Time_History present — enables system-vs-observed lead time. */
  leadTimeAnalysis: boolean;
  /** Inventory_Supply present — enables net (not just gross) exposure. */
  netRequirements: boolean;
  /** Readiness_History present — enables the season readiness curve's "last year's pace" line. */
  readinessHistory: boolean;
  /** Line_History present — enables line-level downtime, overtime and late-arrival history. */
  lineHistory: boolean;
}

/* ------------------------------------------------------------------ */
/* Business_Plan (required)                                            */
/* ------------------------------------------------------------------ */

/**
 * The higher-level business expectation the operational plan is reconciled
 * against. This is the "expected business" side of the bridge.
 */
export interface BusinessPlanRow {
  id: string;
  planningPeriod: PeriodKey;
  eventOrProgram: string;
  businessUnit: string;
  brand: string;
  targetValue: number;
  /** Optional — when absent, unit-level reconciliation is not available. */
  targetUnits?: number;
  customer?: string;
  channel?: string;
  productFamily?: string;
  /** Fractional, e.g. 0.06 for +6%. Normalized from a `growth_pct` column. */
  growthPct?: number;
  currency?: string;
  notes?: string;
}

/* ------------------------------------------------------------------ */
/* Current_Plan (required)                                             */
/* ------------------------------------------------------------------ */

/** What is already formalized in the planning system. */
export interface CurrentPlanRow {
  id: string;
  planningPeriod: PeriodKey;
  itemId: string;
  itemName: string;
  brand: string;
  productFamily: string;
  plannedUnits: number;
  eventOrProgram?: string;
  customer?: string;
  channel?: string;
  plannedValue?: number;
  currency?: string;
  plant?: string;
  primaryLineId?: string;
  productionWindow?: DateRange;
  salesWindow?: DateRange;
  status?: string;
}

/* ------------------------------------------------------------------ */
/* Historical_Items (required)                                         */
/* ------------------------------------------------------------------ */

/**
 * Prior-season items. These are the candidate contributors that explain an
 * unresolved amount, and the analogue pool for BOM inference.
 * The optional attribute columns matter: matching is configurable across
 * them (V2 §43), so each one that is present widens what the planner can
 * match on.
 */
export interface HistoricalItemRow {
  id: string;
  historicalPeriod: PeriodKey;
  itemId: string;
  itemName: string;
  brand: string;
  productFamily: string;
  actualUnits: number;
  eventOrProgram?: string;
  customer?: string;
  channel?: string;
  packFormat?: string;
  packSize?: number;
  sizeUom?: string;
  flavorOrVariant?: string;
  formulaFamily?: string;
  packagingType?: string;
  basePack?: string;
  actualValue?: number;
  currency?: string;
  plant?: string;
  primaryLineId?: string;
  productionWindow?: DateRange;
  salesWindow?: DateRange;
  status?: string;
}

/* ------------------------------------------------------------------ */
/* BOM (optional — required for material analysis)                     */
/* ------------------------------------------------------------------ */

export type ComponentType =
  | "RAW_MATERIAL"
  | "PACKAGING"
  | "SEMI_FINISHED"
  | "FINISHED_COMPONENT"
  | "ARTWORK"
  | "OTHER";

export interface BomRow {
  id: string;
  parentItemId: string;
  componentId: string;
  componentName: string;
  componentType: ComponentType;
  quantityPerParent: number;
  uom: string;
  componentFamily?: string;
  validFrom?: string;
  validTo?: string;
  /** Fractional, e.g. 0.02 for 2%. */
  scrapPct?: number;
  planningStatus?: string;
  supplierId?: string;
  notes?: string;
}

/* ------------------------------------------------------------------ */
/* Line_Capacity (optional — required for capacity analysis)           */
/* ------------------------------------------------------------------ */

/**
 * Available manufacturing hours by line AND period. Capacity varies month to
 * month — a fixed monthly figure is the thing this sheet exists to replace
 * (V2 §20, §46).
 */
export interface LineCapacityRow {
  id: string;
  period: MonthKey;
  plant: string;
  lineId: string;
  lineName: string;
  baseCalendarHours: number;
  plannedMaintenanceHours: number;
  projectDowntimeHours: number;
  laborConstraintHours: number;
  otherConstraintHours: number;
  customAdjustmentHours: number;
  /** Fractional, e.g. 0.9. Falls back to the dataset default when absent. */
  targetUtilizationPct?: number;
  notes?: string;
  /**
   * Derived, never read from the workbook:
   *   base - maintenance - project - labor - other + customAdjustment
   * Computed once in `normalizePlanningInput()` so no consumer re-derives it.
   */
  availableHours: number;
}

/* ------------------------------------------------------------------ */
/* Item_Line_Mapping (optional — required for capacity analysis)       */
/* ------------------------------------------------------------------ */

/**
 * Unresolved future business is often only identifiable at family or base-pack
 * level, so a mapping may be declared at any of three levels. Resolution
 * prefers the most specific match (V2 §21).
 */
export type MappingLevel = "ITEM" | "PRODUCT_FAMILY" | "BASE_PACK";

export interface ItemLineMappingRow {
  id: string;
  itemOrFamilyId: string;
  mappingLevel: MappingLevel;
  lineId: string;
  runRateUnitsPerHour: number;
  priority?: number;
  /** Fractional share of this item's volume sent to this line, e.g. 0.6. */
  allocationPct?: number;
  validFrom?: string;
  validTo?: string;
  changeoverHours?: number;
  notes?: string;
}

/* ------------------------------------------------------------------ */
/* Lead_Time_History (optional)                                        */
/* ------------------------------------------------------------------ */

export interface LeadTimeHistoryRow {
  id: string;
  materialId: string;
  materialName: string;
  supplierId?: string;
  supplierName?: string;
  poId: string;
  poDate: string;
  receiptDate: string;
  quantity: number;
  uom: string;
  materialFamily?: string;
  specificationFamily?: string;
  plant?: string;
  systemLeadTimeDays?: number;
  /**
   * The delivery date the supplier committed to. With it, a receipt can be
   * judged on time; without it, on-time delivery is not calculated at all.
   */
  promisedDate?: string;
  /**
   * Quantity actually received against `quantity` ordered. With it, a receipt
   * can be judged in full; without it, in-full is not calculated at all.
   */
  receivedQuantity?: number;
  /** Derived: receiptDate - poDate in whole days. Never asked of the planner. */
  actualLeadTimeDays: number;
}

/* ------------------------------------------------------------------ */
/* Inventory_Supply (optional)                                         */
/* ------------------------------------------------------------------ */

export interface InventorySupplyRow {
  id: string;
  materialId: string;
  plant: string;
  period: MonthKey;
  onHandQty: number;
  openPoQty: number;
  plannedReceiptQty: number;
  uom: string;
}

/* ------------------------------------------------------------------ */
/* Readiness_History (optional)                                        */
/* ------------------------------------------------------------------ */

/**
 * One weekly snapshot of how much of a season's expected business value was
 * represented in the formal plan, some number of weeks before that season's
 * production start. Measured in value rather than item count, because the pace
 * that matters is revenue at risk, not a count of SKUs. Backs the
 * Overview readiness curve's "today" trajectory and its "last year's pace"
 * comparison (V2 §39). Never fabricated: absent this sheet, the curve says so
 * rather than showing a shape nothing measured.
 */
export interface ReadinessSnapshotRow {
  id: string;
  /** Program/period key, e.g. "2027-Halloween" — same shape as planning_period. */
  seasonPeriod: PeriodKey;
  weeksBeforeProductionStart: number;
  /** 0-1. Share of that season's expected business value in the formal plan at this point. */
  representedPct: number;
  asOfDate?: string;
  notes?: string;
}

/* ------------------------------------------------------------------ */
/* Line_History (optional)                                             */
/* ------------------------------------------------------------------ */

/**
 * What a line actually did in one past month. The capacity planner's check
 * on `Line_Capacity`: the hours a line is scheduled for are not the hours it
 * delivers, and the gap is made of downtime, overtime and waiting on
 * materials that arrived late.
 */
export interface LineHistoryRow {
  id: string;
  /** `YYYY-MM`, in the past. */
  period: MonthKey;
  plant: string;
  lineId: string;
  /** Hours the line was scheduled to run. */
  scheduledHours: number;
  /** Hours it actually ran. */
  runHours: number;
  /** Breakdowns and stoppages nobody planned. */
  unplannedDowntimeHours?: number;
  /** Hours worked above the schedule. */
  overtimeHours?: number;
  /** Material deliveries that reached the line late. */
  lateArrivals?: number;
  /** Line hours lost waiting on those late deliveries. */
  lateArrivalHoursLost?: number;
  notes?: string;
}

/* ------------------------------------------------------------------ */
/* The dataset                                                         */
/* ------------------------------------------------------------------ */

export interface PlanningDataset {
  metadata: DatasetMetadata;
  businessPlans: BusinessPlanRow[];
  currentPlanItems: CurrentPlanRow[];
  historicalItems: HistoricalItemRow[];
  boms: BomRow[];
  lineCapacity: LineCapacityRow[];
  itemLineMappings: ItemLineMappingRow[];
  leadTimeHistory: LeadTimeHistoryRow[];
  inventorySupply: InventorySupplyRow[];
  readinessHistory: ReadinessSnapshotRow[];
  lineHistory: LineHistoryRow[];
}

/**
 * The loose, pre-validation shape an adapter hands to `normalizePlanningInput`.
 * Rows arrive without ids and with raw (possibly string) numerics and dates;
 * normalization is what makes them a `PlanningDataset`.
 */
export interface RawPlanningInput {
  metadata: Omit<DatasetMetadata, "capabilities">;
  businessPlans?: RawRow[];
  currentPlanItems?: RawRow[];
  historicalItems?: RawRow[];
  boms?: RawRow[];
  lineCapacity?: RawRow[];
  itemLineMappings?: RawRow[];
  leadTimeHistory?: RawRow[];
  inventorySupply?: RawRow[];
  readinessHistory?: RawRow[];
  lineHistory?: RawRow[];
}

/** One spreadsheet row: header -> cell value, before coercion. */
export type RawRow = Record<string, unknown>;
