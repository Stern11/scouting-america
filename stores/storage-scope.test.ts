import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createMemoryStorage } from "./memory-storage";
import { namespaceFor, storageNamespace } from "@/lib/utils/storage-scope";

const localStore = createMemoryStorage();

beforeAll(() => {
  Object.defineProperty(globalThis, "localStorage", { value: localStore, configurable: true, writable: true });
});

const { useDatasetStore, DATASET_STORAGE_KEY } = await import("./dataset-store");
const { useSituationScenarioStore } = await import("./situation-scenario-store");
const { useCapacityScenarioStore, CAPACITY_SCENARIO_STORAGE_KEY } = await import("./capacity-scenario-store");
const { bindPlanningStorage, removePlanningDataForAccount } = await import("./storage-scope");

const ALICE = namespaceFor("alice@example.com");
const BOB = namespaceFor("bob@example.com");
const aliceKey = `${DATASET_STORAGE_KEY}:${ALICE}`;
const bobKey = `${DATASET_STORAGE_KEY}:${BOB}`;

const dataset = () => useDatasetStore.getState();

beforeEach(async () => {
  await bindPlanningStorage(null);
  useDatasetStore.setState(useDatasetStore.getInitialState());
  useSituationScenarioStore.setState(useSituationScenarioStore.getInitialState());
  useCapacityScenarioStore.setState(useCapacityScenarioStore.getInitialState());
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
    dataset().setDisposition("halloween", "sku::a", "carry_forward");
    useSituationScenarioStore.getState().createScenario("halloween", "Alice's", "2027-03-08T09:00:00.000Z");

    await bindPlanningStorage(BOB);
    expect(dataset().mode).toBeNull();
    expect(dataset().overridesBySituation).toEqual({});
    expect(useSituationScenarioStore.getState().scenarios).toEqual({});
  });

  it("scopes capacity scenarios to the account too", async () => {
    await bindPlanningStorage(ALICE);
    const id = useCapacityScenarioStore.getState().createScenario("Alice plant plan", "2027-03-08T09:00:00.000Z");
    expect(localStore.getItem(`${CAPACITY_SCENARIO_STORAGE_KEY}:${ALICE}`)).toContain("Alice plant plan");

    await bindPlanningStorage(BOB);
    expect(useCapacityScenarioStore.getState().scenarios).toEqual({});

    await bindPlanningStorage(ALICE);
    expect(useCapacityScenarioStore.getState().scenarios[id]?.name).toBe("Alice plant plan");
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
