/**
 * `normalizePlanningInput()` — the one funnel every input adapter passes
 * through (V2 §31).
 *
 * The seeded demo generator and the uploaded workbook both hand raw rows to
 * this function and get back a `PlanningDataset`. Nothing downstream can tell
 * which adapter produced it, which is what guarantees demo and uploaded data
 * get the identical product experience (V2 §67).
 *
 * Rows that cannot be made valid are dropped and reported, never silently
 * defaulted — a fabricated number is worse than a missing one.
 */

import type {
  BomRow,
  BusinessPlanRow,
  ComponentType,
  CurrentPlanRow,
  DatasetCapabilities,
  HistoricalItemRow,
  InventorySupplyRow,
  ItemLineMappingRow,
  LeadTimeHistoryRow,
  LineCapacityRow,
  LineHistoryRow,
  MappingLevel,
  PlanningDataset,
  RawPlanningInput,
  RawRow,
  ReadinessSnapshotRow,
} from "@/types/dataset";
import type { DateRange } from "@/types/shared";
import { COMPONENT_TYPES, MAPPING_LEVELS } from "@/lib/excel/schema";
import { coerceDate, coerceNumber, coercePercent, coerceString, isBlank, readCell } from "./coerce";
import { IssueCollector, type SheetName } from "./issues";

export interface NormalizeResult {
  dataset: PlanningDataset;
  collector: IssueCollector;
}

/**
 * Row numbers are reported as they appear in the worksheet: row 1 is the
 * header, so the first data row is row 2.
 */
const FIRST_DATA_ROW = 2;

export function normalizePlanningInput(
  input: RawPlanningInput,
  collector: IssueCollector = new IssueCollector()
): NormalizeResult {
  const businessPlans = normalizeBusinessPlans(input.businessPlans ?? [], collector);
  const currentPlanItems = normalizeCurrentPlan(input.currentPlanItems ?? [], collector);
  const historicalItems = normalizeHistoricalItems(input.historicalItems ?? [], collector);
  const boms = normalizeBoms(input.boms ?? [], collector);
  const lineCapacity = normalizeLineCapacity(input.lineCapacity ?? [], collector);
  const itemLineMappings = normalizeItemLineMappings(input.itemLineMappings ?? [], collector);
  const leadTimeHistory = normalizeLeadTimeHistory(input.leadTimeHistory ?? [], collector);
  const inventorySupply = normalizeInventorySupply(input.inventorySupply ?? [], collector);
  const readinessHistory = normalizeReadinessHistory(input.readinessHistory ?? [], collector);
  const lineHistory = normalizeLineHistory(input.lineHistory ?? [], collector);

  const capabilities: DatasetCapabilities = {
    reconciliation:
      businessPlans.length > 0 && currentPlanItems.length > 0 && historicalItems.length > 0,
    capacity: lineCapacity.length > 0 && itemLineMappings.length > 0,
    materials: boms.length > 0,
    leadTimeAnalysis: leadTimeHistory.length > 0,
    netRequirements: inventorySupply.length > 0,
    readinessHistory: readinessHistory.length > 0,
    lineHistory: lineHistory.length > 0,
  };

  const dataset: PlanningDataset = {
    metadata: { ...input.metadata, capabilities },
    businessPlans,
    currentPlanItems,
    historicalItems,
    boms,
    lineCapacity,
    itemLineMappings,
    leadTimeHistory,
    inventorySupply,
    readinessHistory,
    lineHistory,
  };

  crossReference(dataset, collector);

  return { dataset, collector };
}

/* ------------------------------------------------------------------ */
/* Per-sheet normalizers                                               */
/* ------------------------------------------------------------------ */

/**
 * Pulls a required string, reporting and rejecting the row when it is blank.
 * Returns undefined to signal "drop this row".
 */
