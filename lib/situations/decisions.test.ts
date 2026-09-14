import { describe, it, expect } from "vitest";
import { generateDemoDataset } from "@/lib/dataset/demo/generate";
import type { SituationOverrides } from "@/types/situation";
import { buildSituations } from "./build";
import { committedLog, nextDecision, pendingDecisions, releaseFor, upcomingDecisions } from "./decisions";

const DATASET = generateDemoDataset({ planningNow: "2027-03-08T09:00:00.000Z" });
const SITUATIONS = buildSituations(DATASET);

describe("upcomingDecisions — one calendar across every programme", () => {
  it("holds every programme's open decisions except production start, soonest first", () => {
    const all = upcomingDecisions(SITUATIONS, {});
    const expected = SITUATIONS.reduce(
      (n, s) => n + pendingDecisions(s).filter((d) => d.kind !== "production_start").length,
      0
    );
    expect(all.length).toBe(expected);
    expect(all.some((d) => d.kind === "production_start")).toBe(false);

    const dated = all.filter((d) => d.date).map((d) => d.date!);
    expect(dated).toEqual([...dated].sort());
    const firstUndated = all.findIndex((d) => !d.date);
    if (firstUndated >= 0) expect(all.slice(firstUndated).every((d) => !d.date)).toBe(true);
  });

  it("keys are unique across programmes, though decision ids repeat between them", () => {
    const all = upcomingDecisions(SITUATIONS, {});
    expect(new Set(all.map((d) => d.key)).size).toBe(all.length);
  });

  it("a released order leaves the list and appears in the committed log", () => {
    const all = upcomingDecisions(SITUATIONS, {});
    const order = all.find((d) => d.materialId && d.date);
    expect(order).toBeDefined();
    const situation = SITUATIONS.find((s) => s.id === order!.situationId)!;
    const release = releaseFor(order!, situation.calculatedAt)!;
    const overrides: Record<string, SituationOverrides> = {
      [order!.situationId]: { dispositions: {}, releases: { [release.materialId]: release } },
    };

    const after = upcomingDecisions(SITUATIONS, overrides);
    expect(after.find((d) => d.key === order!.key)).toBeUndefined();
    expect(after.length).toBe(all.length - 1);

    const log = committedLog(SITUATIONS, overrides);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ kind: "release", situationId: order!.situationId, at: situation.calculatedAt });
  });
});

describe("decisions follow reconcile actions", () => {
  it("marking an item carry forward adds its material decisions to upcomingDecisions", () => {
    const situation = SITUATIONS.find((s) => s.materialExposure.available && s.candidateItems.length > 0);
    expect(situation).toBeDefined();
    const s = situation!;

    // Exit everything, so no item bears load and nothing needs ordering.
    const exitAll = Object.fromEntries(s.candidateItems.map((c) => [c.id, "intentional_exit" as const]));
    const materialOrders = (overrides: Record<string, SituationOverrides>) => {
      const rebuilt = buildSituations(DATASET, { overridesBySituation: overrides }).find((x) => x.id === s.id)!;
      return upcomingDecisions([rebuilt], overrides).filter((d) => d.kind === "material_order");
    };
    expect(materialOrders({ [s.id]: { dispositions: exitAll } })).toHaveLength(0);

    // Carry one item forward: its components appear, and name it as the driver.
    const carried = s.candidateItems.find((c) => {
      const overrides = { [s.id]: { dispositions: { ...exitAll, [c.id]: "carry_forward" as const } } };
      return materialOrders(overrides).length > 0;
    });
    expect(carried).toBeDefined();
    const after = materialOrders({ [s.id]: { dispositions: { ...exitAll, [carried!.id]: "carry_forward" } } });
    expect(after.length).toBeGreaterThan(0);
    expect(after.every((d) => d.drivenBy.includes(carried!.itemName))).toBe(true);
    expect(after.every((d) => d.situationId === s.id)).toBe(true);
  });
});

