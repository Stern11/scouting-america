/**
 * Sales history lookups.
 *
 * A sales row covers any period — a week, a month, an eight-week window — so
 * every question here is "how many units fell inside this window", answered by
 * prorating each row by the days it overlaps. That lets an upload carry weekly
 * JDA extracts, monthly history, or both, without the math caring.
 *
 * Network vs store rows: for a SKU that has network-level rows (no store),
 * those are its authoritative totals and store rows only say *where* it sold.
 * Summing both would count each sale twice. A SKU with only store rows is
 * totalled from them.
 */

import type { PlanningDataset, SalesRow } from "@/types/dataset";
import { dayMs, parseDay } from "./time";

interface SkuSales {
  network: SalesRow[];
  byStore: Map<string, SalesRow[]>;
}

export class SalesIndex {
  private readonly bySku = new Map<string, SkuSales>();

  constructor(rows: readonly SalesRow[]) {
    for (const row of rows) {
      let entry = this.bySku.get(row.skuId);
      if (!entry) {
        entry = { network: [], byStore: new Map() };
        this.bySku.set(row.skuId, entry);
      }
      if (row.storeId) {
        const list = entry.byStore.get(row.storeId);
        if (list) list.push(row);
        else entry.byStore.set(row.storeId, [row]);
      } else {
        entry.network.push(row);
      }
    }
  }

  hasSku(skuId: string): boolean {
    return this.bySku.has(skuId);
  }

  /** Stores with any sales row for the SKU. */
  storesFor(skuId: string): string[] {
    return [...(this.bySku.get(skuId)?.byStore.keys() ?? [])];
  }

  hasStoreRows(skuId: string): boolean {
    return (this.bySku.get(skuId)?.byStore.size ?? 0) > 0;
  }

  /** Network units for one SKU in [from, toExclusive). */
  networkUnits(skuId: string, from: string, toExclusive: string): number {
    const entry = this.bySku.get(skuId);
    if (!entry) return 0;
    if (entry.network.length > 0) return sumInWindow(entry.network, from, toExclusive);
    let total = 0;
    for (const rows of entry.byStore.values()) total += sumInWindow(rows, from, toExclusive);
    return total;
  }

  /** One store's units for one SKU in [from, toExclusive). */
  storeUnits(skuId: string, storeId: string, from: string, toExclusive: string): number {
    const rows = this.bySku.get(skuId)?.byStore.get(storeId);
    return rows ? sumInWindow(rows, from, toExclusive) : 0;
  }

  /** Total of store-level rows for one SKU in the window — the denominator for store shares. */
  allStoreUnits(skuId: string, from: string, toExclusive: string): number {
    const entry = this.bySku.get(skuId);
    if (!entry) return 0;
    let total = 0;
    for (const rows of entry.byStore.values()) total += sumInWindow(rows, from, toExclusive);
    return total;
  }

  /** Earliest day any row for the SKU starts — how much history there is. */
  firstSaleDay(skuId: string): string | undefined {
    const entry = this.bySku.get(skuId);
    if (!entry) return undefined;
    let first: string | undefined;
    const consider = (rows: readonly SalesRow[]) => {
      for (const r of rows) if (r.units > 0 && (first === undefined || r.periodStart < first)) first = r.periodStart;
    };
    consider(entry.network);
    for (const rows of entry.byStore.values()) consider(rows);
    return first;
  }
}

/** Units in [from, toExclusive), each row prorated by its overlapping days. */
export function sumInWindow(rows: readonly SalesRow[], from: string, toExclusive: string): number {
  const winStart = parseDay(from);
  const winEnd = parseDay(toExclusive);
  if (!(winEnd > winStart)) return 0;
  let total = 0;
  for (const row of rows) {
    const start = parseDay(row.periodStart);
    // Periods are inclusive of their last day.
    const end = parseDay(row.periodEnd) + dayMs;
    if (!(end > start)) continue;
    const overlap = Math.min(end, winEnd) - Math.max(start, winStart);
    if (overlap <= 0) continue;
    total += row.units * (overlap / (end - start));
  }
  return total;
}

const indexCache = new WeakMap<PlanningDataset, SalesIndex>();

/** One index per dataset object — the dataset is immutable once built. */
export function salesIndexFor(dataset: PlanningDataset): SalesIndex {
  let index = indexCache.get(dataset);
  if (!index) {
    index = new SalesIndex(dataset.sales);
    indexCache.set(dataset, index);
  }
  return index;
}