function requireString(
  row: RawRow,
  column: string,
  sheet: SheetName,
  rowNumber: number,
  collector: IssueCollector
): string | undefined {
  const value = coerceString(readCell(row, column));
  if (value === undefined) {
    collector.error(sheet, `missing_${column}`, `${column} is blank.`, { column, row: rowNumber });
    return undefined;
  }
  return value;
}

/**
 * Pulls a required number, reporting when it is blank, unparseable, or
 * violates the column's sign constraint.
 */
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
    collector.error(sheet, `invalid_${column}`, `${column} is not a number.`, {
      column,
      row: rowNumber,
    });
    return undefined;
  }
  if (opts.positive && value <= 0) {
    collector.error(sheet, `nonpositive_${column}`, `${column} must be greater than zero.`, {
      column,
      row: rowNumber,
    });
    return undefined;
  }
  if (opts.min !== undefined && value < opts.min) {
    collector.error(sheet, `negative_${column}`, `${column} cannot be below ${opts.min}.`, {
      column,
      row: rowNumber,
    });
    return undefined;
  }
  return value;
}

/**
 * Reads an optional non-negative number. A present-but-unparseable value is a
 * warning and falls back to the default, because an optional deduction being
 * unreadable should not cost the planner the whole row.
 */
function optionalNumber(
  row: RawRow,
  column: string,
  sheet: SheetName,
  rowNumber: number,
  collector: IssueCollector,
  fallback: number
): number {
  const raw = readCell(row, column);
  if (isBlank(raw)) return fallback;
  const value = coerceNumber(raw);
  if (value === undefined) {
    collector.warn(sheet, `invalid_${column}`, `${column} is not a number and was ignored.`, {
      column,
      row: rowNumber,
    });
    return fallback;
  }
  return value;
}

function optionalDate(
  row: RawRow,
  column: string,
  sheet: SheetName,
  rowNumber: number,
  collector: IssueCollector
): string | undefined {
  const raw = readCell(row, column);
  if (isBlank(raw)) return undefined;
  const value = coerceDate(raw);
  if (value === undefined) {
    collector.warn(
      sheet,
      `invalid_${column}`,
      `${column} is not a readable date and was ignored. Use YYYY-MM-DD.`,
      { column, row: rowNumber }
    );
    return undefined;
  }
  return value;
}

/** A window is only usable when both ends parsed and start is not after end. */
function windowFrom(
  start: string | undefined,
  end: string | undefined,
  sheet: SheetName,
  rowNumber: number,
  collector: IssueCollector,
  label: string
): DateRange | undefined {
  if (!start || !end) return undefined;
  if (start > end) {
    collector.warn(sheet, `reversed_${label}`, `${label} ends before it starts and was ignored.`, {
      row: rowNumber,
    });
    return undefined;
  }
  return { start, end };
}

function normalizeBusinessPlans(rows: RawRow[], collector: IssueCollector): BusinessPlanRow[] {
  const sheet: SheetName = "Business_Plan";
  const out: BusinessPlanRow[] = [];
  rows.forEach((row, i) => {
    const rowNumber = i + FIRST_DATA_ROW;
    const planningPeriod = requireString(row, "planning_period", sheet, rowNumber, collector);
    const eventOrProgram = requireString(row, "event_or_program", sheet, rowNumber, collector);
    const businessUnit = requireString(row, "business_unit", sheet, rowNumber, collector);
    const brand = requireString(row, "brand", sheet, rowNumber, collector);
    const targetValue = requireNumber(row, "target_value", sheet, rowNumber, collector, { min: 0 });
    if (!planningPeriod || !eventOrProgram || !businessUnit || !brand || targetValue === undefined) return;

    out.push({
      id: `bp_${i}`,
      planningPeriod,
      eventOrProgram,
      businessUnit,
      brand,
      targetValue,
      targetUnits: coerceNumber(readCell(row, "target_units")),
      customer: coerceString(readCell(row, "customer")),
      channel: coerceString(readCell(row, "channel")),
      productFamily: coerceString(readCell(row, "product_family")),
      growthPct: coercePercent(readCell(row, "growth_pct")),
      currency: coerceString(readCell(row, "currency")),
      notes: coerceString(readCell(row, "notes")),
    });
  });
  return out;
}

