/**
 * The canonical workbook contract.
 *
 * This file is the single source of truth for what the planning template
 * contains. The template generator, the README sheet, the parser, the
 * validator, and the column-mapping UI all read from here, so what we hand a
 * planner and what we accept back can never drift apart.
 *
 * Header naming follows V2 §14: readable snake_case business language, no
 * database ids where a business identifier will do.
 */

import type { SheetName } from "@/lib/dataset/issues";

export type ColumnType = "string" | "number" | "integer" | "date" | "percent" | "enum";

export interface ColumnSpec {
  name: string;
  required: boolean;
  type: ColumnType;
  /** One short line for the README. */
  purpose: string;
  example: string | number;
  enumValues?: readonly string[];
  /** Column width in the generated workbook. */
  width?: number;
  /**
   * Header names a planner's export is likely to use instead. Drives the
   * auto-map, and the mapping prompt when auto-mapping cannot resolve it.
   */
  aliases?: readonly string[];
  /** Rejected when the parsed number falls below this. */
  min?: number;
  /** Rejected when the parsed number is at or below zero. */
  positive?: boolean;
}

export interface SheetSpec {
  name: SheetName;
  required: boolean;
  /** One line for the README "Purpose" column. */
  purpose: string;
  /** What is lost when this sheet is absent — drives honest empty states. */
  absentConsequence: string;
  columns: readonly ColumnSpec[];
  /** Rows for the Example_Data sheet. Never written into an input tab. */
  exampleRows: readonly Record<string, string | number>[];
}

const c = (
  name: string,
  required: boolean,
  type: ColumnType,
  purpose: string,
  example: string | number,
  extra: Partial<ColumnSpec> = {}
): ColumnSpec => ({ name, required, type, purpose, example, ...extra });

export const COMPONENT_TYPES = [
  "RAW_MATERIAL",
  "PACKAGING",
  "SEMI_FINISHED",
  "FINISHED_COMPONENT",
  "ARTWORK",
  "OTHER",
] as const;

export const MAPPING_LEVELS = ["ITEM", "PRODUCT_FAMILY", "BASE_PACK"] as const;

/* ------------------------------------------------------------------ */

const BUSINESS_PLAN: SheetSpec = {
  name: "Business_Plan",
  required: true,
  purpose: "The signed-off business expectation your operational plan is measured against.",
  absentConsequence: "Without it there is no expected figure to reconcile the formal plan against.",
  columns: [
    c("planning_period", true, "string", "Period or program key, e.g. 2027-Halloween or 2027-10.", "2027-Halloween", { width: 20, aliases: ["period", "plan_period", "planning_month"] }),
    c("event_or_program", true, "string", "Business event or program name.", "Halloween 2027", { width: 22, aliases: ["event", "program", "season"] }),
    c("business_unit", true, "string", "Business unit owning the target.", "Confectionery", { width: 18, aliases: ["bu", "division"] }),
    c("brand", true, "string", "Brand the target belongs to.", "Ridgeline", { width: 16, aliases: ["brand_name"] }),
    c("target_value", true, "number", "Expected business value for this scope.", 41500000, { width: 16, min: 0, aliases: ["plan_value", "business_target", "target_revenue", "value"] }),
    c("target_units", false, "number", "Expected units, if units govern the plan.", 9600000, { width: 14, min: 0, aliases: ["target_qty", "plan_units"] }),
    c("customer", false, "string", "Customer, when the target is customer-specific.", "Meridian Mass", { width: 18 }),
    c("channel", false, "string", "Channel, when relevant.", "mass", { width: 12 }),
    c("product_family", false, "string", "Product family, when the target is family-level.", "Variety Bags", { width: 18, aliases: ["family", "category"] }),
    c("growth_pct", false, "percent", "Business growth assumption. 6, 6% and 0.06 all mean +6%.", "6%", { width: 12, aliases: ["growth", "growth_rate"] }),
    c("currency", false, "string", "ISO currency code.", "USD", { width: 10 }),
    c("notes", false, "string", "Free text.", "Signed off in Aug S&OP", { width: 28 }),
  ],
  exampleRows: [
    { planning_period: "2027-Halloween", event_or_program: "Halloween 2027", business_unit: "Confectionery", brand: "Ridgeline", target_value: 41500000, target_units: 9600000, customer: "Meridian Mass", channel: "mass", product_family: "Variety Bags", growth_pct: "6%", currency: "USD", notes: "Signed off in Aug S&OP" },
    { planning_period: "2027-Holiday", event_or_program: "Holiday 2027", business_unit: "Confectionery", brand: "Ridgeline", target_value: 28900000, target_units: 4100000, customer: "", channel: "", product_family: "Gift Tins", growth_pct: "4%", currency: "USD", notes: "" },
  ],
};