describe("nextDecision", () => {
  it("skips released orders and components stock already covers", () => {
    const all = upcomingDecisions(SITUATIONS, {});
    const next = nextDecision(all);
    expect(next).toBeDefined();
    expect(next!.released).toBeFalsy();
    if (next!.materialId && next!.quantity !== undefined) expect(next!.quantity).toBeGreaterThanOrEqual(0.5);

    const released = all.map((d) => (d.key === next!.key ? { ...d, released: true } : d));
    expect(nextDecision(released)?.key).not.toBe(next!.key);
  });
});

describe("releaseFor", () => {
  it("records the component by its own name, with the quantity and date under decision", () => {
    const order = upcomingDecisions(SITUATIONS, {}).find((d) => d.materialId && d.date)!;
    const release = releaseFor(order, "2027-03-08T09:00:00.000Z")!;
    expect(order.title).toBe(`Order ${release.materialName}`);
    expect(release.materialId).toBe(order.materialId);
    expect(release.decisionDate).toBe(order.date);
    expect(release.quantity).toBe(order.quantity ?? 0);
  });

  it("records the supplier awarded, and the row then says who it went to", () => {
    const order = upcomingDecisions(SITUATIONS, {}).find((d) => d.materialId && d.date)!;
    const release = releaseFor(order, "2027-03-08T09:00:00.000Z", {
      supplierId: "SUP-118",
      supplierName: "Northvale Flexibles",
    })!;
    expect(release).toMatchObject({ supplierId: "SUP-118", supplierName: "Northvale Flexibles" });
    expect(releaseFor(order, "2027-03-08T09:00:00.000Z")).not.toHaveProperty("supplierId");

    const situation = SITUATIONS.find((s) => s.id === order.situationId)!;
    const row = pendingDecisions(situation, { [release.materialId]: release }).find(
      (d) => d.materialId === release.materialId
    )!;
    expect(row.released).toBe(true);
    expect(row.releasedTo).toBe("Northvale Flexibles");
  });

  it("returns nothing for a decision that is not an order", () => {
    const other = upcomingDecisions(SITUATIONS, {}).find((d) => !d.materialId);
    expect(other).toBeDefined();
    expect(releaseFor(other!, "2027-03-08T09:00:00.000Z")).toBeUndefined();
  });
});

describe("pendingDecisions — every date says what it is", () => {
  it("labels order, capacity, representation and production dates, and states lead time plainly", () => {
    const all = SITUATIONS.flatMap((s) => pendingDecisions(s));
    const labelOf = { material_order: "Order by", line_capacity: "Resolve by", representation: "Decide by", production_start: "Starts" };
    for (const d of all) expect(d.dateLabel).toBe(labelOf[d.kind]);
    const order = all.find((d) => d.kind === "material_order" && /Arrives/.test(d.consequence));
    expect(order?.consequence).toMatch(/^Arrives \d+ days after ordering$/);
  });
});

describe("committedLog", () => {
  it("lists releases and volume commitments newest first, and skips programmes not in the dataset", () => {
    const [first] = SITUATIONS;
    expect(first).toBeDefined();
    const overrides: Record<string, SituationOverrides> = {
      [first!.id]: {
        dispositions: {},
        commitments: {
          c1: {
            candidateId: "c1",
            itemName: "Item One",
            units: 100,
            basisUnits: 80,
            basisLabel: "Last season",
            committedAt: "2027-03-01T00:00:00.000Z",
          },
        },
        releases: {
          m1: {
            materialId: "m1",
            materialName: "Cocoa",
            quantity: 10,
            uom: "kg",
            decisionDate: "2027-04-01",
            releasedAt: "2027-03-05T00:00:00.000Z",
          },
        },
      },
      "not-in-this-dataset": {
        dispositions: {},
        releases: {
          m2: {
            materialId: "m2",
            materialName: "Foil",
            quantity: 5,
            uom: "kg",
            decisionDate: "2027-04-01",
            releasedAt: "2027-03-07T00:00:00.000Z",
          },
        },
      },
    };

    const log = committedLog(SITUATIONS, overrides);
    expect(log.map((e) => e.kind)).toEqual(["release", "volume"]);
    expect(log.every((e) => e.situationId === first!.id)).toBe(true);
  });
});