function normalizeCurrentPlan(rows: RawRow[], collector: IssueCollector): CurrentPlanRow[] {
  const sheet: SheetName = "Current_Plan";
  const out: CurrentPlanRow[] = [];
  const seen = new Map<string, number>();

  rows.forEach((row, i) => {
    const rowNumber = i + FIRST_DATA_ROW;
    const planningPeriod = requireString(row, "planning_period", sheet, rowNumber, collector);
    const itemId = requireString(row, "item_id", sheet, rowNumber, collector);
    const itemName = requireString(row, "item_name", sheet, rowNumber, collector);
    const brand = requireString(row, "brand", sheet, rowNumber, collector);
    const productFamily = requireString(row, "product_family", sheet, rowNumber, collector);
    const plannedUnits = requireNumber(row, "planned_units", sheet, rowNumber, collector, { min: 0 });
    if (!planningPeriod || !itemId || !itemName || !brand || !productFamily || plannedUnits === undefined)
      return;

    // One item may legitimately appear in several periods; the same item twice
    // in the same period would double-count the formal plan.
    const key = `${planningPeriod}::${itemId}`;
    const firstSeen = seen.get(key);
    if (firstSeen !== undefined) {
      collector.error(
        sheet,
        "duplicate_item_period",
        `The same item appears more than once for one planning period, which would double-count the formal plan.`,
        { column: "item_id", row: rowNumber }
      );
      return;
    }
    seen.set(key, rowNumber);

    out.push({
      id: `cp_${i}`,
      planningPeriod,
      itemId,
      itemName,
      brand,
      productFamily,
      plannedUnits,
      eventOrProgram: coerceString(readCell(row, "event_or_program")),
      customer: coerceString(readCell(row, "customer")),
      channel: coerceString(readCell(row, "channel")),
      plannedValue: coerceNumber(readCell(row, "planned_value")),
      currency: coerceString(readCell(row, "currency")),
      plant: coerceString(readCell(row, "plant")),
      primaryLineId: coerceString(readCell(row, "primary_line_id")),
      productionWindow: windowFrom(
        optionalDate(row, "production_start_date", sheet, rowNumber, collector),
        optionalDate(row, "production_end_date", sheet, rowNumber, collector),
        sheet,
        rowNumber,
        collector,
        "production window"
      ),
      salesWindow: windowFrom(
        optionalDate(row, "sales_start_date", sheet, rowNumber, collector),
        optionalDate(row, "sales_end_date", sheet, rowNumber, collector),
        sheet,
        rowNumber,
        collector,
        "sales window"
      ),
      status: coerceString(readCell(row, "status")),
    });
  });
  return out;
}

