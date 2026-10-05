/**
 * The canonical workbook contract.
 *
 * This file is the single source of truth for what the planning template
 * contains. The template generator, the README sheet, the parser, the
 * validator, the column-mapping UI and the demo generator all read from here,
 * so what we hand a planner and what we accept back can never drift apart.
 *
 * The sheets mirror what a merchandise planner can export from JDA MMS: the
 * store list, the SKU master, sales, inventory snapshots and open POs — plus
 * one sheet JDA cannot produce, SKU_Transitions, which says which SKU records
 * are one continuous product.
 */

import type { SheetName } from "@/lib/dataset/issues";

export type ColumnType = "string" | "number" | "integer" | "date" | "percent" | "enum" | "boolean";

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

export const SKU_STATUS_VALUES = ["ACTIVE", "NEW", "DISCONTINUED", "BLOCKED"] as const;
export const TRANSITION_TYPE_VALUES = ["ONE_TO_ONE", "MANY_TO_ONE", "ONE_TO_MANY", "NO_SUCCESSOR", "NEW_PRODUCT"] as const;
export const TRANSITION_REASON_VALUES = ["REBRAND", "REPLACEMENT", "CONSOLIDATION", "SPLIT", "DISCONTINUATION", "NEW"] as const;
export const LOCATION_TYPE_VALUES = ["STORE", "DC"] as const;

/* ------------------------------------------------------------------ */

const STORES: SheetSpec = {
  name: "Stores",
  required: true,
  purpose: "Every store in the network.",
  absentConsequence: "Without it there is no store network to measure coverage across.",
  columns: [
    c("store_id", true, "string", "Store identifier as JDA holds it.", "ST-014", { width: 12, aliases: ["store", "store_number", "location_id", "site"] }),
    c("store_name", true, "string", "Store name planners recognise.", "Dallas #14", { width: 24, aliases: ["name", "store_description", "location_name"] }),
    c("city", false, "string", "City.", "Dallas", { width: 16 }),
    c("state", false, "string", "State.", "TX", { width: 8 }),
    c("region", false, "string", "Region. Transfers prefer stores in the same region.", "South Central", { width: 16, aliases: ["district", "area"] }),
    c("cluster", false, "string", "Store cluster or grade.", "Large", { width: 12, aliases: ["store_cluster", "grade"] }),
  ],
  exampleRows: [
    { store_id: "ST-014", store_name: "Dallas #14", city: "Dallas", state: "TX", region: "South Central", cluster: "Large" },
    { store_id: "ST-004", store_name: "Charlotte #04", city: "Charlotte", state: "NC", region: "Southeast", cluster: "Medium" },
  ],
};

const SKU_MASTER: SheetSpec = {
  name: "SKU_Master",
  required: true,
  purpose: "Every SKU involved in a transition — legacy and successor alike.",
  absentConsequence: "Without it there are no products to connect.",
  columns: [
    c("sku_id", true, "string", "SKU as JDA holds it.", "CS-2841", { width: 12, aliases: ["sku", "item", "item_id", "item_number", "style"] }),
    c("sku_name", true, "string", "Description.", "Cub Scout Uniform Shirt — Scouting America", { width: 40, aliases: ["description", "item_description", "sku_description", "name"] }),
    c("product_family", true, "string", "Product family.", "Cub Scout Uniform", { width: 20, aliases: ["family", "class"] }),
    c("category", true, "string", "Merchandise category.", "Uniforms", { width: 16, aliases: ["department", "dept", "merch_category"] }),
    c("status", true, "enum", "ACTIVE, NEW, DISCONTINUED or BLOCKED (not sellable).", "NEW", { width: 14, enumValues: SKU_STATUS_VALUES, aliases: ["item_status", "sku_status"] }),
    c("program", false, "string", "Program.", "Cub Scouts", { width: 14 }),
    c("brand", false, "string", "Brand or branding.", "Scouting America", { width: 18, aliases: ["branding", "label"] }),
    c("size_range", false, "string", "Size structure.", "Youth XS–Adult M", { width: 18, aliases: ["sizes", "size", "size_scale"] }),
    c("color", false, "string", "Color.", "Navy", { width: 10, aliases: ["colour"] }),
    c("vendor", false, "string", "Vendor.", "Vendor 0412", { width: 14, aliases: ["supplier", "vendor_name"] }),
    c("packaging", false, "string", "Pack or packaging.", "Polybag", { width: 12, aliases: ["pack", "pack_type"] }),
    c("launch_date", false, "date", "First available date.", "2026-07-20", { width: 13 }),
    c("discontinue_date", false, "date", "Discontinued date.", "", { width: 15, aliases: ["disco_date"] }),
    c("replacement_sku_id", false, "string", "Replacement SKU, when JDA records one.", "", { width: 18, aliases: ["replacement_sku", "successor_sku", "replaced_by"] }),
    c("unit_cost", false, "number", "Landed cost per unit.", 14.6, { width: 11, min: 0, aliases: ["cost", "unit_cost_usd"] }),
    c("retail_price", false, "number", "Retail price.", 32, { width: 12, min: 0, aliases: ["retail", "price"] }),
    c("lead_time_days", false, "integer", "Vendor lead time, order to DC receipt.", 56, { width: 14, min: 0, aliases: ["lead_time", "vendor_lead_time"] }),
  ],
  exampleRows: [
    { sku_id: "CS-1048", sku_name: "Cub Scout Uniform Shirt — Legacy", product_family: "Cub Scout Uniform", category: "Uniforms", status: "DISCONTINUED", program: "Cub Scouts", brand: "BSA legacy", size_range: "Youth XS–Adult M", color: "Navy", vendor: "Vendor 0412", packaging: "Polybag", launch_date: "2019-07-01", discontinue_date: "2026-08-12", replacement_sku_id: "CS-2841", unit_cost: 14.2, retail_price: 32, lead_time_days: 56 },
    { sku_id: "CS-2841", sku_name: "Cub Scout Uniform Shirt — Scouting America", product_family: "Cub Scout Uniform", category: "Uniforms", status: "NEW", program: "Cub Scouts", brand: "Scouting America", size_range: "Youth XS–Adult M", color: "Navy", vendor: "Vendor 0412", packaging: "Polybag", launch_date: "2026-07-20", discontinue_date: "", replacement_sku_id: "", unit_cost: 14.6, retail_price: 32, lead_time_days: 56 },
  ],
};

