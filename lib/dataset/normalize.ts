/**
 * The one funnel: raw rows from any adapter → a `PlanningDataset`.
 *
 * The demo generator and an uploaded workbook both arrive here as loose
 * snake_case rows. Every row is coerced, checked, and either kept or dropped
 * with a planner-readable issue — never silently defaulted into a plausible
 * number. Capabilities record which optional data actually arrived, so each
 * analysis can say "not available" rather than show zero.
 */

import type {
  CurrentPlanRow,
  DatasetCapabilities,
  HistoryEntry,
  InboundRow,
  InventoryRow,
  LocationType,
  PlanningDataset,
  RawPlanningInput,
  RawRow,
  SalesRow,
  SellingProfile,
  SkuRow,
  SkuStatus,
  StoreRow,
  TransitionReason,
  TransitionRow,
  TransitionType,
} from "@/types/dataset";
import { SKU_STATUSES, TRANSITION_REASONS, TRANSITION_TYPES } from "@/types/dataset";
import { coerceDate, coerceNumber, coercePercent, coerceString, isBlank, readCell } from "./coerce";
import { IssueCollector, type SheetName } from "./issues";

export interface NormalizeResult {
  dataset: PlanningDataset;
  collector: IssueCollector;
}

/** Row 1 is the header, so the first data row is row 2. */
const FIRST_DATA_ROW = 2;

export function normalizePlanningInput(
  input: RawPlanningInput,
  collector: IssueCollector = new IssueCollector()
): NormalizeResult {
  const stores = normalizeStores(input.stores ?? [], collector);
  const skus = normalizeSkus(input.skus ?? [], collector);
  const skuIds = new Set(skus.map((s) => s.skuId));
  const storeIds = new Set(stores.map((s) => s.storeId));
  const transitions = normalizeTransitions(input.transitions ?? [], skuIds, collector);
  const sales = normalizeSales(input.sales ?? [], skuIds, storeIds, collector);
  const inventory = normalizeInventory(input.inventory ?? [], skuIds, collector);
  const inbound = normalizeInbound(input.inbound ?? [], skuIds, collector);
  const currentPlan = normalizeCurrentPlan(input.currentPlan ?? [], skuIds, collector);
  const sellingProfiles = normalizeProfiles(input.sellingProfiles ?? [], collector);
  const history = normalizeHistory(input.history ?? [], collector);

  const transitionSkus = new Set<string>();
  for (const t of transitions) for (const id of [...t.predecessorSkuIds, ...t.successorSkuIds]) transitionSkus.add(id);
  for (const s of skus) if (s.replacementSkuId) transitionSkus.add(s.skuId).add(s.replacementSkuId);

  const capabilities: DatasetCapabilities = {
    salesHistory: sales.length > 0,
    storeLevelDemand: sales.some((r) => r.storeId !== undefined),
    storeInventory: inventory.some((r) => r.locationType === "STORE"),
    dcInventory: inventory.some((r) => r.locationType === "DC"),
    inboundSupply: inbound.length > 0,
    currentPlan: currentPlan.length > 0,
    sellingProfiles: sellingProfiles.length > 0,
    unitCosts: skus.length > 0 && skus.filter((s) => transitionSkus.size === 0 || transitionSkus.has(s.skuId)).every((s) => s.unitCost !== undefined),
  };

  const dataset: PlanningDataset = {
    metadata: { ...input.metadata, capabilities },
    stores,
    skus,
    transitions,
    sales,
    inventory,
    inbound,
    currentPlan,
    sellingProfiles,
    history,
  };

  return { dataset, collector };
}

/* ------------------------------------------------------------------ */
/* Cell helpers                                                        */
/* ------------------------------------------------------------------ */

function requireString(row: RawRow, column: string, sheet: SheetName, rowNumber: number, collector: IssueCollector) {
  const value = coerceString(readCell(row, column));
  if (value === undefined) collector.error(sheet, `missing_${column}`, `${column} is blank.`, { column, row: rowNumber });
  return value;
}