const CURRENT_PLAN: SheetSpec = {
  name: "Current_Plan",
  required: true,
  purpose: "What is already formalized as items in your planning system today.",
  absentConsequence: "Without it we cannot tell which part of the business is already represented.",
  columns: [
    c("planning_period", true, "string", "Period or program key. Must match Business_Plan.", "2027-Halloween", { width: 20, aliases: ["period", "plan_period"] }),
    c("item_id", true, "string", "Item / SKU identifier.", "SKU-4411", { width: 16, aliases: ["sku", "material_number", "product_id", "item_number", "item"] }),
    c("item_name", true, "string", "Item description.", "Ridgeline Halloween Variety Bag 40ct", { width: 34, aliases: ["description", "item_description", "material_description"] }),
    c("brand", true, "string", "Brand.", "Ridgeline", { width: 16 }),
    c("product_family", true, "string", "Product family.", "Variety Bags", { width: 18, aliases: ["family", "category"] }),
    c("planned_units", true, "number", "Formally planned units for the period.", 1180000, { width: 15, min: 0, aliases: ["forecast_qty", "forecast_units", "plan_qty", "demand_units", "quantity", "planned_qty"] }),
    c("event_or_program", false, "string", "Event this item serves.", "Halloween 2027", { width: 20, aliases: ["event", "program"] }),
    c("customer", false, "string", "Customer.", "Meridian Mass", { width: 18 }),
    c("channel", false, "string", "Channel.", "mass", { width: 12 }),
    c("planned_value", false, "number", "Formally planned value.", 5310000, { width: 15, min: 0 }),
    c("currency", false, "string", "ISO currency code.", "USD", { width: 10 }),
    c("plant", false, "string", "Producing plant.", "PLT-01", { width: 12 }),
    c("primary_line_id", false, "string", "Line this item normally runs on. Must exist in Line_Capacity.", "LINE-03", { width: 15, aliases: ["line_id", "resource_id", "work_center"] }),
    c("production_start_date", false, "date", "Production window start. Use YYYY-MM-DD.", "2027-05-03", { width: 18, aliases: ["prod_start", "production_start"] }),
    c("production_end_date", false, "date", "Production window end.", "2027-07-30", { width: 18, aliases: ["prod_end", "production_end"] }),
    c("sales_start_date", false, "date", "Sales / ship window start.", "2027-08-16", { width: 16, aliases: ["ship_start", "sales_start"] }),
    c("sales_end_date", false, "date", "Sales / ship window end.", "2027-10-31", { width: 16, aliases: ["ship_end", "sales_end"] }),
    c("status", false, "string", "Planning status.", "firm", { width: 12 }),
  ],
  exampleRows: [
    { planning_period: "2027-Halloween", item_id: "SKU-4411", item_name: "Ridgeline Halloween Variety Bag 40ct", brand: "Ridgeline", product_family: "Variety Bags", planned_units: 1180000, event_or_program: "Halloween 2027", customer: "Meridian Mass", channel: "mass", planned_value: 5310000, currency: "USD", plant: "PLT-01", primary_line_id: "LINE-03", production_start_date: "2027-05-03", production_end_date: "2027-07-30", sales_start_date: "2027-08-16", sales_end_date: "2027-10-31", status: "firm" },
  ],
};

