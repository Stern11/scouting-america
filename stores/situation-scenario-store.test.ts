import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createMemoryStorage } from "./memory-storage";
import { setStorageNamespace } from "@/lib/utils/storage-scope";

const localStore = createMemoryStorage();

beforeAll(() => {
  Object.defineProperty(globalThis, "localStorage", { value: localStore, configurable: true, writable: true });
  Object.defineProperty(globalThis, "sessionStorage", {
    value: createMemoryStorage(),
    configurable: true,
    writable: true,
  });
  // Planning keys are scoped to an account; nothing persists until one is bound.
  setStorageNamespace("test-account");
});

const { useSituationScenarioStore, SITUATION_SCENARIO_STORAGE_KEY, isScenarioDirty } = await import(
  "./situation-scenario-store"
);
const { countAdjustments } = await import("@/lib/situations/scenario");

const store = () => useSituationScenarioStore.getState();
const NOW = "2027-03-08T09:00:00.000Z";

beforeEach(() => {
  localStore.clear();
  useSituationScenarioStore.setState({ scenarios: {}, activeScenarioId: null, viewMode: "baseline" });
});

describe("scenario lifecycle", () => {
  it("creating a scenario makes it active and switches the view to scenario", () => {
    const id = store().createScenario("halloween", "Scenario A", NOW);
    expect(store().activeScenarioId).toBe(id);
    expect(store().viewMode).toBe("scenario");
    expect(store().scenarios[id]?.situationId).toBe("halloween");
    expect(countAdjustments(store().scenarios[id]!.adjustments)).toBe(0);
  });

  it("duplicating copies the adjustments rather than sharing them", () => {
    const a = store().createScenario("halloween", "A", NOW);
    store().setAvailableHours(a, "LINE-03", "2027-06", 720);

    const b = store().duplicateScenario(a, NOW)!;
    expect(b).not.toBe(a);
    expect(store().scenarios[b]?.adjustments.availableHours["LINE-03::2027-06"]).toBe(720);

    // Editing the copy must not reach back into the original.
    store().setAvailableHours(b, "LINE-03", "2027-06", 500);
    expect(store().scenarios[a]?.adjustments.availableHours["LINE-03::2027-06"]).toBe(720);
    expect(store().scenarios[b]?.adjustments.availableHours["LINE-03::2027-06"]).toBe(500);
  });

  it("deleting the active scenario returns the view to baseline", () => {
    const id = store().createScenario("halloween", "A", NOW);
    store().deleteScenario(id);
    expect(store().scenarios[id]).toBeUndefined();
    expect(store().activeScenarioId).toBeNull();
    expect(store().viewMode).toBe("baseline");
  });

  it("deleting a different scenario leaves the active one alone", () => {
    const a = store().createScenario("halloween", "A", NOW);
    const b = store().createScenario("halloween", "B", NOW);
    store().setActiveScenario(b);
    store().deleteScenario(a);
    expect(store().activeScenarioId).toBe(b);
  });

  it("renaming and noting do not disturb adjustments", () => {
    const id = store().createScenario("halloween", "A", NOW);
    store().setAvailableHours(id, "LINE-03", "2027-06", 720);
    store().renameScenario(id, "Prebuild plan");
    store().setNote(id, "Discussed in S&OP");
    expect(store().scenarios[id]?.name).toBe("Prebuild plan");
    expect(store().scenarios[id]?.note).toBe("Discussed in S&OP");
    expect(store().scenarios[id]?.adjustments.availableHours["LINE-03::2027-06"]).toBe(720);
  });
});