const SKU_TRANSITIONS: SheetSpec = {
  name: "SKU_Transitions",
  required: false,
  purpose: "Which SKUs are one continuous product. Several SKUs go in one cell, separated by commas.",
  absentConsequence: "Relationships come from the SKU master's replacement column and Heizen's suggestions, which you confirm.",
  columns: [
    c("transition_id", true, "string", "Your identifier for the transition.", "TR-001", { width: 12, aliases: ["id", "transition"] }),
    c("transition_name", true, "string", "What planners call the product.", "Cub Scout Uniform Shirt", { width: 28, aliases: ["name", "product", "description"] }),
    c("predecessor_sku_ids", true, "string", "Legacy SKU(s). Blank for a brand-new product.", "CS-1048", { width: 20, aliases: ["legacy_sku", "legacy_skus", "old_sku", "from_sku", "predecessor_sku"] }),
    c("successor_sku_ids", true, "string", "Successor SKU(s). Blank if discontinued with no replacement.", "CS-2841", { width: 20, aliases: ["successor_sku", "new_sku", "new_skus", "to_sku", "replacement_sku"] }),
    c("transition_type", false, "enum", "Worked out from the SKU counts when blank.", "ONE_TO_ONE", { width: 16, enumValues: TRANSITION_TYPE_VALUES, aliases: ["type", "relationship_type"] }),
    c("reason", false, "enum", "Why the SKU changed.", "REBRAND", { width: 14, enumValues: TRANSITION_REASON_VALUES, aliases: ["transition_reason"] }),
    c("start_date", false, "date", "When the transition started.", "2026-08-12", { width: 12, aliases: ["transition_start"] }),
    c("target_completion_date", false, "date", "When legacy should be gone.", "2026-11-30", { width: 20, aliases: ["target_date", "completion_date", "end_date"] }),
    c("substitutability_pct", false, "percent", "Share of legacy units that can satisfy successor demand. 100 = fully interchangeable.", "100%", { width: 18, aliases: ["substitutability", "interchangeable_pct"] }),
    c("transferred_demand_pct", false, "percent", "Share of legacy demand expected to move to the successor.", "100%", { width: 20, aliases: ["demand_transfer_pct", "transfer_pct"] }),
    c("successor_split", false, "string", "One-to-many only: share per successor, e.g. \"SP-1:60%, SP-2:40%\".", "", { width: 22 }),
    c("safety_stock_weeks", false, "number", "Weeks of demand held as safety stock.", 2, { width: 16, min: 0 }),
    c("planner_confirmed", false, "boolean", "Y once a planner has confirmed the relationship.", "Y", { width: 16, aliases: ["confirmed"] }),
    c("closed", false, "boolean", "Y when the transition is finished.", "N", { width: 8, aliases: ["complete", "is_closed"] }),
  ],
  exampleRows: [
    { transition_id: "TR-001", transition_name: "Cub Scout Uniform Shirt", predecessor_sku_ids: "CS-1048", successor_sku_ids: "CS-2841", transition_type: "ONE_TO_ONE", reason: "REBRAND", start_date: "2026-08-12", target_completion_date: "2026-11-30", substitutability_pct: "100%", transferred_demand_pct: "100%", successor_split: "", safety_stock_weeks: 2, planner_confirmed: "Y", closed: "N" },
  ],
};

