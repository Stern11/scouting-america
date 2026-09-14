/**
 * Binds planning persistence to the signed-in account.
 *
 * The dataset and scenario stores persist through `scopedWebStorage`, which
 * reads and writes nothing until an account namespace is set. This is the one
 * place that sets it, and so the one place that rehydrates those stores — see
 * `components/layout/app-providers.tsx`.
 */

import { scopedKey, setStorageNamespace, storageNamespace } from "@/lib/utils/storage-scope";
import { clearUnscopedUpload, clearUploadedDataset } from "@/lib/dataset/storage";
import { DATASET_STORAGE_KEY, useDatasetStore } from "./dataset-store";
import { SITUATION_SCENARIO_STORAGE_KEY, useSituationScenarioStore } from "./situation-scenario-store";
import { CAPACITY_SCENARIO_STORAGE_KEY, useCapacityScenarioStore } from "./capacity-scenario-store";
import { webStorage } from "./persist-storage";

const PLANNING_KEYS = [DATASET_STORAGE_KEY, SITUATION_SCENARIO_STORAGE_KEY, CAPACITY_SCENARIO_STORAGE_KEY];

/** Back to first-run state in memory. Only ever called with storage detached. */
function resetPlanningState(): void {
  useDatasetStore.setState(useDatasetStore.getInitialState());
  useSituationScenarioStore.setState(useSituationScenarioStore.getInitialState());
  useCapacityScenarioStore.setState(useCapacityScenarioStore.getInitialState());
}

/**
 * Points planning persistence at one account (or none) and loads that
 * account's data.
 *
 * Switching accounts without a page load would otherwise leave the previous
 * account's state in memory: rehydrating from an empty namespace merges
 * nothing, so whatever was on screen would stay. It is cleared first, with
 * storage detached so the reset cannot be written over either account's data.
 */
export async function bindPlanningStorage(namespace: string | null): Promise<void> {
  const previous = storageNamespace();
  if (previous !== null && previous !== namespace) {
    setStorageNamespace(null);
    resetPlanningState();
  }
  setStorageNamespace(namespace);
  if (namespace === null) return;

  // Data written before storage was scoped cannot be attributed to anyone.
  const local = webStorage("local");
  for (const key of PLANNING_KEYS) void local.removeItem(key);
  await clearUnscopedUpload();

  await Promise.all([
    useDatasetStore.persist.rehydrate(),
    useSituationScenarioStore.persist.rehydrate(),
    useCapacityScenarioStore.persist.rehydrate(),
  ]);
}

/** Deletes the signed-in account's dataset, decisions and scenarios from this browser. */
export async function removePlanningDataForAccount(): Promise<void> {
  if (storageNamespace() === null) return;
  const keys = PLANNING_KEYS.map(scopedKey);
  // The workbook first, while its scoped key still resolves.
  await clearUploadedDataset();
  setStorageNamespace(null);
  const local = webStorage("local");
  for (const key of keys) if (key !== null) void local.removeItem(key);
  resetPlanningState();
}
