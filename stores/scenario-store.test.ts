import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createMemoryStorage } from "./memory-storage";
import { setStorageNamespace } from "@/lib/utils/storage-scope";

const localStore = createMemoryStorage();

beforeAll(() => {
  Object.defineProperty(globalThis, "localStorage", { value: localStore, configurable: true, writable: true });
  setStorageNamespace("test-account");
});

const { useScenarioStore, SCENARIO_STORAGE_KEY } = await import("./scenario-store");
const s = () => useScenarioStore.getState();

beforeEach(() => {
  localStore.clear();
  useScenarioStore.setState(useScenarioStore.getInitialState());
});

describe("scenario levers", () => {
  it("sets and clears one lever per transition", () => {
    s().setLever("TR-1001", "inboundDelayWeeks", 2);
    s().setLever("TR-1001", "substitutabilityPct", 0.5);
    s().setLever("TR-1002", "safetyStockWeeks", 4);
    expect(s().drafts["TR-1001"]).toEqual({ inboundDelayWeeks: 2, substitutabilityPct: 0.5 });
    s().setLever("TR-1001", "inboundDelayWeeks", undefined);
    expect(s().drafts["TR-1001"]).toEqual({ substitutabilityPct: 0.5 });
    expect(s().drafts["TR-1002"]).toEqual({ safetyStockWeeks: 4 });
  });

  it("resetDraft removes one transition's levers only", () => {
    s().setLever("TR-1001", "inboundDelayWeeks", 2);
    s().setLever("TR-1002", "inboundDelayWeeks", 3);
    s().resetDraft("TR-1001");
    expect(s().drafts["TR-1001"]).toBeUndefined();
    expect(s().drafts["TR-1002"]).toEqual({ inboundDelayWeeks: 3 });
  });

  it("setDraft copies, so a loaded scenario is not edited in place", () => {
    const adjustments = { inboundDelayWeeks: 1 };
    s().setDraft("TR-1001", adjustments);
    s().setLever("TR-1001", "inboundDelayWeeks", 5);
    expect(adjustments.inboundDelayWeeks).toBe(1);
  });
});

describe("saved scenarios", () => {
  it("saves a snapshot of the draft that later lever moves do not change", () => {
    s().setLever("TR-1001", "inboundDelayWeeks", 2);
    const id = s().saveScenario("TR-1001", "Two-week delay", "2026-10-05T09:00:00.000Z");
    s().setLever("TR-1001", "inboundDelayWeeks", 6);
    expect(s().saved[id]).toMatchObject({ transitionId: "TR-1001", name: "Two-week delay", adjustments: { inboundDelayWeeks: 2 } });
  });

  it("gives each save its own id, and deletes one", () => {
    const a = s().saveScenario("TR-1001", "A", "t");
    const b = s().saveScenario("TR-1001", "B", "t");
    expect(a).not.toBe(b);
    s().deleteScenario(a);
    expect(Object.keys(s().saved)).toEqual([b]);
  });

  it("persists levers only, under the account's key", () => {
    s().setLever("TR-1001", "inboundDelayWeeks", 2);
    const parsed = JSON.parse(localStore.getItem(`${SCENARIO_STORAGE_KEY}:test-account`)!) as { state: Record<string, unknown> };
    expect(Object.keys(parsed.state).sort()).toEqual(["drafts", "saved"]);
  });
});
