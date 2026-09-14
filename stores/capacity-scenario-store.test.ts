import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createMemoryStorage } from "./memory-storage";
import { setStorageNamespace } from "@/lib/utils/storage-scope";

const localStore = createMemoryStorage();

beforeAll(() => {
  Object.defineProperty(globalThis, "localStorage", { value: localStore, configurable: true, writable: true });
  setStorageNamespace("test-account");
});

const { useCapacityScenarioStore, CAPACITY_SCENARIO_STORAGE_KEY, isCapacityScenarioDirty } = await import(
  "./capacity-scenario-store"
);
const { countCapacityAdjustments } = await import("@/lib/situations/capacity-plan");

const store = () => useCapacityScenarioStore.getState();
const NOW = "2027-03-08T09:00:00.000Z";

beforeEach(() => {
  localStore.clear();
  useCapacityScenarioStore.setState({ scenarios: {}, activeScenarioId: null });
});

describe("capacity scenario lifecycle", () => {
  it("creating makes the scenario active with no changes", () => {
    const id = store().createScenario("Plant plan", NOW);
    expect(store().activeScenarioId).toBe(id);
    expect(countCapacityAdjustments(store().scenarios[id]!.adjustments)).toBe(0);
  });

  it("duplicating copies adjustments rather than sharing them", () => {
    const a = store().createScenario("A", NOW);
    store().setAvailableHours(a, "LINE-03", "2027-06", 500);
    const b = store().duplicateScenario(a, NOW)!;
    store().setAvailableHours(b, "LINE-03", "2027-06", 600);
    expect(store().scenarios[a]!.adjustments.availableHours["LINE-03::2027-06"]).toBe(500);
    expect(store().scenarios[b]!.adjustments.availableHours["LINE-03::2027-06"]).toBe(600);
  });

  it("deleting the active scenario clears the selection", () => {
    const id = store().createScenario("A", NOW);
    store().deleteScenario(id);
    expect(store().activeScenarioId).toBeNull();
  });
});

describe("capacity levers", () => {
  it("records each lever under its own key", () => {
    const id = store().createScenario("A", NOW);
    store().setAvailableHours(id, "LINE-03", "2027-06", 500);
    store().setExtraShift(id, "LINE-03", "2027-06", true);
    store().setMoveWeeks(id, "LINE-03", 6);
    store().setAllocation(id, "Ridgeline::laydown bag", 0.8);

    const a = store().scenarios[id]!.adjustments;
    expect(a.availableHours["LINE-03::2027-06"]).toBe(500);
    expect(a.extraShifts["LINE-03::2027-06"]).toBe(1);
    expect(a.moveWeeks["LINE-03"]).toBe(6);
    expect(a.allocation["Ridgeline::laydown bag"]).toBe(0.8);
    expect(countCapacityAdjustments(a)).toBe(4);
  });

  it("setting a lever back to its baseline removes the override", () => {
    const id = store().createScenario("A", NOW);
    store().setExtraShift(id, "LINE-03", "2027-06", true);
    store().setExtraShift(id, "LINE-03", "2027-06", false);
    store().setMoveWeeks(id, "LINE-03", 6);
    store().setMoveWeeks(id, "LINE-03", 0);
    store().setAllocation(id, "Ridgeline::laydown bag", 0.5);
    store().setAllocation(id, "Ridgeline::laydown bag", 1);
    expect(countCapacityAdjustments(store().scenarios[id]!.adjustments)).toBe(0);
  });

  it("clamps allocation to 0-100% and pull-forward to 0-8 weeks — never later", () => {
    const id = store().createScenario("A", NOW);
    store().setAllocation(id, "x", -2);
    store().setMoveWeeks(id, "LINE-01", 40);
    store().setMoveWeeks(id, "LINE-02", -40);
    expect(store().scenarios[id]!.adjustments.allocation.x).toBe(0);
    expect(store().scenarios[id]!.adjustments.moveWeeks["LINE-01"]).toBe(8);
    expect(store().scenarios[id]!.adjustments.moveWeeks["LINE-02"]).toBeUndefined();
  });

  it("reset clears every lever but keeps the scenario", () => {
    const id = store().createScenario("A", NOW);
    store().setAvailableHours(id, "LINE-03", "2027-06", 500);
    store().resetScenario(id);
    expect(countCapacityAdjustments(store().scenarios[id]!.adjustments)).toBe(0);
    expect(store().scenarios[id]!.name).toBe("A");
  });
});