const SALES_HISTORY: SheetSpec = {
  name: "Sales_History",
  required: true,
  purpose: "Units sold. Any period length — weeks, months, or one row per store for a recent window.",
  absentConsequence: "Without it there is no demand to carry from the legacy SKU.",
  columns: [
    c("sku_id", true, "string", "SKU.", "CS-1048", { width: 12, aliases: ["sku", "item", "item_id"] }),
    c("period_start", true, "date", "First day of the period.", "2026-09-01", { width: 13, aliases: ["week_start", "start_date", "from_date", "period"] }),
    c("period_end", true, "date", "Last day of the period.", "2026-09-30", { width: 13, aliases: ["week_end", "end_date", "to_date"] }),
    c("units_sold", true, "number", "Units sold in the period.", 1210, { width: 11, min: 0, aliases: ["units", "qty_sold", "sales_units", "quantity"] }),
    c("store_id", false, "string", "Store. Blank for a network total.", "", { width: 10, aliases: ["store", "location_id"] }),
    c("sales_value", false, "number", "Sales value.", 38720, { width: 12, min: 0, aliases: ["sales", "revenue", "sales_dollars"] }),
  ],
  exampleRows: [
    { sku_id: "CS-1048", period_start: "2026-09-01", period_end: "2026-09-30", units_sold: 1210, store_id: "", sales_value: 38720 },
    { sku_id: "CS-2841", period_start: "2026-08-10", period_end: "2026-10-04", units_sold: 46, store_id: "ST-014", sales_value: 1472 },
  ],
};

const INVENTORY: SheetSpec = {
  name: "Inventory",
  required: true,
  purpose: "Stock by SKU and location — stores and the DC.",
  absentConsequence: "Without it there is no inventory to reconcile across the old and new SKU.",
  columns: [
    c("sku_id", true, "string", "SKU.", "CS-1048", { width: 12, aliases: ["sku", "item", "item_id"] }),
    c("location_id", true, "string", "Store id, or the DC's id.", "ST-014", { width: 12, aliases: ["location", "store_id", "site"] }),
    c("location_type", true, "enum", "STORE or DC.", "STORE", { width: 13, enumValues: LOCATION_TYPE_VALUES, aliases: ["loc_type", "type"] }),
    c("on_hand", true, "number", "Units on hand.", 18, { width: 10, min: 0, aliases: ["oh", "on_hand_units", "qty_on_hand"] }),
    c("allocated", false, "number", "Units committed to open orders.", 0, { width: 10, min: 0, aliases: ["committed", "reserved"] }),
    c("available", false, "number", "Available units. on_hand − allocated when blank.", 18, { width: 10, min: 0, aliases: ["avail", "available_units"] }),
    c("snapshot_date", false, "date", "When the snapshot was taken.", "2026-10-05", { width: 13, aliases: ["as_of", "as_of_date", "date"] }),
  ],
  exampleRows: [
    { sku_id: "CS-1048", location_id: "ST-014", location_type: "STORE", on_hand: 2, allocated: 0, available: 2, snapshot_date: "2026-10-05" },
    { sku_id: "CS-2841", location_id: "DC-IRV", location_type: "DC", on_hand: 1400, allocated: 0, available: 1400, snapshot_date: "2026-10-05" },
  ],
};

const INBOUND_SUPPLY: SheetSpec = {
  name: "Inbound_Supply",
  required: false,
  purpose: "Open purchase orders and other projected receipts.",
  absentConsequence: "Inbound supply is not included — recommendations count only stock on hand.",
  columns: [
    c("sku_id", true, "string", "SKU.", "CS-2841", { width: 12, aliases: ["sku", "item"] }),
    c("location_id", true, "string", "Where it will be received.", "DC-IRV", { width: 12, aliases: ["location", "ship_to"] }),
    c("quantity", true, "number", "Units.", 600, { width: 10, positive: true, aliases: ["qty", "units", "open_qty"] }),
    c("expected_receipt_date", true, "date", "Expected receipt.", "2026-10-26", { width: 20, aliases: ["receipt_date", "eta", "due_date", "expected_date"] }),
    c("location_type", false, "enum", "STORE or DC. DC when blank.", "DC", { width: 13, enumValues: LOCATION_TYPE_VALUES }),
    c("purchase_order_id", false, "string", "PO number.", "PO-48213", { width: 14, aliases: ["po", "po_number"] }),
    c("source", false, "string", "Vendor or source.", "Vendor 0412", { width: 14, aliases: ["vendor"] }),
  ],
  exampleRows: [
    { sku_id: "CS-2841", location_id: "DC-IRV", quantity: 600, expected_receipt_date: "2026-10-26", location_type: "DC", purchase_order_id: "PO-48213", source: "Vendor 0412" },
  ],
};

