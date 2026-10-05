/**
 * The seeded demo dataset: a synthetic Scouting America supply network in the
 * middle of its rebrand.
 *
 * Produces a `RawPlanningInput` — the same loose, snake_case rows an uploaded
 * workbook produces — so `normalizePlanningInput()` turns it into a
 * `PlanningDataset` exactly the way it turns an Excel upload into one.
 *
 * Determinism: everything derives from `Rng(seed)` and `planningNow`. Every
 * date is an offset from `planningNow`, so the story reads the same whichever
 * day the demo is opened. No `Math.random()`, no `Date.now()`.
 *
 * Coherence: store stock is *designed in weeks of cover* against the demand
 * the engine itself will calculate — the generator runs the same continuity
 * demand function over the sales it has just written. That is what makes a
 * showcase say "17 stores run out" because 17 stores really do, not because a
 * number was typed in.
 *
 * Showcase transitions, one per planning situation the product exists for:
 *   A  under-ordering      Cub Scout Shirt   (also C: network imbalance)
 *   B  over-ordering       Webelos Belt
 *   C  network imbalance   Pinewood Derby Kit, Scouts BSA Pants (split)
 *   D  unconfirmed match   Scouts BSA Hat, Scouts BSA Neckerchief, Venturing Shirt
 *   E  delayed inbound     Wolf Neckerchief
 * plus a consolidation, a discontinuation without successor, a new product,
 * ~30 calmer active transitions and ~110 completed ones.
 */

import type { PlanningDataset, RawPlanningInput, RawRow, SalesRow, TransitionReason } from "@/types/dataset";
import { normalizePlanningInput } from "@/lib/dataset/normalize";
import { Rng } from "@/lib/utils/rng";
import { calculateContinuityDemand } from "@/lib/transitions/demand";
import { SalesIndex, sumInWindow } from "@/lib/transitions/sales";
import { REVIEW_CYCLE_WEEKS, RECENT_WEEKS } from "@/lib/transitions/assumptions";
import { addDaysTo, monthEnd, monthOf, monthStart, parseDay, toDay } from "@/lib/transitions/time";
import { SEASONALITY, STORE_CITIES, proceduralCatalog, type CatalogItem, type SeasonProfile } from "./catalog";

export interface DemoDatasetOptions {
  seed?: string;
  planningNow?: string;
}

export const DEFAULT_DEMO_SEED = "scouting-america-v1";
/** The anchor tests pin to. The app passes the real date. */
export const DEMO_PLANNING_NOW = "2026-10-05T09:00:00.000Z";
export const DEMO_DC_ID = "DC-CLT";
/** The persona the demo's history is written by. */
export const DEMO_PLANNER = "James";

/* ------------------------------------------------------------------ */
/* Specs                                                               */
/* ------------------------------------------------------------------ */

interface SkuDef {
  id: string;
  name: string;
  brand: string;
  vendor: string;
  packaging?: string;
  cost: number;
  retail: number;
  leadDays: number;
  /** Many-to-one: share of the legacy stream this SKU carried. */
  weight?: number;
  /** One-to-many: share of demand this successor takes. */
  split?: number;
  sizeRange?: string;
  family?: string;
  color?: string;
}

type StockProfile = "imbalanced" | "balanced" | "thin";

interface StockPlan {
  profile: StockProfile;
  /** Exact store totals, when the story depends on them. */
  legacyStore?: number;
  successorStore?: number;
  legacyDc: number;
  successorDc: number;
  successorDcAllocated?: number;
  /** DC successor stock sized in weeks of demand, when no exact figure is given. */
  successorDcWeeks?: [number, number];
  /** Balanced stores' cover, in weeks. */
  cover?: [number, number];
  /** Imbalanced: stores designed to run out before resupply. */
  atRisk?: number;
  /** Imbalanced: legacy-heavy stores with far more than they will sell. */
  donors?: number;
}

interface LineageSpec {
  id: string;
  name: string;
  reason: TransitionReason;
  family: string;
  category: string;
  program: string;
  season: SeasonProfile;
  sizeRange?: string;
  color?: string;
  legacy: SkuDef[];
  successors: SkuDef[];
  /** Days from now. */
  launchOffset: number;
  startOffset: number;
  targetOffset: number;
  annual: number;
  yoy: number;
  /** Successor share of network sales today. */
  mixNow: number;
  stores: { legacyOnly: number; mixed: number; newOnly: number };
  stock: StockPlan;
  inbound: { offsetDays: number; qty: number; po: string }[];
  jda?: { forecastFactor: number; plannedOrder?: number };
  /** PLANNER writes a SKU_Transitions row; SYSTEM records the replacement on the SKU; SUGGESTED leaves both blank. */
  source: "PLANNER" | "SYSTEM" | "SUGGESTED";
  confirmed: boolean;
  substitutability?: number;
  safetyWeeks?: number;
  history?: { offset: number; text: string }[];
}

/* ------------------------------------------------------------------ */
/* Output accumulator                                                  */
/* ------------------------------------------------------------------ */

interface Out {
  skus: RawRow[];
  transitions: RawRow[];
  sales: RawRow[];
  inventory: RawRow[];
  inbound: RawRow[];
  currentPlan: RawRow[];
  profiles: RawRow[];
  history: RawRow[];
}

interface StoreInfo {
  id: string;
  name: string;
  region: string;
  size: number;
}

/* ------------------------------------------------------------------ */
/* Entry points                                                        */
/* ------------------------------------------------------------------ */

export function generateDemoRawInput(options: DemoDatasetOptions = {}): RawPlanningInput {
  const seed = options.seed ?? DEFAULT_DEMO_SEED;
  // No explicit anchor means "today" — a demo should never open on a stale date.
  const planningNow = toDay(options.planningNow ?? new Date().toISOString());
  const rng = new Rng(seed);

  const { rows: storeRows, stores } = buildStores(new Rng(`${seed}::stores`));
  const out: Out = { skus: [], transitions: [], sales: [], inventory: [], inbound: [], currentPlan: [], profiles: [], history: [] };

  for (const spec of showcaseSpecs()) {
    generateLineage(new Rng(`${seed}::${spec.id}`), spec, stores, planningNow, out);
  }

  const catalog = proceduralCatalog();
  const order = shuffle(rng, catalog.map((_, i) => i));
  const usedCodes = new Set<string>(out.skus.map((s) => String(s.sku_id)));
  const ACTIVE_PROCEDURAL = 33;
  order.forEach((catalogIndex, k) => {
    const item = catalog[catalogIndex];
    if (!item) return;
    const itemRng = new Rng(`${seed}::proc::${item.name}`);
    if (k < ACTIVE_PROCEDURAL) {
      generateLineage(itemRng, proceduralSpec(itemRng, item, k, usedCodes), stores, planningNow, out);
    } else {
      generateCompleted(itemRng, item, k, usedCodes, planningNow, out, "rebrand");
    }
  });
  // An earlier wave of edition changes, long finished — the rest of the
  // ~150-transition portfolio.
  order.slice(0, 50).forEach((catalogIndex, k) => {
    const item = catalog[catalogIndex];
    if (!item) return;
    generateCompleted(new Rng(`${seed}::edition::${item.name}`), item, k, usedCodes, planningNow, out, "edition");
  });

  return {
    metadata: {
      id: `demo-${seed}`,
      name: "Scouting America demo",
      mode: "DEMO",
      seed,
      createdAt: planningNow,
      planningNow,
      currency: "USD",
    },
    stores: storeRows,
    skus: out.skus,
    transitions: out.transitions,
    sales: out.sales,
    inventory: out.inventory,
    inbound: out.inbound,
    currentPlan: out.currentPlan,
    sellingProfiles: out.profiles,
    history: out.history,
  };
}

