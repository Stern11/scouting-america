/**
 * Test-only helpers that build workbooks in memory, so tests never depend on
 * a binary fixture file. Not imported by any production code path.
 */

import * as XLSX from "xlsx";
import type { SheetName } from "@/lib/dataset/issues";

export function buildTestWorkbook(sheets: Partial<Record<SheetName, Record<string, unknown>[]>>): ArrayBuffer {
  const workbook = XLSX.utils.book_new();

  for (const [sheetName, rows] of Object.entries(sheets)) {
    if (!rows) continue;
    const worksheet = XLSX.utils.json_to_sheet(rows, { cellDates: true });
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  }

  return XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

/** One small, coherent transition across every sheet: CS-1048 → CS-2841 in two stores. */
export function validSheets(): Partial<Record<SheetName, Record<string, unknown>[]>> {
  return {
    Stores: [
      { store_id: "ST-014", store_name: "Dallas #14", city: "Dallas", state: "TX", region: "South Central", cluster: "Large" },
      { store_id: "ST-004", store_name: "Charlotte #04", city: "Charlotte", state: "NC", region: "Southeast", cluster: "Medium" },
    ],
    SKU_Master: [
      {
        sku_id: "CS-1048",
        sku_name: "Cub Scout Uniform Shirt — Legacy Branding",
        product_family: "Cub Scout Uniform",
        category: "Uniforms",
        status: "DISCONTINUED",
        program: "Cub Scouts",
        brand: "BSA legacy",
        size_range: "Youth XS–Adult M",
        vendor: "Vendor 0412",
        unit_cost: 14.2,
        retail_price: 32,
        lead_time_days: 56,
      },
      {
        sku_id: "CS-2841",
        sku_name: "Cub Scout Uniform Shirt — Scouting America Branding",
        product_family: "Cub Scout Uniform",
        category: "Uniforms",
        status: "NEW",
        program: "Cub Scouts",
        brand: "Scouting America",
        size_range: "Youth XS–Adult M",
        vendor: "Vendor 0412",
        unit_cost: 14.6,
        retail_price: 32,
        lead_time_days: 56,
      },
    ],
    SKU_Transitions: [
      {
        transition_id: "TR-001",
        transition_name: "Cub Scout Uniform Shirt",
        predecessor_sku_ids: "CS-1048",
        successor_sku_ids: "CS-2841",
        reason: "REBRAND",
        start_date: "2026-08-12",
        target_completion_date: "2026-11-30",
        substitutability_pct: "100%",
        planner_confirmed: "Y",
      },
    ],
    Sales_History: [
      { sku_id: "CS-1048", period_start: "2026-08-01", period_end: "2026-08-31", units_sold: 1400 },
      { sku_id: "CS-1048", period_start: "2026-09-01", period_end: "2026-09-30", units_sold: 900 },
      { sku_id: "CS-2841", period_start: "2026-09-01", period_end: "2026-09-30", units_sold: 700 },
      { sku_id: "CS-1048", period_start: "2026-08-10", period_end: "2026-10-04", units_sold: 40, store_id: "ST-014" },
      { sku_id: "CS-2841", period_start: "2026-08-10", period_end: "2026-10-04", units_sold: 55, store_id: "ST-004" },
    ],
    Inventory: [
      { sku_id: "CS-1048", location_id: "ST-014", location_type: "STORE", on_hand: 18, snapshot_date: "2026-10-05" },
      { sku_id: "CS-2841", location_id: "ST-004", location_type: "STORE", on_hand: 6, snapshot_date: "2026-10-05" },
      { sku_id: "CS-2841", location_id: "DC-CLT", location_type: "DC", on_hand: 1400, allocated: 200, snapshot_date: "2026-10-05" },
    ],
    Inbound_Supply: [
      { sku_id: "CS-2841", location_id: "DC-CLT", quantity: 600, expected_receipt_date: "2026-10-26", purchase_order_id: "PO-48213" },
    ],
    Current_Plan: [
      { sku_id: "CS-2841", horizon_start: "2026-10-05", horizon_end: "2026-12-27", forecast_units: 2900, planned_replenishment_units: 1800 },
    ],
    Selling_Profiles: [
      { profile_id: "PRF-CS", sku_id: "CS-2841", store_id: "ST-004", profile_name: "Cub Scout Uniform — National" },
    ],
    Transition_History: [{ date: "2026-10-03", transition_id: "TR-001", note: "Confirmed CS-1048 → CS-2841", actor: "James" }],
  };
}