function normalizeHistoricalItems(rows: RawRow[], collector: IssueCollector): HistoricalItemRow[] {
  const sheet: SheetName = "Historical_Items";
  const out: HistoricalItemRow[] = [];
  rows.forEach((row, i) => {
    const rowNumber = i + FIRST_DATA_ROW;
    const historicalPeriod = requireString(row, "historical_period", sheet, rowNumber, collector);
    const itemId = requireString(row, "item_id", sheet, rowNumber, collector);
    const itemName = requireString(row, "item_name", sheet, rowNumber, collector);
    const brand = requireString(row, "brand", sheet, rowNumber, collector);
    const productFamily = requireString(row, "product_family", sheet, rowNumber, collector);
    const actualUnits = requireNumber(row, "actual_units", sheet, rowNumber, collector, { min: 0 });
    if (!historicalPeriod || !itemId || !itemName || !brand || !productFamily || actualUnits === undefined)
      return;

    out.push({
      id: `hi_${i}`,
      historicalPeriod,
      itemId,
      itemName,
      brand,
      productFamily,
      actualUnits,
      eventOrProgram: coerceString(readCell(row, "event_or_program")),
      customer: coerceString(readCell(row, "customer")),
      channel: coerceString(readCell(row, "channel")),
      packFormat: coerceString(readCell(row, "pack_format")),
      packSize: coerceNumber(readCell(row, "pack_size")),
      sizeUom: coerceString(readCell(row, "size_uom")),
      flavorOrVariant: coerceString(readCell(row, "flavor_or_variant")),
      formulaFamily: coerceString(readCell(row, "formula_family")),
      packagingType: coerceString(readCell(row, "packaging_type")),
      basePack: coerceString(readCell(row, "base_pack")),
      actualValue: coerceNumber(readCell(row, "actual_value")),
      currency: coerceString(readCell(row, "currency")),
      plant: coerceString(readCell(row, "plant")),
      primaryLineId: coerceString(readCell(row, "primary_line_id")),
      productionWindow: windowFrom(
        optionalDate(row, "production_start_date", sheet, rowNumber, collector),
        optionalDate(row, "production_end_date", sheet, rowNumber, collector),
        sheet,
        rowNumber,
        collector,
        "production window"
      ),
      salesWindow: windowFrom(
        optionalDate(row, "sales_start_date", sheet, rowNumber, collector),
        optionalDate(row, "sales_end_date", sheet, rowNumber, collector),
        sheet,
        rowNumber,
        collector,
        "sales window"
      ),
      status: coerceString(readCell(row, "status")),
    });
  });
  return out;
}

function normalizeBoms(rows: RawRow[], collector: IssueCollector): BomRow[] {
  const sheet: SheetName = "BOM";
  const out: BomRow[] = [];
  rows.forEach((row, i) => {
    const rowNumber = i + FIRST_DATA_ROW;
    const parentItemId = requireString(row, "parent_item_id", sheet, rowNumber, collector);
    const componentId = requireString(row, "component_id", sheet, rowNumber, collector);
    const componentName = requireString(row, "component_name", sheet, rowNumber, collector);
    const quantityPerParent = requireNumber(row, "quantity_per_parent", sheet, rowNumber, collector, {
      positive: true,
    });
    const uom = requireString(row, "uom", sheet, rowNumber, collector);
    if (!parentItemId || !componentId || !componentName || quantityPerParent === undefined || !uom)
      return;

    const rawType = coerceString(readCell(row, "component_type"))?.toUpperCase().replace(/[\s-]/g, "_");
    if (!rawType) {
      collector.error(sheet, "missing_component_type", "component_type is blank.", {
        column: "component_type",
        row: rowNumber,
      });
      return;
    }
    if (!(COMPONENT_TYPES as readonly string[]).includes(rawType)) {
      collector.error(
        sheet,
        "invalid_component_type",
        `component_type must be one of ${COMPONENT_TYPES.join(", ")}.`,
        { column: "component_type", row: rowNumber }
      );
      return;
    }

    out.push({
      id: `bom_${i}`,
      parentItemId,
      componentId,
      componentName,
      componentType: rawType as ComponentType,
      quantityPerParent,
      uom,
      componentFamily: coerceString(readCell(row, "component_family")),
      validFrom: optionalDate(row, "valid_from", sheet, rowNumber, collector),
      validTo: optionalDate(row, "valid_to", sheet, rowNumber, collector),
      scrapPct: coercePercent(readCell(row, "scrap_pct")),
      planningStatus: coerceString(readCell(row, "planning_status")),
      supplierId: coerceString(readCell(row, "supplier_id")),
      notes: coerceString(readCell(row, "notes")),
    });
  });
  return out;
}

