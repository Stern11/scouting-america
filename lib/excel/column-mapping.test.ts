import { describe, expect, it } from "vitest";
import { parseWorkbook } from "./parse";
import { applyMapping, planColumnMapping } from "./column-mapping";
import { buildTestWorkbook, validSheets } from "./fixtures";
import type { SheetName } from "@/lib/dataset/issues";

const inventoryRow = (extra: Record<string, unknown>) => ({
  sku_id: "CS-1048",
  location_id: "ST-014",
  location_type: "STORE",
  ...extra,
});

describe("planColumnMapping", () => {
  it("resolves every column exactly when headers match the template", () => {
    const plan = planColumnMapping(parseWorkbook(buildTestWorkbook(validSheets())));
    expect(plan.complete).toBe(true);
    for (const res of plan.resolutions) {
      if (res.found !== null) expect(res.status).toBe("exact");
    }
  });

  it("auto-maps an alias header to its template column", () => {
    // `qty_on_hand` is a JDA-style alias of on_hand.
    const buffer = buildTestWorkbook({ Inventory: [inventoryRow({ qty_on_hand: 18 })] });
    const plan = planColumnMapping(parseWorkbook(buffer));

    const res = plan.resolutions.find((r) => r.sheet === "Inventory" && r.expected === "on_hand");
    expect(res?.status).toBe("aliased");
    expect(res?.found).toBe("qty_on_hand");
    // Stores, SKU_Master and Sales_History are absent, so the plan is not complete.
    expect(plan.complete).toBe(false);
  });

  it("keeps a genuinely unknown header as a mapping candidate", () => {
    const buffer = buildTestWorkbook({ Inventory: [inventoryRow({ on_hand: 18, bin_location: "A4" })] });
    const plan = planColumnMapping(parseWorkbook(buffer));
    const res = plan.resolutions.find((r) => r.sheet === "Inventory" && r.expected === "on_hand")!;
    expect(res.candidates).toContain("bin_location");
  });

  it("marks a required column unresolved when neither the exact name nor an alias is present", () => {
    const buffer = buildTestWorkbook({ Inventory: [{ sku_id: "CS-1048", location_type: "STORE", on_hand: 4 }] });
    const plan = planColumnMapping(parseWorkbook(buffer));
    const res = plan.resolutions.find((r) => r.sheet === "Inventory" && r.expected === "location_id");
    expect(res?.status).toBe("unresolved");
    expect(res?.found).toBeNull();
    expect(plan.complete).toBe(false);
  });

  it("lets a manual override win even when an alias would resolve differently", () => {
    const buffer = buildTestWorkbook({ Inventory: [inventoryRow({ oh: 18, oh_adjusted: 16 })] });
    const manual = new Map<SheetName, Map<string, string>>([["Inventory", new Map([["on_hand", "oh_adjusted"]])]]);
    const plan = planColumnMapping(parseWorkbook(buffer), manual);
    expect(plan.resolutions.find((r) => r.sheet === "Inventory" && r.expected === "on_hand")?.found).toBe("oh_adjusted");
  });
});

describe("applyMapping", () => {
  it("renames workbook headers to template column names", () => {
    const parsed = parseWorkbook(buildTestWorkbook({ Inventory: [inventoryRow({ qty_on_hand: 18 })] }));
    const mapped = applyMapping(parsed, planColumnMapping(parsed));
    const row = mapped.get("Inventory")![0]!;
    expect(row["on_hand"]).toBe(18);
    expect(row["qty_on_hand"]).toBeUndefined();
  });

  it("leaves rows untouched when a sheet has no overrides to apply", () => {
    const parsed = parseWorkbook(buildTestWorkbook(validSheets()));
    const mapped = applyMapping(parsed, planColumnMapping(parsed));
    expect(mapped.get("Stores")).toEqual(parsed.sheets.get("Stores"));
  });
});
