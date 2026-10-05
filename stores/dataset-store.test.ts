import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createMemoryStorage } from "./memory-storage";
import { setStorageNamespace } from "@/lib/utils/storage-scope";

const localStore = createMemoryStorage();
const sessionStore = createMemoryStorage();

beforeAll(() => {
  Object.defineProperty(globalThis, "localStorage", { value: localStore, configurable: true, writable: true });
  Object.defineProperty(globalThis, "sessionStorage", { value: sessionStore, configurable: true, writable: true });
  // Planning keys are scoped to an account; nothing persists until one is bound.
  setStorageNamespace("test-account");
});

const { useDatasetStore, DATASET_STORAGE_KEY } = await import("./dataset-store");
const { DEFAULT_DEMO_SEED } = await import("@/lib/dataset/demo/generate");

const store = () => useDatasetStore.getState();
const note = (text: string) => ({ actor: "James", text, at: "2026-10-05T09:00:00.000Z" });

beforeEach(() => {
  localStore.clear();
  sessionStore.clear();
  useDatasetStore.setState(useDatasetStore.getInitialState());
});

describe("mode selection", () => {
  it("starts with no mode so the first run screen is shown", () => {
    expect(store().mode).toBeNull();
  });

  it("choosing demo records the seed in the dataset id", () => {
    store().chooseDemo();
    expect(store().mode).toBe("DEMO");
    expect(store().datasetId).toBe(`demo:${DEFAULT_DEMO_SEED}`);
    expect(store().uploadedFileName).toBeNull();
  });

  it("choosing an upload records the file and marks it stored", () => {
    store().chooseUpload({ fileName: "plan.xlsx", uploadedAt: "2026-10-05T09:00:00.000Z", datasetName: "plan", stored: true });
    expect(store().mode).toBe("UPLOADED");
    expect(store().hasStoredUpload).toBe(true);
    expect(store().datasetId).toBe("upload:2026-10-05T09:00:00.000Z");
  });

  it("an upload that only reached this tab is not marked stored", () => {
    store().chooseUpload({ fileName: "p.xlsx", uploadedAt: "x", datasetName: "p", stored: false });
    expect(store().hasStoredUpload).toBe(false);
  });
});

describe("planner decisions", () => {
  it("setOverride merges into a transition and logs the decision", () => {
    store().setOverride("TR-1001", { relationshipDecision: "CONFIRMED" }, note("Confirmed CS-1048 → CS-2841"));
    store().setOverride("TR-1001", { safetyStockWeeks: 3 }, note("Safety stock 2 → 3 weeks"));
    store().setOverride("TR-1002", { substitutabilityPct: 0.5 }, note("Substitutability 50%"));
    expect(store().overridesByTransition["TR-1001"]).toEqual({ relationshipDecision: "CONFIRMED", safetyStockWeeks: 3 });
    expect(store().overridesByTransition["TR-1002"]).toEqual({ substitutabilityPct: 0.5 });
    expect(store().auditLog.map((a) => [a.transitionId, a.text, a.actor])).toEqual([
      ["TR-1001", "Confirmed CS-1048 → CS-2841", "James"],
      ["TR-1001", "Safety stock 2 → 3 weeks", "James"],
      ["TR-1002", "Substitutability 50%", "James"],
    ]);
    expect(new Set(store().auditLog.map((a) => a.id)).size).toBe(3);
  });

  it("clearOverrides removes only the named keys, and is logged", () => {
    store().setOverride("TR-1001", { safetyStockWeeks: 3, substitutabilityPct: 0.8 }, note("set"));
    store().clearOverrides("TR-1001", ["safetyStockWeeks"], note("Reset safety stock"));
    expect(store().overridesByTransition["TR-1001"]).toEqual({ substitutabilityPct: 0.8 });
    expect(store().auditLog).toHaveLength(2);
  });

  it("records and reopens an action", () => {
    store().setActionState("TR-1001:transfer", "TR-1001", { disposition: "DONE", at: "2026-10-05T09:00:00.000Z" }, note("Approved transfer"));
    expect(store().actionStates["TR-1001:transfer"]?.disposition).toBe("DONE");
    store().reopenAction("TR-1001:transfer", "TR-1001", note("Reopened"));
    expect(store().actionStates["TR-1001:transfer"]).toBeUndefined();
    expect(store().auditLog.map((a) => a.text)).toEqual(["Approved transfer", "Reopened"]);
  });
});

describe("switching source discards decisions made against the old data", () => {
  const decide = () => {
    store().setOverride("TR-1001", { relationshipDecision: "CONFIRMED" }, note("c"));
    store().setActionState("a", "TR-1001", { disposition: "DONE", at: "x" }, note("d"));
  };
  const expectClean = () => {
    expect(store().overridesByTransition).toEqual({});
    expect(store().actionStates).toEqual({});
    expect(store().auditLog).toEqual([]);
  };

  it("moving from demo to an upload", () => {
    store().chooseDemo();
    decide();
    store().chooseUpload({ fileName: "p.xlsx", uploadedAt: "x", datasetName: "p", stored: true });
    expectClean();
  });

  it("regenerating the demo", () => {
    store().chooseDemo();
    decide();
    store().regenerateDemo("fresh");
    expectClean();
  });

  it("re-choosing the same demo keeps decisions", () => {
    store().chooseDemo();
    decide();
    store().chooseDemo();
    expect(store().overridesByTransition["TR-1001"]).toBeDefined();
  });

  it("clearDataset returns to the first-run state", () => {
    store().chooseDemo();
    decide();
    store().clearDataset();
    expect(store().mode).toBeNull();
    expectClean();
  });
});

describe("persistence", () => {
  it("persists the mode and decisions — never a derived number", () => {
    store().chooseDemo("persisted-seed");
    store().setOverride("TR-1001", { safetyStockWeeks: 3 }, note("s"));
    const parsed = JSON.parse(localStore.getItem(`${DATASET_STORAGE_KEY}:test-account`)!) as { state: Record<string, unknown> };
    expect(parsed.state.seed).toBe("persisted-seed");
    expect(parsed.state.overridesByTransition).toEqual({ "TR-1001": { safetyStockWeeks: 3 } });
    expect(Object.keys(parsed.state).sort()).toEqual(
      [
        "actionStates",
        "auditLog",
        "datasetId",
        "datasetName",
        "hasStoredUpload",
        "mode",
        "overridesByTransition",
        "seed",
        "uploadedAt",
        "uploadedFileName",
      ].sort()
    );
  });
});