const HISTORICAL_ITEMS: SheetSpec = {
  name: "Historical_Items",
  required: true,
  purpose: "Prior-season items and what they actually did. These explain an unresolved amount.",
  absentConsequence: "Without it there are no candidate items to explain the gap and no analogues for BOM inference.",
  columns: [
    c("historical_period", true, "string", "Prior period or program key.", "2026-Halloween", { width: 20, aliases: ["period", "season", "prior_period"] }),
    c("item_id", true, "string", "Item / SKU identifier.", "SKU-3208", { width: 16, aliases: ["sku", "material_number", "product_id", "item_number", "item"] }),
    c("item_name", true, "string", "Item description.", "Ridgeline Halloween Variety Bag 35ct", { width: 34, aliases: ["description", "item_description"] }),
    c("brand", true, "string", "Brand.", "Ridgeline", { width: 16 }),
    c("product_family", true, "string", "Product family.", "Variety Bags", { width: 18, aliases: ["family", "category"] }),
    c("actual_units", true, "number", "Units actually shipped or produced.", 1310000, { width: 14, min: 0, aliases: ["shipped_units", "actual_qty", "sales_units", "actuals"] }),
    c("event_or_program", false, "string", "Event this item served.", "Halloween 2026", { width: 20, aliases: ["event", "program"] }),
    c("customer", false, "string", "Customer. Enables customer-level matching.", "Meridian Mass", { width: 18 }),
    c("channel", false, "string", "Channel.", "mass", { width: 12 }),
    c("pack_format", false, "string", "Pack format. Enables format matching.", "laydown bag", { width: 16 }),
    c("pack_size", false, "number", "Pack size value.", 35, { width: 11, min: 0 }),
    c("size_uom", false, "string", "Pack size unit.", "ct", { width: 10 }),
    c("flavor_or_variant", false, "string", "Flavour or variant.", "milk chocolate", { width: 18 }),
    c("formula_family", false, "string", "Formulation family. Enables recipe-level matching.", "milk-choc-std", { width: 18 }),
    c("packaging_type", false, "string", "Packaging type.", "printed film", { width: 16 }),
    c("base_pack", false, "string", "Base pack this item is a variant of.", "BP-VB-35", { width: 14 }),
    c("actual_value", false, "number", "Value actually shipped.", 5760000, { width: 14, min: 0 }),
    c("currency", false, "string", "ISO currency code.", "USD", { width: 10 }),
    c("plant", false, "string", "Producing plant.", "PLT-01", { width: 12 }),
    c("primary_line_id", false, "string", "Line it actually ran on.", "LINE-03", { width: 15, aliases: ["line_id", "resource_id", "work_center"] }),
    c("production_start_date", false, "date", "Production window start.", "2026-05-04", { width: 18 }),
    c("production_end_date", false, "date", "Production window end.", "2026-07-31", { width: 18 }),
    c("sales_start_date", false, "date", "Sales window start.", "2026-08-17", { width: 16 }),
    c("sales_end_date", false, "date", "Sales window end.", "2026-10-31", { width: 16 }),
    c("status", false, "string", "How this item ended: shipped, discontinued, replaced.", "shipped", { width: 14 }),
  ],
  exampleRows: [
    { historical_period: "2026-Halloween", item_id: "SKU-3208", item_name: "Ridgeline Halloween Variety Bag 35ct", brand: "Ridgeline", product_family: "Variety Bags", actual_units: 1310000, event_or_program: "Halloween 2026", customer: "Meridian Mass", channel: "mass", pack_format: "laydown bag", pack_size: 35, size_uom: "ct", flavor_or_variant: "milk chocolate", formula_family: "milk-choc-std", packaging_type: "printed film", base_pack: "BP-VB-35", actual_value: 5760000, currency: "USD", plant: "PLT-01", primary_line_id: "LINE-03", production_start_date: "2026-05-04", production_end_date: "2026-07-31", sales_start_date: "2026-08-17", sales_end_date: "2026-10-31", status: "shipped" },
  ],
};