function normalizeLineCapacity(rows: RawRow[], collector: IssueCollector): LineCapacityRow[] {
  const sheet: SheetName = "Line_Capacity";
  const out: LineCapacityRow[] = [];
  const seen = new Set<string>();

  rows.forEach((row, i) => {
    const rowNumber = i + FIRST_DATA_ROW;
    const period = requireString(row, "period", sheet, rowNumber, collector);
    const plant = requireString(row, "plant", sheet, rowNumber, collector);
    const lineId = requireString(row, "line_id", sheet, rowNumber, collector);
    const lineName = requireString(row, "line_name", sheet, rowNumber, collector);
    const baseCalendarHours = requireNumber(row, "base_calendar_hours", sheet, rowNumber, collector, {
      min: 0,
    });
    if (!period || !plant || !lineId || !lineName || baseCalendarHours === undefined) return;

    if (!/^\d{4}-\d{2}$/.test(period)) {
      collector.error(
        sheet,
        "invalid_period",
        "period must be a calendar month written as YYYY-MM, for example 2027-06.",
        { column: "period", row: rowNumber }
      );
      return;
    }

    const key = `${lineId}::${period}`;
    if (seen.has(key)) {
      collector.error(
        sheet,
        "duplicate_line_period",
        "The same line appears twice for one month. Keep one row per line per month.",
        { column: "line_id", row: rowNumber }
      );
      return;
    }
    seen.add(key);

    const plannedMaintenanceHours = optionalNumber(row, "planned_maintenance_hours", sheet, rowNumber, collector, 0);
    const projectDowntimeHours = optionalNumber(row, "project_downtime_hours", sheet, rowNumber, collector, 0);
    const laborConstraintHours = optionalNumber(row, "labor_constraint_hours", sheet, rowNumber, collector, 0);
    const otherConstraintHours = optionalNumber(row, "other_constraint_hours", sheet, rowNumber, collector, 0);
    const customAdjustmentHours = optionalNumber(row, "custom_adjustment_hours", sheet, rowNumber, collector, 0);

    // The V2 §20 formula. Adjustments are added back; everything else subtracts.
    const availableHours =
      baseCalendarHours -
      plannedMaintenanceHours -
      projectDowntimeHours -
      laborConstraintHours -
      otherConstraintHours +
      customAdjustmentHours;

    if (availableHours < 0) {
      collector.error(
        sheet,
        "negative_available_hours",
        "Deductions exceed the base calendar hours, leaving negative available hours.",
        { column: "base_calendar_hours", row: rowNumber }
      );
      return;
    }

    out.push({
      id: `lc_${i}`,
      period,
      plant,
      lineId,
      lineName,
      baseCalendarHours,
      plannedMaintenanceHours,
      projectDowntimeHours,
      laborConstraintHours,
      otherConstraintHours,
      customAdjustmentHours,
      targetUtilizationPct: coercePercent(readCell(row, "target_utilization_pct")),
      notes: coerceString(readCell(row, "notes")),
      availableHours,
    });
  });
  return out;
}