function requireNumber(
  row: RawRow,
  column: string,
  sheet: SheetName,
  rowNumber: number,
  collector: IssueCollector,
  opts: { min?: number; positive?: boolean } = {}
): number | undefined {
  const raw = readCell(row, column);
  if (isBlank(raw)) {
    collector.error(sheet, `missing_${column}`, `${column} is blank.`, { column, row: rowNumber });
    return undefined;
  }
  const value = coerceNumber(raw);
  if (value === undefined) {
    collector.error(sheet, `invalid_${column}`, `${column} is not a number.`, { column, row: rowNumber });
    return undefined;
  }
  if (opts.positive && value <= 0) {
    collector.error(sheet, `nonpositive_${column}`, `${column} must be greater than zero.`, { column, row: rowNumber });
    return undefined;
  }
  if (opts.min !== undefined && value < opts.min) {
    collector.error(sheet, `negative_${column}`, `${column} cannot be below ${opts.min}.`, { column, row: rowNumber });
    return undefined;
  }
  return value;
}

function requireDate(row: RawRow, column: string, sheet: SheetName, rowNumber: number, collector: IssueCollector) {
  const raw = readCell(row, column);
  if (isBlank(raw)) {
    collector.error(sheet, `missing_${column}`, `${column} is blank.`, { column, row: rowNumber });
    return undefined;
  }
  const value = coerceDate(raw);
  if (value === undefined) {
    collector.error(sheet, `invalid_${column}`, `${column} is not a readable date. Use YYYY-MM-DD.`, { column, row: rowNumber });
  }
  return value;
}

function optionalNumber(row: RawRow, column: string, sheet: SheetName, rowNumber: number, collector: IssueCollector) {
  const raw = readCell(row, column);
  if (isBlank(raw)) return undefined;
  const value = coerceNumber(raw);
  if (value === undefined || value < 0) {
    collector.warn(sheet, `invalid_${column}`, `${column} is not a usable number and was ignored.`, { column, row: rowNumber });
    return undefined;
  }
  return value;
}

function optionalPercent(row: RawRow, column: string, sheet: SheetName, rowNumber: number, collector: IssueCollector) {
  const raw = readCell(row, column);
  if (isBlank(raw)) return undefined;
  const value = coercePercent(raw);
  if (value === undefined || value < 0 || value > 1) {
    collector.warn(sheet, `invalid_${column}`, `${column} should be between 0% and 100%; it was ignored.`, { column, row: rowNumber });
    return undefined;
  }
  return value;
}

function optionalDate(row: RawRow, column: string, sheet: SheetName, rowNumber: number, collector: IssueCollector) {
  const raw = readCell(row, column);
  if (isBlank(raw)) return undefined;
  const value = coerceDate(raw);
  if (value === undefined) {
    collector.warn(sheet, `invalid_${column}`, `${column} is not a readable date and was ignored. Use YYYY-MM-DD.`, { column, row: rowNumber });
  }
  return value;
}

function optionalEnum<T extends string>(
  row: RawRow,
  column: string,
  allowed: readonly T[],
  sheet: SheetName,
  rowNumber: number,
  collector: IssueCollector
): T | undefined {
  const raw = coerceString(readCell(row, column));
  if (raw === undefined) return undefined;
  const value = raw.toUpperCase().replace(/[\s-]+/g, "_") as T;
  if (!allowed.includes(value)) {
    collector.warn(sheet, `invalid_${column}`, `${column} should be one of ${allowed.join(", ")}; it was ignored.`, { column, row: rowNumber });
    return undefined;
  }
  return value;
}

export function coerceBoolean(value: unknown): boolean | undefined {
  if (isBlank(value)) return undefined;
  if (typeof value === "boolean") return value;
  const text = String(value).trim().toLowerCase();
  if (["y", "yes", "true", "1", "x"].includes(text)) return true;
  if (["n", "no", "false", "0"].includes(text)) return false;
  return undefined;
}