const BOM: SheetSpec = {
  name: "BOM",
  required: false,
  purpose: "Component structure for current or historical items. Drives material exposure.",
  absentConsequence: "Material analysis is unavailable. Reconciliation and capacity still work.",
  columns: [
    c("parent_item_id", true, "string", "Item this component belongs to. Should exist in Current_Plan or Historical_Items.", "SKU-3208", { width: 16, aliases: ["parent_sku", "parent_id", "item_id"] }),
    c("component_id", true, "string", "Component / material identifier.", "MAT-COCOA", { width: 16, aliases: ["material_id", "component", "child_item_id"] }),
    c("component_name", true, "string", "Component description.", "Cocoa liquor", { width: 24, aliases: ["material_name", "component_description"] }),
    c("component_type", true, "enum", `One of: ${COMPONENT_TYPES.join(", ")}.`, "RAW_MATERIAL", { width: 20, enumValues: COMPONENT_TYPES, aliases: ["material_type", "type"] }),
    c("quantity_per_parent", true, "number", "Quantity consumed per one parent unit.", 0.0182, { width: 19, positive: true, aliases: ["qty_per", "quantity", "component_qty", "qty_per_unit"] }),
    c("uom", true, "string", "Unit of measure for the quantity.", "kg", { width: 10, aliases: ["unit", "base_uom"] }),
    c("component_family", false, "string", "Material family, for family-level exposure.", "Cocoa", { width: 18, aliases: ["material_family"] }),
    c("valid_from", false, "date", "First date this line applies.", "2026-01-01", { width: 13 }),
    c("valid_to", false, "date", "Last date this line applies.", "2027-12-31", { width: 13 }),
    c("scrap_pct", false, "percent", "Scrap / loss factor. 2, 2% and 0.02 all mean 2%.", "2%", { width: 11 }),
    c("planning_status", false, "string", "Whether this component is settled or still moving.", "stable", { width: 16 }),
    c("supplier_id", false, "string", "Supplier identifier.", "SUP-201", { width: 13 }),
    c("notes", false, "string", "Free text.", "", { width: 24 }),
  ],
  exampleRows: [
    { parent_item_id: "SKU-3208", component_id: "MAT-COCOA", component_name: "Cocoa liquor", component_type: "RAW_MATERIAL", quantity_per_parent: 0.0182, uom: "kg", component_family: "Cocoa", valid_from: "2026-01-01", valid_to: "2027-12-31", scrap_pct: "2%", planning_status: "stable", supplier_id: "SUP-201", notes: "" },
    { parent_item_id: "SKU-3208", component_id: "MAT-FILM", component_name: "Printed film laminate", component_type: "PACKAGING", quantity_per_parent: 0.0094, uom: "kg", component_family: "Printed Film", valid_from: "2026-01-01", valid_to: "2027-12-31", scrap_pct: "3.5%", planning_status: "artwork pending", supplier_id: "SUP-118", notes: "Artwork drives lead time" },
  ],
};

const LINE_CAPACITY: SheetSpec = {
  name: "Line_Capacity",
  required: false,
  purpose: "Available manufacturing hours by line and month. Hours vary month to month.",
  absentConsequence: "Capacity analysis is unavailable. Reconciliation and material analysis still work.",
  columns: [
    c("period", true, "string", "Calendar month, YYYY-MM. One row per line per month.", "2027-06", { width: 12, aliases: ["month", "capacity_period"] }),
    c("plant", true, "string", "Plant.", "PLT-01", { width: 12 }),
    c("line_id", true, "string", "Line identifier. Referenced by Item_Line_Mapping.", "LINE-03", { width: 13, aliases: ["resource_id", "work_center", "line"] }),
    c("line_name", true, "string", "Line description.", "Line 03 — Bagging", { width: 22, aliases: ["resource_name", "line_description"] }),
    c("base_calendar_hours", true, "number", "Gross hours the line is scheduled to exist this month.", 940, { width: 19, min: 0, aliases: ["calendar_hours", "gross_hours", "base_hours"] }),
    c("planned_maintenance_hours", false, "number", "Planned maintenance downtime.", 60, { width: 24, min: 0, aliases: ["maintenance_hours", "pm_hours"] }),
    c("project_downtime_hours", false, "number", "Capital or project downtime.", 40, { width: 21, min: 0, aliases: ["project_hours"] }),
    c("labor_constraint_hours", false, "number", "Hours lost to labour availability.", 80, { width: 21, min: 0, aliases: ["labour_constraint_hours", "labor_hours"] }),
    c("other_constraint_hours", false, "number", "Any other hours lost.", 0, { width: 21, min: 0 }),
    c("custom_adjustment_hours", false, "number", "Hours added back, e.g. an approved extra shift. Added, not subtracted.", 0, { width: 22, aliases: ["adjustment_hours", "extra_hours"] }),
    c("target_utilization_pct", false, "percent", "Target utilisation for this line. 90, 90% and 0.9 all mean 90%.", "90%", { width: 20, aliases: ["target_utilisation_pct", "target_util"] }),
    c("notes", false, "string", "Free text.", "", { width: 24 }),
  ],
  exampleRows: [
    { period: "2027-05", plant: "PLT-01", line_id: "LINE-03", line_name: "Line 03 — Bagging", base_calendar_hours: 940, planned_maintenance_hours: 60, project_downtime_hours: 0, labor_constraint_hours: 40, other_constraint_hours: 0, custom_adjustment_hours: 0, target_utilization_pct: "90%", notes: "" },
    { period: "2027-06", plant: "PLT-01", line_id: "LINE-03", line_name: "Line 03 — Bagging", base_calendar_hours: 940, planned_maintenance_hours: 120, project_downtime_hours: 60, labor_constraint_hours: 40, other_constraint_hours: 0, custom_adjustment_hours: 0, target_utilization_pct: "90%", notes: "Annual PM shutdown week" },
  ],
};