export function generateDemoDataset(options: DemoDatasetOptions = {}): PlanningDataset {
  const { dataset } = normalizePlanningInput(generateDemoRawInput(options));
  return dataset;
}

/* ------------------------------------------------------------------ */
/* Stores                                                              */
/* ------------------------------------------------------------------ */

function buildStores(rng: Rng): { rows: RawRow[]; stores: StoreInfo[] } {
  const rows: RawRow[] = [];
  const stores: StoreInfo[] = [];
  const numbers = shuffle(rng, Array.from({ length: 160 }, (_, i) => i + 1));
  let n = 0;
  for (const city of STORE_CITIES) {
    for (let i = 0; i < city.count; i++) {
      const number = numbers[n] ?? n + 1;
      n += 1;
      const cluster = rng.float() < 0.25 ? "Large" : rng.float() < 0.6 ? "Medium" : "Small";
      const size = cluster === "Large" ? 1.5 : cluster === "Medium" ? 1 : 0.65;
      const id = `ST-${String(number).padStart(3, "0")}`;
      const name = `${city.city} #${String(number).padStart(2, "0")}`;
      rows.push({ store_id: id, store_name: name, city: city.city, state: city.state, region: city.region, cluster });
      stores.push({ id, name, region: city.region, size: size * rng.range(0.8, 1.25) });
    }
  }
  return { rows, stores };
}

/* ------------------------------------------------------------------ */
/* Showcase transitions                                                */
/* ------------------------------------------------------------------ */

const LEGACY_BRAND = "BSA legacy";
const NEW_BRAND = "Scouting America";