const CURRENT_PLAN: SheetSpec = {
  name: "Current_Plan",
  required: false,
  purpose: "What JDA currently forecasts and plans to order, per SKU.",
  absentConsequence: "The JDA-versus-Heizen comparison is not shown.",
  columns: [
    c("sku_id", true, "string", "SKU.", "CS-2841", { width: 12, aliases: ["sku", "item"] }),
    c("horizon_start", true, "date", "Start of the plan window.", "2026-10-05", { width: 14, aliases: ["from_date", "start_date"] }),
    c("horizon_end", true, "date", "End of the plan window.", "2026-12-27", { width: 14, aliases: ["to_date", "end_date"] }),
    c("forecast_units", true, "number", "JDA forecast for the window.", 2900, { width: 14, min: 0, aliases: ["forecast", "forecast_qty"] }),
    c("planned_replenishment_units", false, "number", "Units JDA plans to order.", 1800, { width: 26, min: 0, aliases: ["planned_order", "planned_receipts", "suggested_order"] }),
  ],
  exampleRows: [
    { sku_id: "CS-2841", horizon_start: "2026-10-05", horizon_end: "2026-12-27", forecast_units: 2900, planned_replenishment_units: 1800 },
  ],
};

const SELLING_PROFILES: SheetSpec = {
  name: "Selling_Profiles",
  required: false,
  purpose: "JDA selling profiles: which stores each SKU is set up to sell in. One row per SKU per store.",
  absentConsequence: "Heizen cannot tell which stores JDA will replenish with the successor.",
  columns: [
    c("profile_id", true, "string", "Profile identifier.", "PRF-CS-NAT", { width: 14, aliases: ["profile"] }),
    c("sku_id", true, "string", "SKU.", "CS-2841", { width: 12, aliases: ["sku", "item"] }),
    c("store_id", true, "string", "Store in the profile.", "ST-014", { width: 10, aliases: ["store"] }),
    c("profile_name", false, "string", "Profile name.", "Cub Scout Uniform — National", { width: 28, aliases: ["name"] }),
  ],
  exampleRows: [{ profile_id: "PRF-CS-NAT", sku_id: "CS-2841", store_id: "ST-014", profile_name: "Cub Scout Uniform — National" }],
};

const TRANSITION_HISTORY: SheetSpec = {
  name: "Transition_History",
  required: false,
  purpose: "Past planner decisions on a transition, kept beside it.",
  absentConsequence: "Only decisions made in Heizen appear in a transition's history.",
  columns: [
    c("date", true, "date", "When.", "2026-10-03", { width: 12 }),
    c("transition_id", true, "string", "Transition.", "TR-001", { width: 12 }),
    c("note", true, "string", "What was decided.", "Confirmed CS-1048 → CS-2841", { width: 40, aliases: ["decision", "text"] }),
    c("actor", false, "string", "Who.", "James", { width: 12, aliases: ["by", "planner"] }),
  ],
  exampleRows: [{ date: "2026-10-03", transition_id: "TR-001", note: "Confirmed CS-1048 → CS-2841", actor: "James" }],
};

/* ------------------------------------------------------------------ */

export const WORKBOOK_SCHEMA: readonly SheetSpec[] = [
  STORES,
  SKU_MASTER,
  SKU_TRANSITIONS,
  SALES_HISTORY,
  INVENTORY,
  INBOUND_SUPPLY,
  CURRENT_PLAN,
  SELLING_PROFILES,
  TRANSITION_HISTORY,
];

export function sheetSpec(name: SheetName): SheetSpec {
  const spec = WORKBOOK_SCHEMA.find((s) => s.name === name);
  if (!spec) throw new Error(`Unknown sheet: ${name}`);
  return spec;
}

/** Sheets without which the transition workflow cannot run at all. */
export const REQUIRED_SHEETS: readonly SheetName[] = WORKBOOK_SCHEMA.filter((s) => s.required).map((s) => s.name);

export function requiredColumns(spec: SheetSpec): readonly ColumnSpec[] {
  return spec.columns.filter((col) => col.required);
}
