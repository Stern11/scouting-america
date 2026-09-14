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

beforeEach(() => {
  localStore.clear();
  sessionStore.clear();
  useDatasetStore.setState({
    mode: null,
    datasetId: "demo",
    datasetName: "Demo planning data",
    seed: DEFAULT_DEMO_SEED,
    uploadedFileName: null,
    uploadedAt: null,
    hasStoredUpload: false,
    activeSituationId: null,
    overridesBySituation: {},
  });
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

  it("regenerating demo swaps the seed, which is what identifies the dataset", () => {
    store().chooseDemo();
    store().regenerateDemo("another-seed");
    expect(store().seed).toBe("another-seed");
    expect(store().datasetId).toBe("demo:another-seed");
  });

  it("choosing an upload records the file and marks it stored", () => {
    store().chooseUpload({
      fileName: "plan.xlsx",
      uploadedAt: "2027-03-08T09:00:00.000Z",
      datasetName: "plan",
      stored: true,
    });
    expect(store().mode).toBe("UPLOADED");
    expect(store().uploadedFileName).toBe("plan.xlsx");
    expect(store().hasStoredUpload).toBe(true);
    // The id changes with every upload, which is the signal to re-read storage.
    expect(store().datasetId).toBe("upload:2027-03-08T09:00:00.000Z");
  });
});

describe("switching source discards decisions made against the old data", () => {
  // A disposition names a candidate item id from one dataset. Carrying those
  // ids into a different dataset would silently attach a planner's decision to
  // an unrelated item.
  it("clears dispositions when moving from demo to an upload", () => {
    store().chooseDemo();
    store().setDisposition("halloween", "hi_1", "carry_forward");
    expect(store().overridesBySituation.halloween?.dispositions.hi_1).toBe("carry_forward");

    store().chooseUpload({ fileName: "p.xlsx", uploadedAt: "x", datasetName: "p", stored: true });
    expect(store().overridesBySituation).toEqual({});
    expect(store().activeSituationId).toBeNull();
  });

  it("clears dispositions when regenerating the demo dataset", () => {
    store().chooseDemo();
    store().setDisposition("halloween", "hi_1", "intentional_exit");
    store().regenerateDemo("fresh");
    expect(store().overridesBySituation).toEqual({});
  });

  it("clearDataset returns to the first-run state", () => {
    store().chooseUpload({ fileName: "p.xlsx", uploadedAt: "x", datasetName: "p", stored: true });
    store().setDisposition("s", "c", "carry_forward");
    store().clearDataset();
    expect(store().mode).toBeNull();
    expect(store().hasStoredUpload).toBe(false);
    expect(store().overridesBySituation).toEqual({});
  });
});

describe("dispositions", () => {
  it("records one decision without disturbing others", () => {
    store().setDisposition("halloween", "hi_1", "carry_forward");
    store().setDisposition("halloween", "hi_2", "intentional_exit");
    store().setDisposition("holiday", "hi_9", "under_review");

    expect(store().overridesBySituation.halloween?.dispositions).toEqual({
      hi_1: "carry_forward",
      hi_2: "intentional_exit",
    });
    expect(store().overridesBySituation.holiday?.dispositions).toEqual({ hi_9: "under_review" });
  });

  it("merges a bulk update over existing decisions", () => {
    store().setDisposition("halloween", "hi_1", "carry_forward");
    store().setDispositions("halloween", { hi_2: "already_represented", hi_1: "under_review" });
    expect(store().overridesBySituation.halloween?.dispositions).toEqual({
      hi_1: "under_review",
      hi_2: "already_represented",
    });
  });

  it("resets one situation without touching another", () => {
    store().setDisposition("halloween", "hi_1", "carry_forward");
    store().setDisposition("holiday", "hi_9", "carry_forward");
    store().resetDispositions("halloween");
    expect(store().overridesBySituation.halloween?.dispositions).toEqual({});
    expect(store().overridesBySituation.holiday?.dispositions).toEqual({ hi_9: "carry_forward" });
  });

  it("keeps a match config alongside dispositions", () => {
    store().setDisposition("halloween", "hi_1", "carry_forward");
    store().setMatchConfig("halloween", { dimensions: [], threshold: 0.5 });
    expect(store().overridesBySituation.halloween?.matchConfig?.threshold).toBe(0.5);
    expect(store().overridesBySituation.halloween?.dispositions.hi_1).toBe("carry_forward");
  });
});

describe("an upload that only reached this tab", () => {
  it("is not marked as stored", () => {
    store().chooseUpload({ fileName: "p.xlsx", uploadedAt: "x", datasetName: "p", stored: false });
    expect(store().mode).toBe("UPLOADED");
    expect(store().hasStoredUpload).toBe(false);
  });
});

describe("persistence", () => {
  it("writes the chosen mode and decisions to local storage so a refresh keeps them", async () => {
    store().chooseDemo("persisted-seed");
    store().setDisposition("halloween", "hi_1", "carry_forward");

    const raw = localStore.getItem(`${DATASET_STORAGE_KEY}:test-account`);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!) as { state: Record<string, unknown> };
    expect(parsed.state.mode).toBe("DEMO");
    expect(parsed.state.seed).toBe("persisted-seed");
    expect(parsed.state.overridesBySituation).toEqual({
      halloween: { dispositions: { hi_1: "carry_forward" } },
    });
  });

  it("never persists a derived situation — only overrides", () => {
    store().chooseDemo();
    const parsed = JSON.parse(localStore.getItem(`${DATASET_STORAGE_KEY}:test-account`)!) as {
      state: Record<string, unknown>;
    };
    expect(Object.keys(parsed.state).sort()).toEqual(
      [
        "activeSituationId",
        "datasetId",
        "datasetName",
        "hasStoredUpload",
        "mode",
        "overridesBySituation",
        "seed",
        "uploadedAt",
        "uploadedFileName",
      ].sort()
    );
  });
});