const ITEM_LINE_MAPPING: SheetSpec = {
  name: "Item_Line_Mapping",
  required: false,
  purpose: "How item or family volume becomes line hours. Declare at the level you actually know.",
  absentConsequence: "Capacity analysis is unavailable — units cannot be converted to line hours.",
  columns: [
    c("item_or_family_id", true, "string", "Item id, product family, or base pack — matching mapping_level.", "Variety Bags", { width: 20, aliases: ["item_id", "family_id", "sku"] }),
    c("mapping_level", true, "enum", `Which of the three the id above is: ${MAPPING_LEVELS.join(", ")}.`, "PRODUCT_FAMILY", { width: 17, enumValues: MAPPING_LEVELS, aliases: ["level"] }),
    c("line_id", true, "string", "Line it runs on. Must exist in Line_Capacity.", "LINE-03", { width: 13, aliases: ["resource_id", "work_center", "line"] }),
    c("run_rate_units_per_hour", true, "number", "Units this line produces per hour for this item or family.", 7950, { width: 22, positive: true, aliases: ["run_rate", "units_per_hour", "rate", "uph"] }),
    c("priority", false, "integer", "Order to prefer lines in. 1 is first.", 1, { width: 10 }),
    c("allocation_pct", false, "percent", "Share of volume sent to this line. Shares for one item should total 100%.", "60%", { width: 15, aliases: ["allocation", "split_pct"] }),
    c("valid_from", false, "date", "First date this mapping applies.", "2027-01-01", { width: 13 }),
    c("valid_to", false, "date", "Last date this mapping applies.", "2027-12-31", { width: 13 }),
    c("changeover_hours", false, "number", "Changeover hours per run.", 2.5, { width: 17, min: 0 }),
    c("notes", false, "string", "Free text.", "", { width: 24 }),
  ],
  exampleRows: [
    { item_or_family_id: "Variety Bags", mapping_level: "PRODUCT_FAMILY", line_id: "LINE-03", run_rate_units_per_hour: 7950, priority: 1, allocation_pct: "70%", valid_from: "2027-01-01", valid_to: "2027-12-31", changeover_hours: 2.5, notes: "Primary bagging line" },
    { item_or_family_id: "Variety Bags", mapping_level: "PRODUCT_FAMILY", line_id: "LINE-04", run_rate_units_per_hour: 6400, priority: 2, allocation_pct: "30%", valid_from: "2027-01-01", valid_to: "2027-12-31", changeover_hours: 3, notes: "Flexible alternate" },
  ],
};