function showcaseSpecs(): LineageSpec[] {
  return [
    // A + C — the flagship. Legacy stock sits where it no longer sells, the
    // stores that switched first have little behind them, and JDA plans the
    // successor as though the legacy shirts did not exist.
    {
      id: "TR-1001",
      name: "Cub Scout Shirt",
      reason: "REBRAND",
      family: "Cub Scout Uniform",
      category: "Uniforms",
      program: "Cub Scouts",
      season: "uniform",
      sizeRange: "Youth XS–Adult M",
      color: "Navy",
      legacy: [{ id: "CS-1048", name: "Cub Scout Shirt — old logo", brand: LEGACY_BRAND, vendor: "Vendor 0412", packaging: "Polybag", cost: 14.2, retail: 32, leadDays: 56 }],
      successors: [{ id: "CS-2841", name: "Cub Scout Shirt — Scouting America", brand: NEW_BRAND, vendor: "Vendor 0412", packaging: "Recycled polybag", cost: 14.6, retail: 32, leadDays: 56 }],
      launchOffset: -77,
      startOffset: -54,
      targetOffset: 56,
      annual: 19600,
      yoy: 1.04,
      mixNow: 0.8,
      stores: { legacyOnly: 46, mixed: 51, newOnly: 23 },
      stock: { profile: "imbalanced", legacyStore: 2140, legacyDc: 0, successorDc: 1100, atRisk: 17, donors: 1 },
      inbound: [
        { offsetDays: 21, qty: 600, po: "PO-48213" },
        // Lands after the horizon: shown, never counted against this order.
        { offsetDays: 98, qty: 1200, po: "PO-48377" },
      ],
      jda: { forecastFactor: 0.62, plannedOrder: 2900 },
      source: "PLANNER",
      confirmed: true,
      substitutability: 1,
      safetyWeeks: 2,
      history: [
        { offset: -54, text: "Transition started — CS-2841 launched to 74 stores" },
        { offset: -20, text: "Confirmed CS-1048 → CS-2841 (rebrand, fully interchangeable)" },
        { offset: -6, text: "Safety stock changed: 3 weeks → 2 weeks" },
      ],
    },
    // B — over-ordering. Plenty of legacy belts in the network; JDA plans a
    // full successor buy anyway.
    {
      id: "TR-1002",
      name: "Webelos Belt",
      reason: "REBRAND",
      family: "Cub Scout Uniform",
      category: "Uniforms",
      program: "Cub Scouts",
      season: "uniform",
      sizeRange: "Youth 22–32",
      color: "Navy",
      legacy: [{ id: "WB-8211", name: "Webelos Belt — old logo", brand: LEGACY_BRAND, vendor: "Vendor 0388", packaging: "Hang card", cost: 8.9, retail: 19, leadDays: 49 }],
      successors: [{ id: "WB-9302", name: "Webelos Belt — Scouting America", brand: NEW_BRAND, vendor: "Vendor 0388", packaging: "Hang card", cost: 9.1, retail: 19, leadDays: 49 }],
      launchOffset: -60,
      startOffset: -60,
      targetOffset: 42,
      annual: 8200,
      yoy: 1.02,
      mixNow: 0.51,
      stores: { legacyOnly: 30, mixed: 44, newOnly: 22 },
      stock: { profile: "balanced", legacyStore: 1820, legacyDc: 0, successorDc: 0, cover: [11, 15] },
      inbound: [{ offsetDays: 35, qty: 400, po: "PO-48290" }],
      jda: { forecastFactor: 0.95, plannedOrder: 1800 },
      source: "PLANNER",
      confirmed: true,
      substitutability: 1,
      history: [{ offset: -58, text: "Confirmed WB-8211 → WB-9302 (rebrand)" }],
    },
    // E — the shipment is late and there is nothing to bridge with.
    {
      id: "TR-1003",
      name: "Wolf Neckerchief",
      reason: "REBRAND",
      family: "Cub Scout Neckwear",
      category: "Uniform Accessories",
      program: "Cub Scouts",
      season: "uniform",
      color: "Gold",
      legacy: [{ id: "NK-3105", name: "Wolf Neckerchief — old logo", brand: LEGACY_BRAND, vendor: "Vendor 0517", cost: 3.6, retail: 9, leadDays: 42 }],
      successors: [{ id: "NK-5520", name: "Wolf Neckerchief — Scouting America", brand: NEW_BRAND, vendor: "Vendor 0517", cost: 3.8, retail: 9, leadDays: 42 }],
      launchOffset: -45,
      startOffset: -45,
      targetOffset: 35,
      annual: 11800,
      yoy: 1.03,
      mixNow: 0.7,
      stores: { legacyOnly: 18, mixed: 52, newOnly: 34 },
      stock: { profile: "thin", legacyDc: 0, successorDc: 0, donors: 2 },
      inbound: [{ offsetDays: 24, qty: 2400, po: "PO-48155" }],
      jda: { forecastFactor: 0.45 },
      source: "PLANNER",
      confirmed: true,
      substitutability: 1,
      history: [{ offset: -9, text: "Vendor moved PO-48155 out two weeks" }],
    },
    // C — a split. Legacy pants become separate youth and adult SKUs; not
    // every legacy size has a home, so legacy stock is only 80% usable.
    {
      id: "TR-1004",
      name: "Scouts BSA Pants",
      reason: "SPLIT",
      family: "Scouts BSA Uniform",
      category: "Uniforms",
      program: "Scouts BSA",
      season: "uniform",
      sizeRange: "Youth 8–Adult 44",
      color: "Olive",
      legacy: [{ id: "SP-2207", name: "Scouts BSA Pants — old logo", brand: LEGACY_BRAND, vendor: "Vendor 0291", cost: 21.5, retail: 48, leadDays: 63 }],
      successors: [
        { id: "SP-6610", name: "Scouts BSA Pants, Youth — Scouting America", brand: NEW_BRAND, vendor: "Vendor 0291", cost: 19.8, retail: 44, leadDays: 63, split: 0.58, sizeRange: "Youth 8–20" },
        { id: "SP-6611", name: "Scouts BSA Pants, Adult — Scouting America", brand: NEW_BRAND, vendor: "Vendor 0291", cost: 22.4, retail: 49, leadDays: 63, split: 0.42, sizeRange: "Adult 28–44" },
      ],
      launchOffset: -70,
      startOffset: -70,
      targetOffset: 70,
      annual: 6400,
      yoy: 1.01,
      mixNow: 0.55,
      stores: { legacyOnly: 34, mixed: 48, newOnly: 20 },
      stock: { profile: "imbalanced", legacyStore: 1260, legacyDc: 0, successorDc: 240, atRisk: 9, donors: 2 },
      inbound: [{ offsetDays: 28, qty: 900, po: "PO-48302" }],
      source: "PLANNER",
      confirmed: true,
      substitutability: 0.8,
      history: [{ offset: -40, text: "Set legacy substitutability to 80% — 46 and 48 waist have no successor size" }],
    },
    // C — derby season is coming and kits sit in the wrong stores.
    {
      id: "TR-1005",
      name: "Pinewood Derby Kit",
      reason: "REBRAND",
      family: "Derby Kits",
      category: "Program Kits",
      program: "Cub Scouts",
      season: "derby",
      legacy: [{ id: "PK-1190", name: "Pinewood Derby Kit — old logo", brand: LEGACY_BRAND, vendor: "Vendor 0144", packaging: "Retail box", cost: 3.1, retail: 7.5, leadDays: 35 }],
      successors: [{ id: "PK-7745", name: "Pinewood Derby Kit — Scouting America", brand: NEW_BRAND, vendor: "Vendor 0144", packaging: "Retail box", cost: 3.2, retail: 7.5, leadDays: 35 }],
      launchOffset: -50,
      startOffset: -50,
      targetOffset: 84,
      annual: 21000,
      yoy: 1.05,
      mixNow: 0.48,
      stores: { legacyOnly: 40, mixed: 50, newOnly: 30 },
      stock: { profile: "imbalanced", legacyStore: 2600, legacyDc: 0, successorDc: 3200, atRisk: 7, donors: 8 },
      inbound: [{ offsetDays: 18, qty: 4000, po: "PO-48420" }],
      source: "SYSTEM",
      confirmed: true,
      substitutability: 1,
    },
    // D — JDA records no replacement; Heizen matched it on attributes.
    {
      id: "TR-1006",
      name: "Scouts BSA Hat",
      reason: "REPLACEMENT",
      family: "Scouts BSA Headwear",
      category: "Uniforms",
      program: "Scouts BSA",
      season: "uniform",
      sizeRange: "S/M–L/XL",
      color: "Olive",
      legacy: [{ id: "SB-4412", name: "Scouts BSA Hat — old logo", brand: LEGACY_BRAND, vendor: "Vendor 0233", cost: 7.4, retail: 18, leadDays: 49 }],
      successors: [{ id: "SB-6208", name: "Scouts BSA Hat — Scouting America", brand: NEW_BRAND, vendor: "Vendor 0233", cost: 7.6, retail: 18, leadDays: 49 }],
      launchOffset: -150,
      startOffset: -150,
      targetOffset: 30,
      annual: 5200,
      yoy: 1.0,
      mixNow: 0.91,
      stores: { legacyOnly: 4, mixed: 22, newOnly: 70 },
      stock: { profile: "balanced", legacyStore: 310, legacyDc: 0, successorDc: 1600, cover: [9, 12] },
      inbound: [],
      source: "SUGGESTED",
      confirmed: false,
    },
    {
      id: "TR-1007",
      name: "Scouts BSA Neckerchief",
      reason: "REPLACEMENT",
      family: "Scouts BSA Neckwear",
      category: "Uniform Accessories",
      program: "Scouts BSA",
      season: "uniform",
      color: "Red",
      legacy: [{ id: "SN-3318", name: "Scouts BSA Neckerchief — old logo", brand: LEGACY_BRAND, vendor: "Vendor 0517", cost: 3.9, retail: 10, leadDays: 42 }],
      successors: [{ id: "SN-5704", name: "Scouts BSA Neckerchief — Scouting America", brand: NEW_BRAND, vendor: "Vendor 0517", cost: 4.0, retail: 10, leadDays: 42 }],
      launchOffset: -120,
      startOffset: -120,
      targetOffset: 45,
      annual: 4600,
      yoy: 1.01,
      mixNow: 0.78,
      stores: { legacyOnly: 8, mixed: 34, newOnly: 50 },
      stock: { profile: "balanced", legacyDc: 0, successorDc: 1100, cover: [8, 11] },
      inbound: [],
      source: "SUGGESTED",
      confirmed: false,
    },
    // D — a weaker match: the vendor and size run changed, so it needs a look.
    {
      id: "TR-1008",
      name: "Venturing Shirt",
      reason: "REPLACEMENT",
      family: "Venturing Apparel",
      category: "Uniforms",
      program: "Venturing",
      season: "uniform",
      color: "Green",
      legacy: [{ id: "VA-2290", name: "Venturing Shirt — old logo", brand: LEGACY_BRAND, vendor: "Vendor 0610", cost: 7.2, retail: 18, leadDays: 56, sizeRange: "Adult S–2XL" }],
      successors: [{ id: "VA-6140", name: "Venturing Tee — Scouting America", brand: NEW_BRAND, vendor: "Vendor 0702", cost: 7.9, retail: 20, leadDays: 56, sizeRange: "Youth L–Adult 3XL" }],
      launchOffset: -40,
      startOffset: -40,
      targetOffset: 60,
      annual: 3100,
      yoy: 0.98,
      mixNow: 0.36,
      stores: { legacyOnly: 30, mixed: 28, newOnly: 12 },
      stock: { profile: "balanced", legacyDc: 0, successorDc: 400, cover: [9, 12] },
      inbound: [{ offsetDays: 49, qty: 300, po: "PO-48501" }],
      source: "SUGGESTED",
      confirmed: false,
      substitutability: 0.85,
    },
    // Consolidation: two legacy socks become one.
    {
      id: "TR-1009",
      name: "Scout Socks",
      reason: "CONSOLIDATION",
      family: "Uniform Socks",
      category: "Uniforms",
      program: "All programs",
      season: "uniform",
      sizeRange: "Youth M–Adult XL",
      color: "Olive",
      legacy: [
        { id: "SK-1150", name: "Scout Crew Socks — old logo", brand: LEGACY_BRAND, vendor: "Vendor 0371", cost: 4.1, retail: 10, leadDays: 42, weight: 0.64 },
        { id: "SK-1151", name: "Scout Ankle Socks — old logo", brand: LEGACY_BRAND, vendor: "Vendor 0371", cost: 3.8, retail: 9, leadDays: 42, weight: 0.36 },
      ],
      successors: [{ id: "SK-4402", name: "Scout Socks — Scouting America", brand: NEW_BRAND, vendor: "Vendor 0371", cost: 4.2, retail: 10, leadDays: 42 }],
      launchOffset: -90,
      startOffset: -90,
      targetOffset: 50,
      annual: 9800,
      yoy: 1.02,
      mixNow: 0.68,
      stores: { legacyOnly: 14, mixed: 50, newOnly: 40 },
      stock: { profile: "balanced", legacyDc: 0, successorDc: 1500, cover: [7, 10] },
      inbound: [{ offsetDays: 30, qty: 1600, po: "PO-48333" }],
      jda: { forecastFactor: 0.58 },
      source: "PLANNER",
      confirmed: true,
      substitutability: 0.9,
      history: [{ offset: -88, text: "Mapped SK-1150 + SK-1151 → SK-4402 (consolidation)" }],
    },
    // No successor: the legacy logo blanket is simply going away.
    {
      id: "TR-1010",
      name: "Stadium Blanket",
      reason: "DISCONTINUATION",
      family: "Gifts & Novelty",
      category: "Gifts",
      program: "All programs",
      season: "apparel",
      legacy: [{ id: "GF-0874", name: "Stadium Blanket — old logo", brand: LEGACY_BRAND, vendor: "Vendor 0820", cost: 14.5, retail: 34, leadDays: 70 }],
      successors: [],
      launchOffset: -400,
      startOffset: -30,
      targetOffset: 56,
      annual: 3400,
      yoy: 0.8,
      mixNow: 0,
      stores: { legacyOnly: 88, mixed: 0, newOnly: 0 },
      stock: { profile: "balanced", legacyDc: 220, successorDc: 0, cover: [12, 24] },
      inbound: [],
      source: "PLANNER",
      confirmed: true,
      history: [{ offset: -30, text: "Marked GF-0874 discontinued — no replacement" }],
    },
    // New product: no legacy history to carry.
    {
      id: "TR-1011",
      name: "Daypack",
      reason: "NEW",
      family: "Packs",
      category: "Camping",
      program: "All programs",
      season: "camping",
      legacy: [],
      successors: [{ id: "CP-9031", name: "Daypack — Scouting America", brand: NEW_BRAND, vendor: "Vendor 0655", cost: 16.8, retail: 42, leadDays: 70 }],
      launchOffset: -100,
      startOffset: -100,
      targetOffset: 0,
      annual: 1900,
      yoy: 1,
      mixNow: 1,
      stores: { legacyOnly: 0, mixed: 0, newOnly: 76 },
      stock: { profile: "balanced", legacyDc: 0, successorDc: 650, cover: [8, 12] },
      inbound: [{ offsetDays: 40, qty: 300, po: "PO-48460" }],
      source: "PLANNER",
      confirmed: true,
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Procedural transitions                                              */
/* ------------------------------------------------------------------ */

const CATEGORY_PREFIX: Record<string, string> = {
  Uniforms: "UN",
  Patches: "PT",
  "Uniform Accessories": "UA",
  Literature: "LT",
  "Program Kits": "PK",
  Camping: "CP",
  "Non-uniform Apparel": "AP",
  Gifts: "GF",
  Awards: "AW",
  "Unit Supplies": "US",
};

function code(rng: Rng, category: string, lo: number, hi: number, used: Set<string>): string {
  const prefix = CATEGORY_PREFIX[category] ?? "MS";
  for (;;) {
    const candidate = `${prefix}-${rng.int(lo, hi)}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
}

function vendor(rng: Rng): string {
  return `Vendor ${String(rng.int(100, 899)).padStart(4, "0")}`;
}

/**
 * A calm, believable transition: stores covered for five to nine weeks,
 * inbound on order, legacy selling through on time. A few carry a JDA
 * forecast that lags the lineage, which is worth a planner's look.
 */
function proceduralSpec(rng: Rng, item: CatalogItem, k: number, used: Set<string>): LineageSpec {
  const legacyId = code(rng, item.category, 1000, 4999, used);
  const successorId = code(rng, item.category, 5000, 9899, used);
  const cost = round2(rng.range(item.cost[0], item.cost[1]));
  const lead = rng.pick([35, 42, 49, 56, 63]);
  const v = vendor(rng);
  const mixNow = round2(rng.range(0.35, 0.96));
  const storeCount = rng.int(54, 112);
  const newOnly = Math.round(storeCount * mixNow * rng.range(0.45, 0.7));
  const legacyOnly = Math.round(storeCount * (1 - mixNow) * rng.range(0.35, 0.6));
  const mixed = Math.max(0, storeCount - newOnly - legacyOnly);
  const annual = Math.round(rng.range(item.annual[0], item.annual[1]) * 2.4);
  const launchOffset = -rng.int(55, 210);
  return {
    id: `TR-${2000 + k}`,
    name: item.name,
    reason: rng.float() < 0.82 ? "REBRAND" : "REPLACEMENT",
    family: item.family,
    category: item.category,
    program: item.program,
    season: item.season,
    sizeRange: item.sizeRange,
    color: item.color,
    legacy: [{ id: legacyId, name: `${item.name} — old logo`, brand: LEGACY_BRAND, vendor: v, cost, retail: round2(cost * 2.3), leadDays: lead }],
    successors: [{ id: successorId, name: `${item.name} — Scouting America`, brand: NEW_BRAND, vendor: v, cost: round2(cost * 1.03), retail: round2(cost * 2.3), leadDays: lead }],
    launchOffset,
    startOffset: launchOffset,
    targetOffset: rng.int(75, 160),
    annual,
    yoy: round2(rng.range(0.97, 1.06)),
    mixNow,
    stores: { legacyOnly, mixed, newOnly },
    stock: { profile: "balanced", legacyDc: 0, successorDc: 0, successorDcWeeks: [4, 7], cover: [6, 10] },
    // Enough on order that the horizon is covered without a new buy, landing
    // before any store's cover runs out.
    inbound: [{ offsetDays: rng.int(10, 28), qty: 0, po: `PO-${rng.int(47000, 47999)}` }],
    jda: k % 9 === 4 ? { forecastFactor: 0.55 } : undefined,
    source: k % 4 === 1 ? "SYSTEM" : "PLANNER",
    confirmed: true,
  };
}

/* ------------------------------------------------------------------ */
/* Lineage generation                                                  */
/* ------------------------------------------------------------------ */

function generateLineage(rng: Rng, spec: LineageSpec, allStores: readonly StoreInfo[], now: string, out: Out): void {
  const launch = addDaysTo(now, spec.launchOffset);
  const succSplit = normalizeShares(spec.successors.map((s) => s.split ?? 1));
  const legacyWeights = normalizeShares(spec.legacy.map((s) => s.weight ?? 1));

  /* ---- SKU master ---- */
  for (const sku of spec.legacy) {
    out.skus.push(skuRow(spec, sku, {
      status: "DISCONTINUED",
      launch: addDaysTo(now, -rng.int(900, 2200)),
      discontinue: addDaysTo(now, spec.startOffset),
      // JDA records the replacement only when the source says it does.
      replacement: spec.source === "SYSTEM" ? spec.successors[0]?.id : undefined,
    }));
  }
  for (const sku of spec.successors) {
    out.skus.push(skuRow(spec, sku, { status: spec.legacy.length === 0 || spec.mixNow > 0.95 ? "ACTIVE" : "NEW", launch }));
  }

  /* ---- Network sales history, monthly ---- */
  const network: SalesRow[] = [];
  const shape = SEASONALITY[spec.season];
  const shapeTotal = shape.reduce((a, b) => a + b, 0);
  const nowMonth = monthOf(now);
  const nowMs = parseDay(now);
  const launchMs = parseDay(launch);
  for (let i = 30; i >= 0; i--) {
    const start = monthStart(nowMonth, -i);
    const month = monthOf(start);
    const end = i === 0 ? addDaysTo(now, -1) : monthEnd(month);
    if (end < start) continue;
    const days = (parseDay(end) - parseDay(start)) / 86_400_000 + 1;
    const daysInMonth = (parseDay(monthEnd(month)) - parseDay(start)) / 86_400_000 + 1;
    const mid = (parseDay(start) + parseDay(end)) / 2;
    const level = spec.annual * Math.pow(spec.yoy, (mid - nowMs) / (365 * 86_400_000));
    const seasonal = (shape[Number(month.slice(5, 7)) - 1] ?? 1) / shapeTotal;
    const total = level * seasonal * rng.range(0.94, 1.06) * (days / daysInMonth);

    let share: number;
    if (spec.legacy.length === 0) share = mid >= launchMs ? 1 : 0;
    else if (spec.successors.length === 0) share = 0;
    else if (mid < launchMs) share = 0;
    // Adoption climbs fast after launch and has settled at today's mix by
    // the last month, so recent sales read as `mixNow`.
    else share = spec.mixNow * Math.sqrt(Math.min(1, (mid - launchMs) / Math.max(1, nowMs - 30 * 86_400_000 - launchMs)));

    // A new product ramps from its launch rather than appearing at full rate.
    const ramp = spec.legacy.length === 0 ? Math.min(1, Math.max(0, (mid - launchMs) / (90 * 86_400_000)) + 0.35) : 1;
    const legacyUnits = total * (1 - share);
    const successorUnits = total * share * ramp;
    spec.legacy.forEach((sku, j) => pushSale(network, sku.id, start, end, legacyUnits * (legacyWeights[j] ?? 0), sku));
    spec.successors.forEach((sku, j) => pushSale(network, sku.id, start, end, successorUnits * (succSplit[j] ?? 0), sku));
  }
  for (const row of network) out.sales.push(saleRaw(row));

  /* ---- Stores ---- */
  const count = spec.stores.legacyOnly + spec.stores.mixed + spec.stores.newOnly;
  const chosen = shuffle(rng, [...allStores]).slice(0, Math.min(count, allStores.length));
  const states: ("LO" | "MX" | "NO")[] = shuffle(rng, [
    ...Array<"LO">(spec.stores.legacyOnly).fill("LO"),
    ...Array<"MX">(spec.stores.mixed).fill("MX"),
    ...Array<"NO">(spec.stores.newOnly).fill("NO"),
  ]).slice(0, chosen.length);

  const stores = chosen.map((store, i) => {
    const state = states[i] ?? "MX";
    const legacyShare = state === "LO" ? 1 : state === "NO" ? 0 : rng.range(0.15, 0.45);
    return { store, state, legacyShare, weight: store.size * rng.range(0.75, 1.3) };
  });

  /* ---- Recent store sales: the network's last eight weeks, by store ---- */
  const windowStart = addDaysTo(now, -RECENT_WEEKS * 7);
  const windowEnd = addDaysTo(now, -1);
  const storeSales: SalesRow[] = [];
  const recentBySku = new Map<string, number>();
  for (const sku of [...spec.legacy, ...spec.successors]) {
    recentBySku.set(sku.id, sumInWindow(network.filter((r) => r.skuId === sku.id), windowStart, now));
  }
  const storeLegacy = new Map<string, number>();
  const storeSuccessor = new Map<string, number>();
  for (const sku of spec.legacy) {
    const units = largestRemainder(recentBySku.get(sku.id) ?? 0, stores.map((s) => s.weight * s.legacyShare));
    stores.forEach((s, i) => {
      const u = units[i] ?? 0;
      storeLegacy.set(s.store.id, (storeLegacy.get(s.store.id) ?? 0) + u);
      if (u > 0) storeSales.push({ skuId: sku.id, storeId: s.store.id, periodStart: windowStart, periodEnd: windowEnd, units: u });
    });
  }
  for (const sku of spec.successors) {
    const units = largestRemainder(recentBySku.get(sku.id) ?? 0, stores.map((s) => s.weight * (1 - s.legacyShare)));
    stores.forEach((s, i) => {
      const u = units[i] ?? 0;
      storeSuccessor.set(s.store.id, (storeSuccessor.get(s.store.id) ?? 0) + u);
      if (u > 0) storeSales.push({ skuId: sku.id, storeId: s.store.id, periodStart: windowStart, periodEnd: windowEnd, units: u });
    });
  }
  for (const row of storeSales) out.sales.push(saleRaw(row));

  /* ---- The weekly demand the engine will compute, so stock can be designed in weeks ---- */
  const leadDays = Math.max(...[...spec.successors, ...spec.legacy].map((s) => s.leadDays));
  const horizonWeeks = Math.ceil(leadDays / 7) + REVIEW_CYCLE_WEEKS;
  const index = new SalesIndex([...network, ...storeSales]);
  const demand = calculateContinuityDemand({
    predecessorSkuIds: spec.legacy.map((s) => s.id),
    successorSkuIds: spec.successors.map((s) => s.id),
    sales: index,
    planningNow: now,
    horizonWeeks,
    transferredDemandPct: spec.successors.length === 0 ? 0 : 1,
    demandAdjustmentPct: 0,
  });
  // A discontinuation carries no demand forward, so its stores are sized on
  // what the legacy SKU sells today.
  const legacyRecentWeekly = spec.legacy.reduce((n, s) => n + (recentBySku.get(s.id) ?? 0), 0) / RECENT_WEEKS;
  const weekly = spec.successors.length === 0 ? legacyRecentWeekly : demand.weeklyUnits;
  const recentTotal = stores.reduce((n, s) => n + (storeLegacy.get(s.store.id) ?? 0) + (storeSuccessor.get(s.store.id) ?? 0), 0);
  const storeWeekly = stores.map((s) =>
    recentTotal > 0 ? (weekly * ((storeLegacy.get(s.store.id) ?? 0) + (storeSuccessor.get(s.store.id) ?? 0))) / recentTotal : 0
  );

  /* ---- Store stock, designed in weeks of cover ---- */
  const resupplyWeeks = spec.inbound.length > 0 ? Math.min(...spec.inbound.map((r) => r.offsetDays)) / 7 + 1 : horizonWeeks;
  const cover = designCover(rng, spec.stock, stores.map((s) => s.state), storeWeekly, resupplyWeeks);
  const legacyUnits: number[] = [];
  const successorUnits: number[] = [];
  stores.forEach((s, i) => {
    const units = (cover.weeks[i] ?? 0) * (storeWeekly[i] ?? 0);
    const legacyFraction = spec.legacy.length === 0 ? 0 : spec.successors.length === 0 ? 1 : s.state === "LO" ? 1 : s.state === "NO" ? 0 : s.legacyShare;
    legacyUnits.push(units * legacyFraction);
    successorUnits.push(units * (1 - legacyFraction));
  });
  const legacyFinal = fitTotal(legacyUnits, cover.fixed, spec.stock.legacyStore);
  const successorFinal = fitTotal(successorUnits, cover.fixed, spec.stock.successorStore);

  stores.forEach((s, i) => {
    const legacy = legacyFinal[i] ?? 0;
    const successor = successorFinal[i] ?? 0;
    splitAcross(legacy, spec.legacy.map((x) => x.id), legacyWeights).forEach(([skuId, units]) => {
      if (units > 0) out.inventory.push(invRow(now, skuId, s.store.id, "STORE", units, 0));
    });
    splitAcross(successor, spec.successors.map((x) => x.id), succSplit).forEach(([skuId, units]) => {
      if (units > 0) out.inventory.push(invRow(now, skuId, s.store.id, "STORE", units, 0));
    });
  });

  /* ---- DC ---- */
  const dcWeeks = spec.stock.successorDcWeeks;
  const successorDc = dcWeeks ? Math.round(weekly * rng.range(dcWeeks[0], dcWeeks[1])) : spec.stock.successorDc;
  splitAcross(spec.stock.legacyDc, spec.legacy.map((x) => x.id), legacyWeights).forEach(([skuId, units]) => {
    if (units > 0) out.inventory.push(invRow(now, skuId, DEMO_DC_ID, "DC", units, 0));
  });
  splitAcross(successorDc, spec.successors.map((x) => x.id), succSplit).forEach(([skuId, units]) => {
    if (units > 0) out.inventory.push(invRow(now, skuId, DEMO_DC_ID, "DC", units, spec.stock.successorDcAllocated ?? 0));
  });

  /* ---- Inbound ---- */
  for (const po of spec.inbound) {
    // A procedural PO is sized to cover the horizon, so it creates no work.
    const qty = po.qty > 0 ? po.qty : Math.round(weekly * rng.range(6, 8));
    splitAcross(qty, spec.successors.map((x) => x.id), succSplit).forEach(([skuId, units]) => {
      if (units <= 0) return;
      out.inbound.push({
        sku_id: skuId,
        location_id: DEMO_DC_ID,
        quantity: units,
        expected_receipt_date: addDaysTo(now, po.offsetDays),
        location_type: "DC",
        purchase_order_id: po.po,
        source: spec.successors.find((x) => x.id === skuId)?.vendor ?? "",
      });
    });
  }

  /* ---- JDA's current plan ---- */
  if (spec.jda && spec.successors.length > 0) {
    const forecast = Math.round(demand.weeklyUnits * horizonWeeks * spec.jda.forecastFactor);
    splitAcross(forecast, spec.successors.map((x) => x.id), succSplit).forEach(([skuId, units], j) => {
      out.currentPlan.push({
        sku_id: skuId,
        horizon_start: now,
        horizon_end: addDaysTo(now, horizonWeeks * 7 - 1),
        forecast_units: units,
        planned_replenishment_units:
          spec.jda?.plannedOrder !== undefined ? Math.round(spec.jda.plannedOrder * (succSplit[j] ?? 0)) : null,
      });
    });
  }

  /* ---- Selling profiles: JDA replenishes a store only for SKUs in its profile ---- */
  const successorStores = stores.filter((s) => s.state !== "LO").map((s) => s.store.id);
  const legacyStores = stores.filter((s) => s.state !== "NO").map((s) => s.store.id);
  for (const sku of spec.successors) {
    for (const store of successorStores) {
      out.profiles.push({ profile_id: `PRF-${sku.id}`, sku_id: sku.id, store_id: store, profile_name: `${spec.name} — National` });
    }
  }
  for (const sku of spec.legacy) {
    for (const store of legacyStores) {
      out.profiles.push({ profile_id: `PRF-${sku.id}`, sku_id: sku.id, store_id: store, profile_name: `${spec.name} (legacy)` });
    }
  }

  /* ---- The relationship itself ---- */
  if (spec.source === "PLANNER") {
    out.transitions.push({
      transition_id: spec.id,
      transition_name: spec.name,
      predecessor_sku_ids: spec.legacy.map((s) => s.id).join(", "),
      successor_sku_ids: spec.successors.map((s) => s.id).join(", "),
      transition_type: null,
      reason: spec.reason,
      start_date: addDaysTo(now, spec.startOffset),
      target_completion_date: addDaysTo(now, spec.targetOffset),
      substitutability_pct: spec.substitutability ?? null,
      transferred_demand_pct: null,
      successor_split:
        spec.successors.length > 1
          ? spec.successors.map((s, j) => `${s.id}:${Math.round((succSplit[j] ?? 0) * 100)}%`).join(", ")
          : null,
      safety_stock_weeks: spec.safetyWeeks ?? null,
      planner_confirmed: spec.confirmed ? "Y" : "N",
      closed: null,
    });
  }
  for (const h of spec.history ?? []) {
    out.history.push({ date: addDaysTo(now, h.offset), transition_id: transitionIdFor(spec), note: h.text, actor: DEMO_PLANNER });
  }
}

/** The id the engine will give a transition — explicit, system-recorded or suggested. */
function transitionIdFor(spec: LineageSpec): string {
  if (spec.source === "PLANNER") return spec.id;
  return `${spec.source === "SYSTEM" ? "sys" : "sug"}-${spec.legacy[0]?.id ?? spec.id}`;
}

/**
 * Weeks of cover per store. `fixed` marks the stores whose stock tells the
 * story (the ones designed to run out) — totals are fitted around them.
 */
function designCover(
  rng: Rng,
  plan: StockPlan,
  states: readonly ("LO" | "MX" | "NO")[],
  weekly: readonly number[],
  resupplyWeeks: number
): { weeks: number[]; fixed: boolean[] } {
  const n = states.length;
  const weeks = Array<number>(n).fill(0);
  const fixed = Array<boolean>(n).fill(false);
  const [lo, hi] = plan.cover ?? [4.8, 7.4];

  if (plan.profile === "balanced") {
    for (let i = 0; i < n; i++) weeks[i] = rng.range(lo, hi);
    return { weeks, fixed };
  }

  // Busier stores are the ones whose stockout matters, so risk is placed
  // among stores with real demand.
  const byDemand = [...Array(n).keys()].filter((i) => (weekly[i] ?? 0) > 0.8).sort((a, b) => (weekly[b] ?? 0) - (weekly[a] ?? 0));
  const pool = shuffle(rng, byDemand.slice(0, Math.max(10, Math.floor(byDemand.length * 0.7))));

  if (plan.profile === "thin") {
    for (let i = 0; i < n; i++) weeks[i] = rng.range(0.8, 4.8);
    const donors = shuffle(rng, [...Array(n).keys()].filter((i) => states[i] === "LO")).slice(0, plan.donors ?? 0);
    for (const i of donors) weeks[i] = rng.range(9.5, 13);
    return { weeks, fixed: Array<boolean>(n).fill(true) };
  }

  // Imbalanced: some stores about to run dry, some sitting on far too much.
  const atRisk = new Set<number>();
  const legacyFirst = pool.filter((i) => states[i] === "LO");
  const others = pool.filter((i) => states[i] !== "LO");
  const wantLegacy = Math.round((plan.atRisk ?? 0) * 0.6);
  for (const i of legacyFirst.slice(0, wantLegacy)) atRisk.add(i);
  for (const i of others) {
    if (atRisk.size >= (plan.atRisk ?? 0)) break;
    atRisk.add(i);
  }
  for (const i of atRisk) {
    weeks[i] = rng.range(0.4, Math.max(0.8, resupplyWeeks - 0.7));
    fixed[i] = true;
  }
  const donorPool = shuffle(rng, [...Array(n).keys()].filter((i) => !atRisk.has(i) && states[i] === "LO"));
  for (const i of donorPool.slice(0, plan.donors ?? 0)) weeks[i] = rng.range(13, 24);
  for (let i = 0; i < n; i++) if (weeks[i] === 0) weeks[i] = rng.range(Math.max(lo, resupplyWeeks + 0.6), Math.max(hi, resupplyWeeks + 3));
  return { weeks, fixed };
}

/** Scales the unfixed entries so the integer total hits `target` exactly. */
function fitTotal(values: readonly number[], fixed: readonly boolean[], target: number | undefined): number[] {
  // Rounded up: a slow seller designed at six weeks should not round to an
  // empty shelf.
  if (target === undefined) return values.map((v) => (fixed.some(Boolean) && fixed[values.indexOf(v)] ? Math.max(0, Math.round(v)) : Math.max(0, Math.ceil(v))));
  const fixedRounded = values.map((v, i) => (fixed[i] ? Math.max(0, Math.round(v)) : 0));
  const fixedSum = fixedRounded.reduce((a, b) => a + b, 0);
  const flexWeights = values.map((v, i) => (fixed[i] ? 0 : Math.max(0, v)));
  const flex = largestRemainder(Math.max(0, target - fixedSum), flexWeights);
  return values.map((_, i) => (fixed[i] ? (fixedRounded[i] ?? 0) : (flex[i] ?? 0)));
}

/* ------------------------------------------------------------------ */
/* Completed transitions                                               */
/* ------------------------------------------------------------------ */

function generateCompleted(
  rng: Rng,
  item: CatalogItem,
  k: number,
  used: Set<string>,
  now: string,
  out: Out,
  wave: "rebrand" | "edition"
): void {
  const legacyId = code(rng, item.category, 1000, 4999, used);
  const successorId = code(rng, item.category, 5000, 9899, used);
  const cost = round2(rng.range(item.cost[0], item.cost[1]));
  const lead = rng.pick([35, 42, 49, 56]);
  const v = vendor(rng);
  const endOffset = wave === "rebrand" ? -rng.int(20, 160) : -rng.int(420, 900);
  const startOffset = endOffset - rng.int(60, 140);
  const name = wave === "rebrand" ? item.name : `${item.name} (2023 refresh)`;
  const legacyName = wave === "rebrand" ? `${item.name} — old logo` : `${item.name} — 2019 Edition`;
  const successorName = wave === "rebrand" ? `${item.name} — Scouting America` : `${item.name} — 2023 Edition`;
  const spec = { family: item.family, category: item.category, program: item.program, sizeRange: item.sizeRange, color: item.color } as LineageSpec;
  out.skus.push(skuRow(spec, { id: legacyId, name: legacyName, brand: LEGACY_BRAND, vendor: v, cost, retail: round2(cost * 2.3), leadDays: lead }, { status: "DISCONTINUED", launch: addDaysTo(now, startOffset - 1500), discontinue: addDaysTo(now, endOffset) }));
  out.skus.push(skuRow(spec, { id: successorId, name: successorName, brand: wave === "rebrand" ? NEW_BRAND : LEGACY_BRAND, vendor: v, cost: round2(cost * 1.03), retail: round2(cost * 2.3), leadDays: lead }, { status: "ACTIVE", launch: addDaysTo(now, startOffset) }));

  // Twelve months of the successor at network level — enough for its page
  // to show a demand line, without store detail it no longer needs.
  const annual = rng.range(item.annual[0], item.annual[1]);
  const shape = SEASONALITY[item.season];
  const total = shape.reduce((a, b) => a + b, 0);
  const nowMonth = monthOf(now);
  for (let i = 12; i >= 1; i--) {
    const start = monthStart(nowMonth, -i);
    const month = monthOf(start);
    const units = Math.round((annual * (shape[Number(month.slice(5, 7)) - 1] ?? 1)) / total * rng.range(0.93, 1.07));
    out.sales.push({ sku_id: successorId, period_start: start, period_end: monthEnd(month), units_sold: units, store_id: null, sales_value: null });
  }
  out.inventory.push(invRow(now, successorId, DEMO_DC_ID, "DC", Math.round((annual / 52) * rng.range(18, 26)), 0));

  // A handful of the most recent rebrands are finished but not yet closed
  // out — the queue shows them as ready to close.
  const closed = !(wave === "rebrand" && k < 37);
  out.transitions.push({
    transition_id: `${wave === "rebrand" ? "TR-3" : "TR-4"}${String(k).padStart(3, "0")}`,
    transition_name: name,
    predecessor_sku_ids: legacyId,
    successor_sku_ids: successorId,
    transition_type: null,
    reason: wave === "rebrand" ? "REBRAND" : "REPLACEMENT",
    start_date: addDaysTo(now, startOffset),
    target_completion_date: addDaysTo(now, endOffset),
    substitutability_pct: null,
    transferred_demand_pct: null,
    successor_split: null,
    safety_stock_weeks: null,
    planner_confirmed: "Y",
    closed: closed ? "Y" : "N",
  });
}

/* ------------------------------------------------------------------ */
/* Row builders                                                        */
/* ------------------------------------------------------------------ */

function skuRow(
  spec: Pick<LineageSpec, "family" | "category" | "program" | "sizeRange" | "color">,
  sku: SkuDef,
  meta: { status: string; launch?: string; discontinue?: string; replacement?: string }
): RawRow {
  return {
    sku_id: sku.id,
    sku_name: sku.name,
    product_family: sku.family ?? spec.family,
    category: spec.category,
    status: meta.status,
    program: spec.program,
    brand: sku.brand,
    size_range: sku.sizeRange ?? spec.sizeRange ?? null,
    color: sku.color ?? spec.color ?? null,
    vendor: sku.vendor,
    packaging: sku.packaging ?? null,
    launch_date: meta.launch ?? null,
    discontinue_date: meta.discontinue ?? null,
    replacement_sku_id: meta.replacement ?? null,
    unit_cost: sku.cost,
    retail_price: sku.retail,
    lead_time_days: sku.leadDays,
  };
}

function pushSale(rows: SalesRow[], skuId: string, start: string, end: string, units: number, sku: SkuDef): void {
  const rounded = Math.round(units);
  if (rounded <= 0) return;
  rows.push({ skuId, periodStart: start, periodEnd: end, units: rounded, value: Math.round(rounded * sku.retail) });
}

function saleRaw(row: SalesRow): RawRow {
  return {
    sku_id: row.skuId,
    period_start: row.periodStart,
    period_end: row.periodEnd,
    units_sold: row.units,
    store_id: row.storeId ?? null,
    sales_value: row.value ?? null,
  };
}

function invRow(now: string, skuId: string, locationId: string, type: "STORE" | "DC", onHand: number, allocated: number): RawRow {
  return {
    sku_id: skuId,
    location_id: locationId,
    location_type: type,
    on_hand: onHand,
    allocated,
    available: Math.max(0, onHand - allocated),
    snapshot_date: now,
  };
}

/* ------------------------------------------------------------------ */
/* Arithmetic helpers                                                  */
/* ------------------------------------------------------------------ */

function shuffle<T>(rng: Rng, items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng.float() * (i + 1));
    const tmp = a[i] as T;
    a[i] = a[j] as T;
    a[j] = tmp;
  }
  return a;
}

function normalizeShares(weights: readonly number[]): number[] {
  const total = weights.reduce((a, b) => a + b, 0);
  return total > 0 ? weights.map((w) => w / total) : weights.map(() => 0);
}

/** Integer parts proportional to weights, summing exactly to `total`. */
export function largestRemainder(total: number, weights: readonly number[]): number[] {
  const t = Math.max(0, Math.round(total));
  const sum = weights.reduce((a, b) => a + Math.max(0, b), 0);
  if (sum <= 0 || t === 0) return weights.map(() => 0);
  const raw = weights.map((w) => (Math.max(0, w) / sum) * t);
  const out = raw.map(Math.floor);
  let rest = t - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, f: r - Math.floor(r) })).sort((a, b) => b.f - a.f || a.i - b.i);
  for (const { i } of order) {
    if (rest <= 0) break;
    out[i] = (out[i] ?? 0) + 1;
    rest -= 1;
  }
  return out;
}

function splitAcross(total: number, ids: readonly string[], shares: readonly number[]): [string, number][] {
  const parts = largestRemainder(total, shares);
  return ids.map((id, i) => [id, parts[i] ?? 0]);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