describe("adjustments", () => {
  it("records each category under its own composite key", () => {
    const id = store().createScenario("halloween", "A", NOW);
    store().setAvailableHours(id, "LINE-03", "2027-06", 720);
    store().setTargetUtilization(id, "LINE-03", 0.85);
    store().setRunRate(id, "Variety Bags", "LINE-03", 9000);
    store().setAllocation(id, "Variety Bags", "LINE-03", 0.4);
    store().setLeadTime(id, "MAT-FILM", 81);

    const a = store().scenarios[id]!.adjustments;
    expect(a.availableHours["LINE-03::2027-06"]).toBe(720);
    expect(a.targetUtilization["LINE-03"]).toBe(0.85);
    expect(a.runRate["Variety Bags::LINE-03"]).toBe(9000);
    expect(a.allocation["Variety Bags::LINE-03"]).toBe(0.4);
    expect(a.leadTimeDays["MAT-FILM"]).toBe(81);
    expect(countAdjustments(a)).toBe(5);
  });

  it("clearing one adjustment leaves the rest", () => {
    const id = store().createScenario("halloween", "A", NOW);
    store().setAvailableHours(id, "LINE-03", "2027-06", 720);
    store().setAvailableHours(id, "LINE-04", "2027-06", 600);
    store().clearAdjustment(id, "availableHours", "LINE-03::2027-06");

    const a = store().scenarios[id]!.adjustments;
    expect(a.availableHours["LINE-03::2027-06"]).toBeUndefined();
    expect(a.availableHours["LINE-04::2027-06"]).toBe(600);
  });

  it("resetting one category leaves the others", () => {
    const id = store().createScenario("halloween", "A", NOW);
    store().setAvailableHours(id, "LINE-03", "2027-06", 720);
    store().setLeadTime(id, "MAT-FILM", 81);
    store().resetCategory(id, "availableHours");

    const a = store().scenarios[id]!.adjustments;
    expect(a.availableHours).toEqual({});
    expect(a.leadTimeDays["MAT-FILM"]).toBe(81);
  });

  it("resetting the scenario clears every category but keeps the scenario", () => {
    const id = store().createScenario("halloween", "A", NOW);
    store().setAvailableHours(id, "LINE-03", "2027-06", 720);
    store().setLeadTime(id, "MAT-FILM", 81);
    store().resetScenario(id);

    expect(countAdjustments(store().scenarios[id]!.adjustments)).toBe(0);
    expect(store().scenarios[id]?.name).toBe("A");
  });

  it("ignores a write to a scenario that does not exist", () => {
    store().setAvailableHours("missing", "LINE-03", "2027-06", 720);
    expect(store().scenarios.missing).toBeUndefined();
  });
});

describe("save and discard", () => {
  it("a new scenario is clean; an edit makes it dirty; saving makes it clean", () => {
    const id = store().createScenario("halloween", "A", NOW);
    expect(isScenarioDirty(store().scenarios[id])).toBe(false);
    store().setVolumeUnits(id, "cand-1", 86);
    expect(isScenarioDirty(store().scenarios[id])).toBe(true);
    store().saveScenario(id);
    expect(isScenarioDirty(store().scenarios[id])).toBe(false);
  });

  it("discarding restores the saved snapshot", () => {
    const id = store().createScenario("halloween", "A", NOW);
    store().setVolumeUnits(id, "cand-1", 120);
    store().saveScenario(id);
    store().setVolumeUnits(id, "cand-1", 86);
    store().setVolumeUnits(id, "cand-2", 10);
    store().discardChanges(id);
    expect(store().scenarios[id]!.adjustments.volumeUnits).toEqual({ "cand-1": 120 });
    expect(isScenarioDirty(store().scenarios[id])).toBe(false);
  });

  it("clearing an edit back to the saved value is clean again", () => {
    const id = store().createScenario("halloween", "A", NOW);
    store().setVolumeUnits(id, "cand-1", 86);
    store().clearAdjustment(id, "volumeUnits", "cand-1");
    expect(isScenarioDirty(store().scenarios[id])).toBe(false);
  });

  it("migrates older scenarios with their current adjustments treated as saved", async () => {
    const migrate = useSituationScenarioStore.persist.getOptions().migrate!;
    const migrated = (await migrate(
      {
        scenarios: {
          scn_1: {
            id: "scn_1",
            name: "Old",
            situationId: "halloween",
            adjustments: { availableHours: {}, targetUtilization: {}, runRate: {}, allocation: {}, leadTimeDays: { "MAT-FILM": 81 } },
            createdAt: NOW,
            updatedAt: NOW,
          },
        },
      },
      2
    )) as { scenarios: Record<string, Parameters<typeof isScenarioDirty>[0] & object> };
    const scenario = migrated.scenarios.scn_1!;
    expect(scenario.adjustments.volumeUnits).toEqual({});
    expect(scenario.savedAdjustments.leadTimeDays["MAT-FILM"]).toBe(81);
    expect(isScenarioDirty(scenario)).toBe(false);
  });
});

describe("persistence", () => {
  it("stores overrides only — never a derived planning number", () => {
    const id = store().createScenario("halloween", "A", NOW);
    store().setAvailableHours(id, "LINE-03", "2027-06", 720);

    const parsed = JSON.parse(localStore.getItem(`${SITUATION_SCENARIO_STORAGE_KEY}:test-account`)!) as {
      state: { scenarios: Record<string, Record<string, unknown>> };
    };
    const stored = parsed.state.scenarios[id]!;
    expect(Object.keys(stored).sort()).toEqual(
      ["adjustments", "createdAt", "id", "name", "savedAdjustments", "situationId", "updatedAt"].sort()
    );
  });
});