const LEAD_TIME_HISTORY: SheetSpec = {
  name: "Lead_Time_History",
  required: false,
  purpose: "Purchase order and receipt dates, so system lead times can be compared to what actually happened.",
  absentConsequence: "Lead times fall back to your system assumption with no historical comparison.",
  columns: [
    c("material_id", true, "string", "Material identifier. Should match BOM component_id.", "MAT-FILM", { width: 15, aliases: ["component_id", "material"] }),
    c("material_name", true, "string", "Material description.", "Printed film laminate", { width: 24 }),
    c("po_id", true, "string", "Purchase order identifier.", "PO-778201", { width: 14, aliases: ["po_number", "purchase_order"] }),
    c("po_date", true, "date", "Date the order was placed. Use YYYY-MM-DD.", "2026-02-11", { width: 13, aliases: ["order_date", "purchase_order_date"] }),
    c("receipt_date", true, "date", "Date goods were received. Lead time is derived from these two.", "2026-04-19", { width: 14, aliases: ["gr_date", "goods_receipt_date", "delivery_date"] }),
    c("quantity", true, "number", "Quantity ordered.", 14000, { width: 12, min: 0 }),
    c("uom", true, "string", "Unit of measure.", "kg", { width: 10 }),
    c("supplier_id", false, "string", "Supplier identifier.", "SUP-118", { width: 13 }),
    c("supplier_name", false, "string", "Supplier name.", "Northvale Flexibles", { width: 22 }),
    c("material_family", false, "string", "Material family.", "Printed Film", { width: 16 }),
    c("specification_family", false, "string", "Specification family.", "laminate-7c", { width: 18 }),
    c("plant", false, "string", "Receiving plant.", "PLT-01", { width: 12 }),
    c("system_lead_time_days", false, "integer", "Lead time your system currently assumes, for comparison.", 42, { width: 20, min: 0, aliases: ["planned_lead_time", "system_lead_time"] }),
    c("promised_date", false, "date", "Delivery date the supplier committed to. Enables on-time delivery.", "2026-04-14", { width: 14, aliases: ["confirmed_date", "committed_date", "promise_date"] }),
    c("received_qty", false, "number", "Quantity actually received. Enables in-full delivery.", 14000, { width: 13, min: 0, aliases: ["received_quantity", "gr_qty", "delivered_qty"] }),
  ],
  exampleRows: [
    { material_id: "MAT-FILM", material_name: "Printed film laminate", po_id: "PO-778201", po_date: "2026-02-11", receipt_date: "2026-04-19", quantity: 14000, uom: "kg", supplier_id: "SUP-118", supplier_name: "Northvale Flexibles", material_family: "Printed Film", specification_family: "laminate-7c", plant: "PLT-01", system_lead_time_days: 42, promised_date: "2026-04-14", received_qty: 14000 },
  ],
};

const INVENTORY_SUPPLY: SheetSpec = {
  name: "Inventory_Supply",
  required: false,
  purpose: "On-hand and inbound material, so gross exposure can become a net requirement.",
  absentConsequence: "Material figures are shown as gross exposure only, never as a net procurement requirement.",
  columns: [
    c("material_id", true, "string", "Material identifier. Should match BOM component_id.", "MAT-COCOA", { width: 15, aliases: ["component_id", "material"] }),
    c("plant", true, "string", "Plant holding the stock.", "PLT-01", { width: 12 }),
    c("period", true, "string", "Calendar month, YYYY-MM.", "2027-05", { width: 12, aliases: ["month"] }),
    c("on_hand_qty", true, "number", "Quantity on hand.", 82000, { width: 14, min: 0, aliases: ["on_hand", "stock_qty", "inventory_qty"] }),
    c("open_po_qty", true, "number", "Quantity on open purchase orders.", 40000, { width: 14, min: 0, aliases: ["open_po", "on_order_qty"] }),
    c("planned_receipt_qty", true, "number", "Quantity on planned receipts.", 0, { width: 19, min: 0, aliases: ["planned_receipts"] }),
    c("uom", true, "string", "Unit of measure.", "kg", { width: 10 }),
  ],
  exampleRows: [
    { material_id: "MAT-COCOA", plant: "PLT-01", period: "2027-05", on_hand_qty: 82000, open_po_qty: 40000, planned_receipt_qty: 0, uom: "kg" },
  ],
};

const READINESS_HISTORY: SheetSpec = {
  name: "Readiness_History",
  required: false,
  purpose: "Weekly snapshots of how much of a season's expected value was in the formal plan, by weeks before production start.",
  absentConsequence: "The Overview readiness curve is unavailable — there is no history to show a pace against.",
  columns: [
    c("season_period", true, "string", "Period or program key this snapshot belongs to. Same shape as planning_period — a prior season's rows are what let this year compare to it.", "2027-Halloween", { width: 20, aliases: ["period", "planning_period", "season"] }),
    c("weeks_before_production_start", true, "integer", "How many weeks before that season's production start this snapshot was taken.", 30, { width: 26, min: 0, aliases: ["weeks_before", "weeks_out"] }),
    c("represented_pct", true, "percent", "Share of that season's expected business value in the formal plan at this point. 41, 41% and 0.41 all mean 41%.", "41%",{ width: 16, aliases: ["represented", "pct_represented", "completeness_pct"] }),
    c("as_of_date", false, "date", "Calendar date the snapshot was taken, for provenance.", "2026-11-02", { width: 14 }),
    c("notes", false, "string", "Free text.", "", { width: 24 }),
  ],
  exampleRows: [
    { season_period: "2026-Halloween", weeks_before_production_start: 44, represented_pct: "18%", as_of_date: "2025-11-24", notes: "" },
    { season_period: "2026-Halloween", weeks_before_production_start: 30, represented_pct: "53%", as_of_date: "2026-02-27", notes: "" },
    { season_period: "2026-Halloween", weeks_before_production_start: 7, represented_pct: "97%", as_of_date: "2026-06-04", notes: "" },
    { season_period: "2027-Halloween", weeks_before_production_start: 44, represented_pct: "21%", as_of_date: "2026-11-23", notes: "" },
    { season_period: "2027-Halloween", weeks_before_production_start: 30, represented_pct: "41%", as_of_date: "2027-03-01", notes: "" },
  ],
};

