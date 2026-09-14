import { describe, it, expect } from "vitest";
import { generateDemoDataset } from "@/lib/dataset/demo/generate";
import type { LeadTimeHistoryRow } from "@/types/dataset";
import { buildSituations } from "./build";
import { compareSuppliers, NO_PROMISED_DATES, NO_RECEIVED_QTY, supplierComparison } from "./suppliers";

const NOW = "2027-03-08T09:00:00.000Z";

let seq = 0;
function receipt(
  supplierId: string,
  poDate: string,
  days: number,
  extra: Partial<LeadTimeHistoryRow> = {}
): LeadTimeHistoryRow {
  seq += 1;
  const receiptDate = new Date(Date.parse(`${poDate}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
  return {
    id: `r${seq}`,
    materialId: "MAT-X",
    materialName: "Film",
    supplierId,
    supplierName: `Supplier ${supplierId}`,
    poId: `PO${seq}`,
    poDate,
    receiptDate,
    quantity: 100,
    uom: "kg",
    actualLeadTimeDays: days,
    ...extra,
  };
}

describe("compareSuppliers — the record per supplier", () => {
  const rows = [
    // A: fast, 4 receipts, one late, one short.
    receipt("A", "2026-01-01", 30, { promisedDate: "2026-02-05", receivedQuantity: 100 }),
    receipt("A", "2026-03-01", 32, { promisedDate: "2026-04-05", receivedQuantity: 100 }),
    receipt("A", "2026-05-01", 40, { promisedDate: "2026-06-01", receivedQuantity: 100 }), // late
    receipt("A", "2026-07-01", 34, { promisedDate: "2026-08-10", receivedQuantity: 90 }), // short
    // B: slower, 3 receipts, perfect.
    receipt("B", "2026-02-01", 50, { promisedDate: "2026-04-01", receivedQuantity: 100 }),
    receipt("B", "2026-06-01", 52, { promisedDate: "2026-08-01", receivedQuantity: 100 }),
    receipt("B", "2026-12-01", 54, { promisedDate: "2027-02-01", receivedQuantity: 120 }),
  ];

  it("measures on time, in full and OTIF per receipt", () => {
    const { suppliers } = compareSuppliers(rows, { now: NOW, productionStart: "2027-06-01" });
    const a = suppliers.find((s) => s.supplierId === "A")!;
    expect(a.receipts).toBe(4);
    expect(a.onTimePct).toBeCloseTo(0.75);
    expect(a.inFullPct).toBeCloseTo(0.75);
    // One late, a different one short: 2 of 4 were both.
    expect(a.otifPct).toBeCloseTo(0.5);
    expect(a.quantityShare).toBeCloseTo(4 / 7);
    const b = suppliers.find((s) => s.supplierId === "B")!;
    expect(b.otifPct).toBe(1);
  });

  it("states spread as half the P10–P90 range, and P80 as the planning figure", () => {
    const { suppliers } = compareSuppliers(rows, { now: NOW });
    const b = suppliers.find((s) => s.supplierId === "B")!;
    expect(b.medianLeadTimeDays).toBe(52);
    // P10 = 50.4, P90 = 53.6.
    expect(b.spreadDays).toBeCloseTo(1.6);
    expect(b.p80LeadTimeDays).toBeCloseTo(53.2);
  });

  it("flags who served the latest order, ignoring receipts dated after now", () => {
    const future = receipt("A", "2027-03-01", 30);
    const { suppliers } = compareSuppliers([...rows, future], { now: NOW });
    expect(suppliers.find((s) => s.supplierId === "B")!.servedLatestOrder).toBe(true);
    expect(suppliers.find((s) => s.supplierId === "A")!.servedLatestOrder).toBe(false);
    expect(suppliers.find((s) => s.supplierId === "A")!.lastReceiptDate).toBe("2026-08-04");
  });

  it("ranks by landing in time before OTIF, and recommends with a reason", () => {
    // Production in 45 days: only A's P80 (~36d) lands.
    const tight = compareSuppliers(rows, { now: NOW, productionStart: "2027-04-22" });
    expect(tight.suppliers.map((s) => s.supplierId)).toEqual(["A", "B"]);
    expect(tight.suppliers[0]!.landsInTime).toBe(true);
    expect(tight.suppliers[1]!.landsInTime).toBe(false);
    expect(tight.recommended).toMatchObject({ supplierId: "A" });
    expect(tight.recommended!.reason).toMatch(/only one that lands/);

    // Plenty of time: B's perfect OTIF wins.
    const roomy = compareSuppliers(rows, { now: NOW, productionStart: "2027-09-01" });
    expect(roomy.suppliers[0]!.supplierId).toBe("B");
    expect(roomy.recommended!.reason).toMatch(/on-time-in-full.*100%/);
    expect(roomy.suppliers[0]!.orderByDate).toBe("2027-07-10");
  });

  it("does not let a thin record outrank an adequate one", () => {
    const withThin = [...rows, receipt("C", "2026-10-01", 20, { promisedDate: "2026-11-01", receivedQuantity: 100 })];
    const { suppliers } = compareSuppliers(withThin, { now: NOW, productionStart: "2027-09-01" });
    const c = suppliers.find((s) => s.supplierId === "C")!;
    expect(c.thinRecord).toBe(true);
    expect(c.spreadDays).toBeUndefined();
    expect(suppliers.at(-1)!.supplierId).toBe("C");
  });

  it("does not let a limited record beat an adequate one on a few lucky deliveries", () => {
    // D: five receipts, slower P80 than nothing — but a real record, 80% OTIF.
    const d = [0, 1, 2, 3, 4].map((i) =>
      receipt("D", `2026-0${i + 1}-01`, 45, {
        promisedDate: `2026-0${i + 2}-20`,
        receivedQuantity: i === 0 ? 90 : 100,
      })
    );
    // B stays at three perfect receipts (100% OTIF), so OTIF alone would pick it.
    const { suppliers, recommended } = compareSuppliers([...rows, ...d], {
      now: NOW,
      productionStart: "2027-09-01",
    });
    expect(suppliers[0]!.supplierId).toBe("D");
    expect(recommended?.supplierId).toBe("D");
    expect(recommended!.reason).not.toMatch(/on only/);
  });

  it("leaves on-time, in-full and OTIF undefined, with reasons, when the columns are absent", () => {
    const bare = rows.map((r) => ({ ...r, promisedDate: undefined, receivedQuantity: undefined }));
    const result = compareSuppliers(bare, { now: NOW, productionStart: "2027-09-01" });
    expect(result.onTimeUnavailable).toBe(NO_PROMISED_DATES);
    expect(result.inFullUnavailable).toBe(NO_RECEIVED_QTY);
    for (const s of result.suppliers) {
      expect(s.onTimePct).toBeUndefined();
      expect(s.inFullPct).toBeUndefined();
      expect(s.otifPct).toBeUndefined();
      expect(s.otifReason).toBe(NO_PROMISED_DATES);
    }
    // Without OTIF the pick falls back to lead time.
    expect(result.recommended!.reason).toMatch(/Shortest P80/);
  });

  it("says why when there is nothing to compare", () => {
    expect(compareSuppliers([], { now: NOW }).unavailableReason).toMatch(/No receipts/);
    const unnamed = rows.map((r) => ({ ...r, supplierId: undefined, supplierName: undefined }));
    expect(compareSuppliers(unnamed, { now: NOW }).unavailableReason).toMatch(/does not name a supplier/);
  });

  it("has no landing verdict without a production window", () => {
    const { suppliers } = compareSuppliers(rows, { now: NOW });
    expect(suppliers.every((s) => s.landsInTime === undefined && s.orderByDate === undefined)).toBe(true);
  });
});

describe("supplierComparison — on the demo dataset", () => {
  const dataset = generateDemoDataset({ planningNow: NOW });
  const situations = buildSituations(dataset);

  it("compares every supplier of record for a material with several", () => {
    const situation = situations.find((s) =>
      s.materialExposure.rows.some((r) => r.materialId === "MAT-FILM")
    )!;
    expect(situation).toBeDefined();
    const result = supplierComparison(dataset, situation, "MAT-FILM");
    expect(result.suppliers.length).toBeGreaterThan(1);
    expect(result.suppliers.filter((s) => s.servedLatestOrder)).toHaveLength(1);
    expect(result.recommended?.supplierId).toBe(result.suppliers[0]!.supplierId);
    expect(result.onTimeUnavailable).toBeUndefined();
    const share = result.suppliers.reduce((sum, s) => sum + s.quantityShare, 0);
    expect(share).toBeCloseTo(1);
  });
});