/** "CS-1048, CS-1049" / "CS-1048 + CS-1049" / "CS-1048;CS-1049". */
export function splitSkuList(value: unknown): string[] {
  const text = coerceString(value);
  if (!text) return [];
  return [...new Set(text.split(/[,;+|/]|\s{2,}/).map((s) => s.trim()).filter(Boolean))];
}

/** "SP-1:60%, SP-2:40%" → { SP-1: 0.6, SP-2: 0.4 }. */
export function parseSplit(value: unknown): Record<string, number> | undefined {
  const text = coerceString(value);
  if (!text) return undefined;
  const out: Record<string, number> = {};
  for (const part of text.split(/[,;]/)) {
    const [sku, share] = part.split(":").map((s) => s.trim());
    const pct = coercePercent(share);
    if (sku && pct !== undefined) out[sku] = pct;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/* ------------------------------------------------------------------ */
/* Sheets                                                              */
/* ------------------------------------------------------------------ */

function normalizeStores(rows: RawRow[], collector: IssueCollector): StoreRow[] {
  const sheet: SheetName = "Stores";
  const out: StoreRow[] = [];
  const seen = new Set<string>();
  rows.forEach((row, i) => {
    const n = i + FIRST_DATA_ROW;
    const storeId = requireString(row, "store_id", sheet, n, collector);
    const storeName = requireString(row, "store_name", sheet, n, collector);
    if (!storeId || !storeName) return;
    if (seen.has(storeId)) {
      collector.warn(sheet, "duplicate_store", "A store appears more than once; the first row was kept.", { column: "store_id", row: n });
      return;
    }
    seen.add(storeId);
    out.push({
      storeId,
      storeName,
      city: coerceString(readCell(row, "city")),
      state: coerceString(readCell(row, "state")),
      region: coerceString(readCell(row, "region")),
      cluster: coerceString(readCell(row, "cluster")),
    });
  });
  return out;
}

function normalizeSkus(rows: RawRow[], collector: IssueCollector): SkuRow[] {
  const sheet: SheetName = "SKU_Master";
  const out: SkuRow[] = [];
  const seen = new Set<string>();
  rows.forEach((row, i) => {
    const n = i + FIRST_DATA_ROW;
    const skuId = requireString(row, "sku_id", sheet, n, collector);
    const skuName = requireString(row, "sku_name", sheet, n, collector);
    const productFamily = requireString(row, "product_family", sheet, n, collector);
    const category = requireString(row, "category", sheet, n, collector);
    const rawStatus = coerceString(readCell(row, "status"));
    const status = (rawStatus?.toUpperCase() ?? "") as SkuStatus;
    if (!SKU_STATUSES.includes(status)) {
      collector.error(sheet, "invalid_status", `status should be one of ${SKU_STATUSES.join(", ")}.`, { column: "status", row: n });
      return;
    }
    if (!skuId || !skuName || !productFamily || !category) return;
    if (seen.has(skuId)) {
      collector.error(sheet, "duplicate_sku", "A SKU appears more than once; the first row was kept.", { column: "sku_id", row: n });
      return;
    }
    seen.add(skuId);
    const leadTime = optionalNumber(row, "lead_time_days", sheet, n, collector);
    out.push({
      skuId,
      skuName,
      productFamily,
      category,
      status,
      program: coerceString(readCell(row, "program")),
      brand: coerceString(readCell(row, "brand")),
      sizeRange: coerceString(readCell(row, "size_range")),
      color: coerceString(readCell(row, "color")),
      vendor: coerceString(readCell(row, "vendor")),
      packaging: coerceString(readCell(row, "packaging")),
      launchDate: optionalDate(row, "launch_date", sheet, n, collector),
      discontinueDate: optionalDate(row, "discontinue_date", sheet, n, collector),
      replacementSkuId: coerceString(readCell(row, "replacement_sku_id")),
      unitCost: optionalNumber(row, "unit_cost", sheet, n, collector),
      retailPrice: optionalNumber(row, "retail_price", sheet, n, collector),
      leadTimeDays: leadTime === undefined ? undefined : Math.round(leadTime),
    });
  });
  // A replacement that points nowhere is dropped, not guessed at.
  const ids = new Set(out.map((s) => s.skuId));
  for (const sku of out) {
    if (sku.replacementSkuId && !ids.has(sku.replacementSkuId)) {
      collector.warn(sheet, "unknown_replacement", "replacement_sku_id names a SKU that is not in SKU_Master; it was ignored.", { column: "replacement_sku_id" });
      sku.replacementSkuId = undefined;
    }
  }
  return out;
}

function inferType(pred: number, succ: number): TransitionType {
  if (pred === 0) return "NEW_PRODUCT";
  if (succ === 0) return "NO_SUCCESSOR";
  if (pred > 1 && succ === 1) return "MANY_TO_ONE";
  if (pred === 1 && succ > 1) return "ONE_TO_MANY";
  return "ONE_TO_ONE";
}

function normalizeTransitions(rows: RawRow[], skuIds: Set<string>, collector: IssueCollector): TransitionRow[] {
  const sheet: SheetName = "SKU_Transitions";
  const out: TransitionRow[] = [];
  const seen = new Set<string>();
  rows.forEach((row, i) => {
    const n = i + FIRST_DATA_ROW;
    const transitionId = requireString(row, "transition_id", sheet, n, collector);
    const transitionName = requireString(row, "transition_name", sheet, n, collector);
    if (!transitionId || !transitionName) return;
    if (seen.has(transitionId)) {
      collector.error(sheet, "duplicate_transition", "A transition_id appears more than once; the first row was kept.", { column: "transition_id", row: n });
      return;
    }
    const known = (ids: string[], column: string) => {
      const kept = ids.filter((id) => skuIds.has(id));
      if (kept.length < ids.length) {
        collector.warn(sheet, `unknown_sku_${column}`, `${column} names a SKU that is not in SKU_Master; it was left out.`, { column, row: n });
      }
      return kept;
    };
    const predecessorSkuIds = known(splitSkuList(readCell(row, "predecessor_sku_ids")), "predecessor_sku_ids");
    const successorSkuIds = known(splitSkuList(readCell(row, "successor_sku_ids")), "successor_sku_ids");
    if (predecessorSkuIds.length + successorSkuIds.length === 0) {
      collector.error(sheet, "empty_transition", "A transition needs at least one known SKU.", { row: n });
      return;
    }
    seen.add(transitionId);
    const stated = optionalEnum(row, "transition_type", TRANSITION_TYPES, sheet, n, collector);
    const inferred = inferType(predecessorSkuIds.length, successorSkuIds.length);
    if (stated && stated !== inferred) {
      collector.warn(sheet, "type_mismatch", "transition_type does not match the number of SKUs given; the SKU counts were used.", { column: "transition_type", row: n });
    }
    out.push({
      transitionId,
      transitionName,
      predecessorSkuIds,
      successorSkuIds,
      transitionType: inferred,
      reason: optionalEnum<TransitionReason>(row, "reason", TRANSITION_REASONS, sheet, n, collector),
      startDate: optionalDate(row, "start_date", sheet, n, collector),
      targetCompletionDate: optionalDate(row, "target_completion_date", sheet, n, collector),
      substitutabilityPct: optionalPercent(row, "substitutability_pct", sheet, n, collector),
      transferredDemandPct: optionalPercent(row, "transferred_demand_pct", sheet, n, collector),
      successorSplit: parseSplit(readCell(row, "successor_split")),
      safetyStockWeeks: optionalNumber(row, "safety_stock_weeks", sheet, n, collector),
      plannerConfirmed: coerceBoolean(readCell(row, "planner_confirmed")) ?? false,
      source: "PLANNER",
      closed: coerceBoolean(readCell(row, "closed")) ?? undefined,
    });
  });
  return out;
}

function normalizeSales(rows: RawRow[], skuIds: Set<string>, storeIds: Set<string>, collector: IssueCollector): SalesRow[] {
  const sheet: SheetName = "Sales_History";
  const out: SalesRow[] = [];
  rows.forEach((row, i) => {
    const n = i + FIRST_DATA_ROW;
    const skuId = requireString(row, "sku_id", sheet, n, collector);
    const periodStart = requireDate(row, "period_start", sheet, n, collector);
    const periodEnd = requireDate(row, "period_end", sheet, n, collector);
    const units = requireNumber(row, "units_sold", sheet, n, collector, { min: 0 });
    if (!skuId || !periodStart || !periodEnd || units === undefined) return;
    if (!skuIds.has(skuId)) {
      collector.warn(sheet, "unknown_sku", "Sales for a SKU that is not in SKU_Master were ignored.", { column: "sku_id", row: n });
      return;
    }
    if (periodEnd < periodStart) {
      collector.error(sheet, "reversed_period", "period_end is before period_start.", { row: n });
      return;
    }
    const storeId = coerceString(readCell(row, "store_id"));
    if (storeId && storeIds.size > 0 && !storeIds.has(storeId)) {
      collector.warn(sheet, "unknown_store", "Sales for a store that is not in Stores were ignored.", { column: "store_id", row: n });
      return;
    }
    out.push({ skuId, storeId, periodStart, periodEnd, units, value: coerceNumber(readCell(row, "sales_value")) });
  });
  return out;
}

function locationType(row: RawRow, fallback: LocationType | undefined): LocationType | undefined {
  const raw = coerceString(readCell(row, "location_type"))?.toUpperCase();
  if (raw === "STORE" || raw === "DC") return raw;
  return fallback;
}

function normalizeInventory(rows: RawRow[], skuIds: Set<string>, collector: IssueCollector): InventoryRow[] {
  const sheet: SheetName = "Inventory";
  const out: InventoryRow[] = [];
  rows.forEach((row, i) => {
    const n = i + FIRST_DATA_ROW;
    const skuId = requireString(row, "sku_id", sheet, n, collector);
    const locationId = requireString(row, "location_id", sheet, n, collector);
    const type = locationType(row, undefined);
    if (!type) collector.error(sheet, "invalid_location_type", "location_type should be STORE or DC.", { column: "location_type", row: n });
    const onHand = requireNumber(row, "on_hand", sheet, n, collector, { min: 0 });
    if (!skuId || !locationId || !type || onHand === undefined) return;
    if (!skuIds.has(skuId)) {
      collector.warn(sheet, "unknown_sku", "Stock for a SKU that is not in SKU_Master was ignored.", { column: "sku_id", row: n });
      return;
    }
    const allocated = Math.min(onHand, optionalNumber(row, "allocated", sheet, n, collector) ?? 0);
    const available = optionalNumber(row, "available", sheet, n, collector) ?? Math.max(0, onHand - allocated);
    out.push({
      snapshotDate: optionalDate(row, "snapshot_date", sheet, n, collector) ?? "",
      skuId,
      locationId,
      locationType: type,
      onHand,
      allocated,
      available: Math.min(onHand, available),
    });
  });
  return out;
}

function normalizeInbound(rows: RawRow[], skuIds: Set<string>, collector: IssueCollector): InboundRow[] {
  const sheet: SheetName = "Inbound_Supply";
  const out: InboundRow[] = [];
  rows.forEach((row, i) => {
    const n = i + FIRST_DATA_ROW;
    const skuId = requireString(row, "sku_id", sheet, n, collector);
    const locationId = requireString(row, "location_id", sheet, n, collector);
    const quantity = requireNumber(row, "quantity", sheet, n, collector, { positive: true });
    const expectedReceiptDate = requireDate(row, "expected_receipt_date", sheet, n, collector);
    if (!skuId || !locationId || quantity === undefined || !expectedReceiptDate) return;
    if (!skuIds.has(skuId)) {
      collector.warn(sheet, "unknown_sku", "Inbound for a SKU that is not in SKU_Master was ignored.", { column: "sku_id", row: n });
      return;
    }
    const purchaseOrderId = coerceString(readCell(row, "purchase_order_id"));
    out.push({
      id: purchaseOrderId ? `${purchaseOrderId}:${skuId}:${n}` : `in_${n}`,
      skuId,
      locationId,
      locationType: locationType(row, "DC") ?? "DC",
      quantity,
      expectedReceiptDate,
      source: coerceString(readCell(row, "source")),
      purchaseOrderId,
    });
  });
  return out;
}

function normalizeCurrentPlan(rows: RawRow[], skuIds: Set<string>, collector: IssueCollector): CurrentPlanRow[] {
  const sheet: SheetName = "Current_Plan";
  const out: CurrentPlanRow[] = [];
  rows.forEach((row, i) => {
    const n = i + FIRST_DATA_ROW;
    const skuId = requireString(row, "sku_id", sheet, n, collector);
    const horizonStart = requireDate(row, "horizon_start", sheet, n, collector);
    const horizonEnd = requireDate(row, "horizon_end", sheet, n, collector);
    const forecastUnits = requireNumber(row, "forecast_units", sheet, n, collector, { min: 0 });
    if (!skuId || !horizonStart || !horizonEnd || forecastUnits === undefined) return;
    if (!skuIds.has(skuId)) {
      collector.warn(sheet, "unknown_sku", "A plan row for a SKU that is not in SKU_Master was ignored.", { column: "sku_id", row: n });
      return;
    }
    out.push({
      skuId,
      horizonStart,
      horizonEnd,
      forecastUnits,
      plannedReplenishmentUnits: optionalNumber(row, "planned_replenishment_units", sheet, n, collector),
    });
  });
  return out;
}

function normalizeProfiles(rows: RawRow[], collector: IssueCollector): SellingProfile[] {
  const sheet: SheetName = "Selling_Profiles";
  const byId = new Map<string, SellingProfile & { skuSet: Set<string>; storeSet: Set<string> }>();
  rows.forEach((row, i) => {
    const n = i + FIRST_DATA_ROW;
    const id = requireString(row, "profile_id", sheet, n, collector);
    const skuId = requireString(row, "sku_id", sheet, n, collector);
    const storeId = requireString(row, "store_id", sheet, n, collector);
    if (!id || !skuId || !storeId) return;
    let profile = byId.get(id);
    if (!profile) {
      profile = { id, name: coerceString(readCell(row, "profile_name")) ?? id, skuIds: [], storeIds: [], skuSet: new Set(), storeSet: new Set() };
      byId.set(id, profile);
    }
    profile.skuSet.add(skuId);
    profile.storeSet.add(storeId);
  });
  return [...byId.values()].map((p) => ({ id: p.id, name: p.name, skuIds: [...p.skuSet], storeIds: [...p.storeSet] }));
}

function normalizeHistory(rows: RawRow[], collector: IssueCollector): HistoryEntry[] {
  const sheet: SheetName = "Transition_History";
  const out: HistoryEntry[] = [];
  rows.forEach((row, i) => {
    const n = i + FIRST_DATA_ROW;
    const date = requireDate(row, "date", sheet, n, collector);
    const transitionId = requireString(row, "transition_id", sheet, n, collector);
    const text = requireString(row, "note", sheet, n, collector);
    if (!date || !transitionId || !text) return;
    out.push({ id: `h_${n}`, date, transitionId, text, actor: coerceString(readCell(row, "actor")) ?? "Planner" });
  });
  return out;
}