function normalizeItemLineMappings(rows: RawRow[], collector: IssueCollector): ItemLineMappingRow[] {
  const sheet: SheetName = "Item_Line_Mapping";
  const out: ItemLineMappingRow[] = [];
  rows.forEach((row, i) => {
    const rowNumber = i + FIRST_DATA_ROW;
    const itemOrFamilyId = requireString(row, "item_or_family_id", sheet, rowNumber, collector);
    const lineId = requireString(row, "line_id", sheet, rowNumber, collector);
    const runRateUnitsPerHour = requireNumber(row, "run_rate_units_per_hour", sheet, rowNumber, collector, {
      positive: true,
    });
    if (!itemOrFamilyId || !lineId || runRateUnitsPerHour === undefined) return;

    const rawLevel = coerceString(readCell(row, "mapping_level"))?.toUpperCase().replace(/[\s-]/g, "_");
    if (!rawLevel) {
      collector.error(sheet, "missing_mapping_level", "mapping_level is blank.", {
        column: "mapping_level",
        row: rowNumber,
      });
      return;
    }
    if (!(MAPPING_LEVELS as readonly string[]).includes(rawLevel)) {
      collector.error(
        sheet,
        "invalid_mapping_level",
        `mapping_level must be one of ${MAPPING_LEVELS.join(", ")}.`,
        { column: "mapping_level", row: rowNumber }
      );
      return;
    }

    const allocationPct = coercePercent(readCell(row, "allocation_pct"));
    if (allocationPct !== undefined && allocationPct > 1) {
      collector.error(sheet, "allocation_over_100", "allocation_pct is above 100%.", {
        column: "allocation_pct",
        row: rowNumber,
      });
      return;
    }

    out.push({
      id: `ilm_${i}`,
      itemOrFamilyId,
      mappingLevel: rawLevel as MappingLevel,
      lineId,
      runRateUnitsPerHour,
      priority: coerceNumber(readCell(row, "priority")),
      allocationPct,
      validFrom: optionalDate(row, "valid_from", sheet, rowNumber, collector),
      validTo: optionalDate(row, "valid_to", sheet, rowNumber, collector),
      changeoverHours: coerceNumber(readCell(row, "changeover_hours")),
      notes: coerceString(readCell(row, "notes")),
    });
  });

  // Allocation shares that overshoot would inflate total line hours.
  const byItem = new Map<string, number>();
  for (const m of out) {
    if (m.allocationPct === undefined) continue;
    byItem.set(m.itemOrFamilyId, (byItem.get(m.itemOrFamilyId) ?? 0) + m.allocationPct);
  }
  for (const [itemId, total] of byItem) {
    if (total > 1.0001) {
      collector.warn(
        sheet,
        "allocation_sum_over_100",
        `Line allocations for "${itemId}" add up to ${Math.round(total * 100)}%. Shares above 100% overstate the hours required.`,
        { column: "allocation_pct" }
      );
    }
  }

  return out;
}

function normalizeLeadTimeHistory(rows: RawRow[], collector: IssueCollector): LeadTimeHistoryRow[] {
  const sheet: SheetName = "Lead_Time_History";
  const out: LeadTimeHistoryRow[] = [];
  rows.forEach((row, i) => {
    const rowNumber = i + FIRST_DATA_ROW;
    const materialId = requireString(row, "material_id", sheet, rowNumber, collector);
    const materialName = requireString(row, "material_name", sheet, rowNumber, collector);
    const poId = requireString(row, "po_id", sheet, rowNumber, collector);
    const uom = requireString(row, "uom", sheet, rowNumber, collector);
    const quantity = requireNumber(row, "quantity", sheet, rowNumber, collector, { min: 0 });

    const poDateRaw = readCell(row, "po_date");
    const receiptDateRaw = readCell(row, "receipt_date");
    const poDate = coerceDate(poDateRaw);
    const receiptDate = coerceDate(receiptDateRaw);

    if (isBlank(poDateRaw) || poDate === undefined) {
      collector.error(sheet, "invalid_po_date", "po_date is missing or not a readable date. Use YYYY-MM-DD.", {
        column: "po_date",
        row: rowNumber,
      });
      return;
    }
    if (isBlank(receiptDateRaw) || receiptDate === undefined) {
      collector.error(
        sheet,
        "invalid_receipt_date",
        "receipt_date is missing or not a readable date. Use YYYY-MM-DD.",
        { column: "receipt_date", row: rowNumber }
      );
      return;
    }
    if (!materialId || !materialName || !poId || !uom || quantity === undefined) return;

    const actualLeadTimeDays = Math.round(
      (Date.parse(`${receiptDate}T00:00:00Z`) - Date.parse(`${poDate}T00:00:00Z`)) / 86_400_000
    );
    if (actualLeadTimeDays < 0) {
      collector.error(
        sheet,
        "receipt_before_po",
        "receipt_date falls before po_date, which would give a negative lead time.",
        { column: "receipt_date", row: rowNumber }
      );
      return;
    }

    out.push({
      id: `lt_${i}`,
      materialId,
      materialName,
      poId,
      poDate,
      receiptDate,
      quantity,
      uom,
      supplierId: coerceString(readCell(row, "supplier_id")),
      supplierName: coerceString(readCell(row, "supplier_name")),
      materialFamily: coerceString(readCell(row, "material_family")),
      specificationFamily: coerceString(readCell(row, "specification_family")),
      plant: coerceString(readCell(row, "plant")),
      systemLeadTimeDays: coerceNumber(readCell(row, "system_lead_time_days")),
      promisedDate: optionalDate(row, "promised_date", sheet, rowNumber, collector),
      receivedQuantity: coerceNumber(readCell(row, "received_qty")),
      actualLeadTimeDays,
    });
  });
  return out;
}

