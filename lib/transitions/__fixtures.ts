/**
 * Small hand-built datasets for the transition tests. Not a test file itself.
 */

import type {
  DatasetCapabilities,
  InboundRow,
  InventoryRow,
  PlanningDataset,
  SalesRow,
  SkuRow,
  StoreRow,
  TransitionRow,
} from "@/types/dataset";

export const NOW = "2026-10-05";

export function sku(id: string, extra: Partial<SkuRow> = {}): SkuRow {
  return {
    skuId: id,
    skuName: `Cub Scout Uniform Shirt — ${id}`,
    productFamily: "Cub Scout Uniform",
    category: "Uniforms",
    program: "Cub Scouts",
    sizeRange: "Youth XS–Adult M",
    vendor: "Vendor 0412",
    color: "Navy",
    status: "ACTIVE",
    unitCost: 10,
    leadTimeDays: 56,
    ...extra,
  };
}

export function store(id: string, region = "South Central"): StoreRow {
  return { storeId: id, storeName: `Store ${id}`, region };
}

/** Network sale covering the 52 weeks before NOW with `units` total. */
export function yearSale(skuId: string, units: number, endExclusive = NOW): SalesRow {
  const end = new Date(Date.parse(`${endExclusive}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const start = new Date(Date.parse(`${endExclusive}T00:00:00Z`) - 364 * 86_400_000).toISOString().slice(0, 10);
  return { skuId, periodStart: start, periodEnd: end, units };
}

export function inv(
  skuId: string,
  locationId: string,
  onHand: number,
  locationType: "STORE" | "DC" = "STORE",
  allocated = 0
): InventoryRow {
  return { snapshotDate: NOW, skuId, locationId, locationType, onHand, allocated, available: Math.max(0, onHand - allocated) };
}

export function inbound(skuId: string, quantity: number, date: string, id = `po-${skuId}-${date}`): InboundRow {
  return { id, skuId, locationId: "DC", locationType: "DC", quantity, expectedReceiptDate: date, purchaseOrderId: id };
}

export function transition(extra: Partial<TransitionRow> = {}): TransitionRow {
  return {
    transitionId: "T1",
    transitionName: "Cub Scout Uniform Shirt",
    predecessorSkuIds: ["L1"],
    successorSkuIds: ["S1"],
    transitionType: "ONE_TO_ONE",
    reason: "REBRAND",
    plannerConfirmed: true,
    source: "PLANNER",
    targetCompletionDate: "2026-11-30",
    ...extra,
  };
}

const ALL_CAPS: DatasetCapabilities = {
  salesHistory: true,
  storeLevelDemand: true,
  storeInventory: true,
  dcInventory: true,
  inboundSupply: true,
  currentPlan: true,
  sellingProfiles: false,
  unitCosts: true,
};

export function dataset(parts: Partial<Omit<PlanningDataset, "metadata">> & { capabilities?: Partial<DatasetCapabilities> }): PlanningDataset {
  const { capabilities, ...rest } = parts;
  return {
    metadata: {
      id: "fixture",
      name: "Fixture",
      mode: "DEMO",
      createdAt: NOW,
      planningNow: NOW,
      currency: "USD",
      capabilities: { ...ALL_CAPS, ...capabilities },
    },
    stores: [],
    skus: [],
    transitions: [],
    sales: [],
    inventory: [],
    inbound: [],
    currentPlan: [],
    sellingProfiles: [],
    history: [],
    ...rest,
  };
}

export function deepFreeze<T>(obj: T): T {
  if (obj && typeof obj === "object" && !Object.isFrozen(obj)) {
    Object.freeze(obj);
    for (const v of Object.values(obj as Record<string, unknown>)) deepFreeze(v);
  }
  return obj;
}