const LINE_HISTORY: SheetSpec = {
  name: "Line_History",
  required: false,
  purpose: "What each line actually did in past months — run hours, downtime, overtime and late material arrivals.",
  absentConsequence: "Capacity planning shows scheduled hours only, with no history of what lines actually delivered.",
  columns: [
    c("period", true, "string", "Past calendar month, YYYY-MM. One row per line per month.", "2026-06", { width: 12, aliases: ["month"] }),
    c("plant", true, "string", "Plant.", "PLT-01", { width: 12 }),
    c("line_id", true, "string", "Line identifier. Should match Line_Capacity.", "LINE-03", { width: 13, aliases: ["resource_id", "work_center", "line"] }),
    c("scheduled_hours", true, "number", "Hours the line was scheduled to run that month.", 560, { width: 16, min: 0, aliases: ["planned_hours", "available_hours"] }),
    c("run_hours", true, "number", "Hours the line actually ran.", 512, { width: 12, min: 0, aliases: ["actual_hours", "production_hours"] }),
    c("unplanned_downtime_hours", false, "number", "Breakdowns and stoppages nobody planned.", 31, { width: 24, min: 0, aliases: ["downtime_hours", "unplanned_downtime"] }),
    c("overtime_hours", false, "number", "Hours worked above the schedule.", 18, { width: 15, min: 0, aliases: ["overtime", "ot_hours"] }),
    c("late_arrivals", false, "integer", "Material deliveries that reached the line late.", 4, { width: 13, min: 0, aliases: ["late_deliveries", "late_material_arrivals"] }),
    c("late_arrival_hours_lost", false, "number", "Line hours lost waiting on late deliveries.", 9, { width: 22, min: 0, aliases: ["hours_lost_late_material"] }),
    c("notes", false, "string", "Free text.", "", { width: 24 }),
  ],
  exampleRows: [
    { period: "2026-06", plant: "PLT-01", line_id: "LINE-03", scheduled_hours: 560, run_hours: 512, unplanned_downtime_hours: 31, overtime_hours: 18, late_arrivals: 4, late_arrival_hours_lost: 9, notes: "" },
  ],
};

/* ------------------------------------------------------------------ */

export const WORKBOOK_SCHEMA: readonly SheetSpec[] = [
  BUSINESS_PLAN,
  CURRENT_PLAN,
  HISTORICAL_ITEMS,
  BOM,
  LINE_CAPACITY,
  ITEM_LINE_MAPPING,
  LEAD_TIME_HISTORY,
  INVENTORY_SUPPLY,
  READINESS_HISTORY,
  LINE_HISTORY,
];

export function sheetSpec(name: SheetName): SheetSpec {
  const spec = WORKBOOK_SCHEMA.find((s) => s.name === name);
  if (!spec) throw new Error(`Unknown sheet: ${name}`);
  return spec;
}

/** Sheets without which the reconciliation workflow cannot run at all. */
export const REQUIRED_SHEETS: readonly SheetName[] = WORKBOOK_SCHEMA.filter((s) => s.required).map(
  (s) => s.name
);

/** Sheets that must both be present for capacity analysis (V2 §24). */
export const CAPACITY_SHEETS: readonly SheetName[] = ["Line_Capacity", "Item_Line_Mapping"];

export function requiredColumns(spec: SheetSpec): readonly ColumnSpec[] {
  return spec.columns.filter((col) => col.required);
}