function normalizeInventorySupply(rows: RawRow[], collector: IssueCollector): InventorySupplyRow[] {
  const sheet: SheetName = "Inventory_Supply";
  const out: InventorySupplyRow[] = [];
  rows.forEach((row, i) => {
    const rowNumber = i + FIRST_DATA_ROW;
    const materialId = requireString(row, "material_id", sheet, rowNumber, collector);
    const plant = requireString(row, "plant", sheet, rowNumber, collector);
    const period = requireString(row, "period", sheet, rowNumber, collector);
    const uom = requireString(row, "uom", sheet, rowNumber, collector);
    const onHandQty = requireNumber(row, "on_hand_qty", sheet, rowNumber, collector, { min: 0 });
    const openPoQty = requireNumber(row, "open_po_qty", sheet, rowNumber, collector, { min: 0 });
    const plannedReceiptQty = requireNumber(row, "planned_receipt_qty", sheet, rowNumber, collector, {
      min: 0,
    });
    if (
      !materialId ||
      !plant ||
      !period ||
      !uom ||
      onHandQty === undefined ||
      openPoQty === undefined ||
      plannedReceiptQty === undefined
    )
      return;

    if (!/^\d{4}-\d{2}$/.test(period)) {
      collector.error(sheet, "invalid_period", "period must be a calendar month written as YYYY-MM.", {
        column: "period",
        row: rowNumber,
      });
      return;
    }

    out.push({
      id: `inv_${i}`,
      materialId,
      plant,
      period,
      onHandQty,
      openPoQty,
      plannedReceiptQty,
      uom,
    });
  });
  return out;
}

function normalizeReadinessHistory(rows: RawRow[], collector: IssueCollector): ReadinessSnapshotRow[] {
  const sheet: SheetName = "Readiness_History";
  const out: ReadinessSnapshotRow[] = [];
  rows.forEach((row, i) => {
    const rowNumber = i + FIRST_DATA_ROW;
    const seasonPeriod = requireString(row, "season_period", sheet, rowNumber, collector);
    const weeksBeforeProductionStart = requireNumber(
      row,
      "weeks_before_production_start",
      sheet,
      rowNumber,
      collector,
      { min: 0 }
    );

    const percentRaw = readCell(row, "represented_pct");
    let representedPct: number | undefined;
    if (isBlank(percentRaw)) {
      collector.error(sheet, "missing_represented_pct", "represented_pct is blank.", {
        column: "represented_pct",
        row: rowNumber,
      });
    } else {
      representedPct = coercePercent(percentRaw);
      if (representedPct === undefined) {
        collector.error(sheet, "invalid_represented_pct", "represented_pct is not a readable percentage.", {
          column: "represented_pct",
          row: rowNumber,
        });
      }
    }

    if (!seasonPeriod || weeksBeforeProductionStart === undefined || representedPct === undefined) return;

    out.push({
      id: `rh_${i}`,
      seasonPeriod,
      weeksBeforeProductionStart: Math.round(weeksBeforeProductionStart),
      representedPct,
      asOfDate: optionalDate(row, "as_of_date", sheet, rowNumber, collector),
      notes: coerceString(readCell(row, "notes")),
    });
  });
  return out;
}