describe("save and discard", () => {
  it("a new scenario is clean; an edit makes it dirty; saving makes it clean again", () => {
    const id = store().createScenario("A", NOW);
    expect(isCapacityScenarioDirty(store().scenarios[id])).toBe(false);
    store().setAvailableHours(id, "LINE-03", "2027-06", 500);
    expect(isCapacityScenarioDirty(store().scenarios[id])).toBe(true);
    store().saveScenario(id);
    expect(isCapacityScenarioDirty(store().scenarios[id])).toBe(false);
    expect(store().scenarios[id]!.savedAdjustments.availableHours["LINE-03::2027-06"]).toBe(500);
  });

  it("discarding restores the saved snapshot", () => {
    const id = store().createScenario("A", NOW);
    store().setAvailableHours(id, "LINE-03", "2027-06", 500);
    store().saveScenario(id);
    store().setAvailableHours(id, "LINE-03", "2027-06", 600);
    store().setMoveWeeks(id, "LINE-03", 4);
    store().discardChanges(id);
    const a = store().scenarios[id]!.adjustments;
    expect(a.availableHours["LINE-03::2027-06"]).toBe(500);
    expect(a.moveWeeks).toEqual({});
    expect(isCapacityScenarioDirty(store().scenarios[id])).toBe(false);
  });

  it("migrates v1: pull-forward becomes a signed move and existing work counts as saved", async () => {
    const { persist } = useCapacityScenarioStore;
    const migrate = persist.getOptions().migrate!;
    const migrated = (await migrate(
      {
        scenarios: {
          cap_1: {
            id: "cap_1",
            name: "Old",
            adjustments: { availableHours: { "LINE-03::2027-06": 500 }, extraShifts: {}, pullForwardWeeks: { "LINE-03": 12 }, allocation: {} },
            createdAt: NOW,
            updatedAt: NOW,
          },
        },
        activeScenarioId: "cap_1",
      },
      1
    )) as { scenarios: Record<string, import("@/lib/situations/capacity-plan").CapacityScenario> };
    const scenario = migrated.scenarios.cap_1!;
    expect(scenario.adjustments.moveWeeks["LINE-03"]).toBe(8);
    expect(scenario.savedAdjustments).toEqual(scenario.adjustments);
    expect(isCapacityScenarioDirty(scenario)).toBe(false);
  });

  it("migrates v2: building later is dropped from the draft and the saved snapshot", async () => {
    const migrate = useCapacityScenarioStore.persist.getOptions().migrate!;
    const adjustments = {
      availableHours: {},
      extraShifts: {},
      moveWeeks: { "LINE-01": -6, "LINE-02": 4 },
      allocation: {},
    };
    const migrated = (await migrate(
      {
        scenarios: {
          cap_1: { id: "cap_1", name: "Old", adjustments, savedAdjustments: adjustments, createdAt: NOW, updatedAt: NOW },
        },
        activeScenarioId: "cap_1",
      },
      2
    )) as { scenarios: Record<string, import("@/lib/situations/capacity-plan").CapacityScenario> };
    const scenario = migrated.scenarios.cap_1!;
    expect(scenario.adjustments.moveWeeks).toEqual({ "LINE-02": 4 });
    expect(scenario.savedAdjustments.moveWeeks).toEqual({ "LINE-02": 4 });
    expect(isCapacityScenarioDirty(scenario)).toBe(false);
  });
});

describe("persistence", () => {
  it("stores overrides only — never a derived planning number", () => {
    const id = store().createScenario("A", NOW);
    store().setAvailableHours(id, "LINE-03", "2027-06", 500);
    const parsed = JSON.parse(localStore.getItem(`${CAPACITY_SCENARIO_STORAGE_KEY}:test-account`)!) as {
      state: { scenarios: Record<string, Record<string, unknown>> };
    };
    expect(Object.keys(parsed.state.scenarios[id]!).sort()).toEqual(
      ["adjustments", "createdAt", "id", "name", "savedAdjustments", "updatedAt"].sort()
    );
  });
});
