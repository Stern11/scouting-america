import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createMemoryStorage } from "./memory-storage";
import { namespaceFor, storageNamespace } from "@/lib/utils/storage-scope";

const localStore = createMemoryStorage();

beforeAll(() => {
  Object.defineProperty(globalThis, "localStorage", { value: localStore, configurable: true, writable: true });
});

const { useDatasetStore, DATASET_STORAGE_KEY } = await import("./dataset-store");
const { useScenarioStore, SCENARIO_STORAGE_KEY } = await import("./scenario-store");
const { bindPlanningStorage, removePlanningDataForAccount } = await import("./storage-scope");

const ALICE = namespaceFor("alice@example.com");
const BOB = namespaceFor("bob@example.com");
const aliceKey = `${DATASET_STORAGE_KEY}:${ALICE}`;
const bobKey = `${DATASET_STORAGE_KEY}:${BOB}`;

const dataset = () => useDatasetStore.getState();

beforeEach(async () => {
  await bindPlanningStorage(null);
  useDatasetStore.setState(useDatasetStore.getInitialState());
  useScenarioStore.setState(useScenarioStore.getInitialState());
  localStore.clear();
});

describe("namespaceFor", () => {
  it("is stable, case-insensitive, and does not spell out the email", () => {
    expect(namespaceFor(" Alice@Example.com ")).toBe(ALICE);
    expect(ALICE).not.toBe(BOB);
    expect(ALICE).not.toContain("alice");
  });
});

describe("planning storage is scoped to the signed-in account", () => {
  it("writes nothing before an account is bound", () => {
    dataset().chooseDemo("nobody-seed");
    expect(localStore.length).toBe(0);
  });

  it("keeps each account's data under its own key", async () => {
    await bindPlanningStorage(ALICE);
    dataset().chooseDemo("alice-seed");
    expect(localStore.getItem(aliceKey)).toContain("alice-seed");

    await bindPlanningStorage(BOB);
    expect(dataset().mode).toBeNull();
    dataset().chooseDemo("bob-seed");
    expect(localStore.getItem(bobKey)).toContain("bob-seed");
    // Bob's session never overwrote Alice's.
    expect(localStore.getItem(aliceKey)).toContain("alice-seed");

    await bindPlanningStorage(ALICE);
    expect(dataset().seed).toBe("alice-seed");
  });

  it("clears the previous account's state even when the next account has nothing stored", async () => {
    await bindPlanningStorage(ALICE);
    dataset().chooseDemo("alice-seed");
    const note = { actor: "Alice", text: "Confirmed", at: "2026-10-05T09:00:00.000Z" };
    dataset().setOverride("TR-1001", { relationshipDecision: "CONFIRMED" }, note);
    useScenarioStore.getState().setLever("TR-1001", "inboundDelayWeeks", 2);

    await bindPlanningStorage(BOB);
    expect(dataset().mode).toBeNull();
    expect(dataset().overridesByTransition).toEqual({});
    expect(dataset().auditLog).toEqual([]);
    expect(useScenarioStore.getState().drafts).toEqual({});
  });

  it("scopes simulator scenarios to the account too", async () => {
    await bindPlanningStorage(ALICE);
    useScenarioStore.getState().setLever("TR-1001", "inboundDelayWeeks", 2);
    const id = useScenarioStore.getState().saveScenario("TR-1001", "Alice delay case", "2026-10-05T09:00:00.000Z");
    expect(localStore.getItem(`${SCENARIO_STORAGE_KEY}:${ALICE}`)).toContain("Alice delay case");

    await bindPlanningStorage(BOB);
    expect(useScenarioStore.getState().saved).toEqual({});

    await bindPlanningStorage(ALICE);
    expect(useScenarioStore.getState().saved[id]?.name).toBe("Alice delay case");
  });

  it("drops data stored before storage was scoped rather than handing it to whoever signs in", async () => {
    localStore.setItem(DATASET_STORAGE_KEY, JSON.stringify({ state: { mode: "DEMO", seed: "legacy" }, version: 1 }));
    await bindPlanningStorage(ALICE);
    expect(localStore.getItem(DATASET_STORAGE_KEY)).toBeNull();
    expect(dataset().seed).not.toBe("legacy");
  });

  it("'remove my data' deletes this account's data and leaves other accounts alone", async () => {
    await bindPlanningStorage(BOB);
    dataset().chooseDemo("bob-seed");
    await bindPlanningStorage(ALICE);
    dataset().chooseDemo("alice-seed");

    await removePlanningDataForAccount();
    expect(localStore.getItem(aliceKey)).toBeNull();
    expect(localStore.getItem(bobKey)).toContain("bob-seed");
    expect(dataset().mode).toBeNull();
    expect(storageNamespace()).toBeNull();
  });
});