function normalizeLineHistory(rows: RawRow[], collector: IssueCollector): LineHistoryRow[] {
  const sheet: SheetName = "Line_History";
  const out: LineHistoryRow[] = [];
  rows.forEach((row, i) => {
    const rowNumber = i + FIRST_DATA_ROW;
    const period = requireString(row, "period", sheet, rowNumber, collector);
    const plant = requireString(row, "plant", sheet, rowNumber, collector);
    const lineId = requireString(row, "line_id", sheet, rowNumber, collector);
    const scheduledHours = requireNumber(row, "scheduled_hours", sheet, rowNumber, collector, { min: 0 });
    const runHours = requireNumber(row, "run_hours", sheet, rowNumber, collector, { min: 0 });
    if (!period || !plant || !lineId || scheduledHours === undefined || runHours === undefined) return;

    if (!/^\d{4}-\d{2}$/.test(period)) {
      collector.error(sheet, "invalid_period", "period must be a calendar month written as YYYY-MM.", {
        column: "period",
        row: rowNumber,
      });
      return;
    }

    // Absent stays absent: a blank downtime column is "not recorded", which is
    // a different statement from "no downtime".
    const optional = (column: string): number | undefined => {
      const raw = readCell(row, column);
      if (isBlank(raw)) return undefined;
      const value = coerceNumber(raw);
      if (value === undefined || value < 0) {
        collector.warn(sheet, `invalid_${column}`, `${column} is not a non-negative number and was ignored.`, {
          column,
          row: rowNumber,
        });
        return undefined;
      }
      return value;
    };

    out.push({
      id: `lh_${i}`,
      period,
      plant,
      lineId,
      scheduledHours,
      runHours,
      unplannedDowntimeHours: optional("unplanned_downtime_hours"),
      overtimeHours: optional("overtime_hours"),
      lateArrivals: optional("late_arrivals"),
      lateArrivalHoursLost: optional("late_arrival_hours_lost"),
      notes: coerceString(readCell(row, "notes")),
    });
  });
  return out;
}

/* ------------------------------------------------------------------ */
/* Cross-sheet reference checks                                        */
/* ------------------------------------------------------------------ */

/**
 * References that only make sense once every sheet is normalized: a mapping
 * that points at a line with no capacity, a BOM whose parent item does not
 * exist. These are warnings rather than errors — the row is real data and the
 * planner may simply not have exported the other sheet.
 */
function crossReference(dataset: PlanningDataset, collector: IssueCollector): void {
  const lineIds = new Set(dataset.lineCapacity.map((r) => r.lineId));
  if (lineIds.size > 0) {
    for (const mapping of dataset.itemLineMappings) {
      if (!lineIds.has(mapping.lineId)) {
        collector.warn(
          "Item_Line_Mapping",
          "unknown_line",
          `Mapped to line "${mapping.lineId}", which has no rows in Line_Capacity. Its hours cannot be checked against a ceiling.`,
          { column: "line_id" }
        );
      }
    }
    for (const item of dataset.currentPlanItems) {
      if (item.primaryLineId && !lineIds.has(item.primaryLineId)) {
        collector.warn(
          "Current_Plan",
          "unknown_line",
          `Line "${item.primaryLineId}" has no rows in Line_Capacity.`,
          { column: "primary_line_id" }
        );
      }
    }
  }

  const knownItems = new Set([
    ...dataset.currentPlanItems.map((r) => r.itemId),
    ...dataset.historicalItems.map((r) => r.itemId),
  ]);
  if (knownItems.size > 0) {
    for (const bom of dataset.boms) {
      if (!knownItems.has(bom.parentItemId)) {
        collector.warn(
          "BOM",
          "unknown_parent",
          `Component listed against item "${bom.parentItemId}", which is in neither Current_Plan nor Historical_Items.`,
          { column: "parent_item_id" }
        );
      }
    }
  }

  const bomComponentIds = new Set(dataset.boms.map((r) => r.componentId));
  if (bomComponentIds.size > 0) {
    for (const lt of dataset.leadTimeHistory) {
      if (!bomComponentIds.has(lt.materialId)) {
        collector.info(
          "Lead_Time_History",
          "unused_material",
          `Lead-time history for "${lt.materialId}", which no BOM line uses.`,
          { column: "material_id" }
        );
      }
    }
  }
}
