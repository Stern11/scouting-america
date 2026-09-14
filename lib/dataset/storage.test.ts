import { afterEach, describe, expect, it } from "vitest";
import { setStorageNamespace } from "@/lib/utils/storage-scope";
import { generateDemoDataset } from "./demo/generate";
import { clearUploadedDataset, loadUploadedDataset, probePersistence, saveUploadedDataset } from "./storage";

// Node has no IndexedDB, which is exactly the "storage refused the write" case.
const dataset = generateDemoDataset({ planningNow: "2027-03-08T09:00:00.000Z" });

afterEach(() => setStorageNamespace(null));

describe("uploaded dataset storage when the browser will not keep a write", () => {
  it("reports the save as failed rather than claiming success", async () => {
    setStorageNamespace("alice");
    expect(await saveUploadedDataset(dataset)).toBe(false);
    expect(await probePersistence()).toBe(false);
  });

  it("still hands this tab the dataset it just uploaded", async () => {
    setStorageNamespace("alice");
    await saveUploadedDataset(dataset);
    expect(await loadUploadedDataset()).toBe(dataset);
  });

  it("never hands one account's upload to another, or to nobody", async () => {
    setStorageNamespace("alice");
    await saveUploadedDataset(dataset);
    setStorageNamespace("bob");
    expect(await loadUploadedDataset()).toBeNull();
    setStorageNamespace(null);
    expect(await loadUploadedDataset()).toBeNull();
    expect(await saveUploadedDataset(dataset)).toBe(false);
  });

  it("forgets the tab's copy when the account removes its data", async () => {
    setStorageNamespace("alice");
    await saveUploadedDataset(dataset);
    await clearUploadedDataset();
    expect(await loadUploadedDataset()).toBeNull();
  });
});
