/**
 * The seeded demo dataset generator (V2 §10, §11).
 *
 * Produces a `RawPlanningInput` — the same loose, snake_case shape an
 * uploaded workbook produces — so `normalizePlanningInput()` turns it into a
 * `PlanningDataset` exactly the way it turns an Excel upload into one. Nothing
 * downstream can tell the two apart (V2 §67).
 *
 * Everything here derives from a single `Rng(seed)` and an explicit
 * `planningNow`. No `Math.random()`, no `Date.now()`, no bare `new Date()`.
 *
 * Coherence, not decoration, is the point (V2 §11): the unresolved amount for
 * a program is *computed* from Business_Plan minus what actually got written
 * to Current_Plan — never a separately hand-picked number — and that same
 * computed figure sizes the "orphan" Historical_Items rows that explain it.
 * Line/material/BOM data is built from a handful of shared per-family tables
 * so every sheet stays mutually consistent.
 */

import type { PlanningDataset, RawPlanningInput, RawRow } from "@/types/dataset";
import { normalizePlanningInput } from "@/lib/dataset/normalize";
import { Rng } from "@/lib/utils/rng";

export interface DemoDatasetOptions {
  seed?: string;
  planningNow?: string;
}

export const DEFAULT_DEMO_SEED = "default-demo-2027";
/**
 * The planning date the calendar literals in this file are written against.
 * Tests pass it explicitly so they stay deterministic; the app does not, so a
 * demo opened today is anchored to today.
 */
export const DEMO_PLANNING_NOW = "2027-03-08T09:00:00.000Z";

/** The year the literals below belong to. Everything shifts relative to it. */
const NATIVE_ANCHOR_YEAR = 2027;

/**
 * Which season the demo opens on: the next one whose production has not
 * started yet.
 *
 * The dataset used to be pinned to March 2027, so a planner opening it was
 * told "Today · 8 Mar 27" — a date that is not today. Rather than shifting the
 * calendar by a number of days, which would slide Halloween out of autumn, the
 * whole programme calendar moves by whole years and keeps its real seasonal
 * months. The consequence is honest: how much runway the planner has depends
 * on when they actually open it.
 */
export function demoAnchorYear(planningNow: string): number {
  const date = new Date(planningNow);
  if (Number.isNaN(date.getTime())) return NATIVE_ANCHOR_YEAR;
  const month = date.getUTCMonth() + 1;
  // Halloween production starts late April; before then, this year's season is
  // still ahead.
  return month <= 4 ? date.getUTCFullYear() : date.getUTCFullYear() + 1;
}

/** Shifts every 4-digit year in a date, period key or event label. */
function shiftYearIn(value: string, delta: number): string {
  if (delta === 0) return value;
  return value.replace(/(?<!\d)(\d{4})(?!\d)/g, (year) => String(Number(year) + delta));
}

function shiftWindow(window: DateWindow, delta: number): DateWindow {
  return { start: shiftYearIn(window.start, delta), end: shiftYearIn(window.end, delta) };
}

function shiftProgram(program: Program, delta: number): Program {
  if (delta === 0) return program;
  return {
    ...program,
    planningPeriod: shiftYearIn(program.planningPeriod, delta),
    eventOrProgram: shiftYearIn(program.eventOrProgram, delta),
    salesWindow: shiftWindow(program.salesWindow, delta),
    productionWindow: shiftWindow(program.productionWindow, delta),
    historicalPeriod: shiftYearIn(program.historicalPeriod, delta),
    historicalEvent: shiftYearIn(program.historicalEvent, delta),
    historicalSalesWindow: shiftWindow(program.historicalSalesWindow, delta),
    historicalProductionWindow: shiftWindow(program.historicalProductionWindow, delta),
  };
}

function shiftOlderSeason(season: OlderSeason, delta: number): OlderSeason {
  if (delta === 0) return season;
  return {
    ...season,
    historicalPeriod: shiftYearIn(season.historicalPeriod, delta),
    historicalEvent: shiftYearIn(season.historicalEvent, delta),
    historicalProductionWindow: shiftWindow(season.historicalProductionWindow, delta),
    historicalSalesWindow: shiftWindow(season.historicalSalesWindow, delta),
  };
}

/* ------------------------------------------------------------------ */
/* Reference data                                                      */
/* ------------------------------------------------------------------ */

const FAMILIES = ["Variety Bags", "Gift Tins", "Counter Displays", "Molded Novelty"] as const;
type Family = (typeof FAMILIES)[number];

const BRANDS = ["Ridgeline", "Marlowe & Co", "Copperleaf"] as const;

const CUSTOMERS = [
  { name: "Meridian Mass", channel: "mass", weight: 0.4 },
  { name: "Harbor Grocery", channel: "grocery", weight: 0.27 },
  { name: "Vantage Club", channel: "club", weight: 0.2 },
  { name: "Lumen Drug", channel: "drug", weight: 0.13 },
] as const;

// Blended demo price ~$11/unit (V2 §27 coherence): with fixed programme
// dollar values ($620M/$410M/$150M), the unit-volume the four lines have to
// physically produce falls out of value/price. At the old ~$4.45 blend,
// Halloween alone implied ~94M formal units — more than four lines can
// produce even at plausible high-speed run rates. Gift Tins carries the
// highest price (decorative tin, premium gifting format), Variety Bags the
// lowest (everyday laydown bag), Counter Displays/Molded Novelty mid-range —
// all normal premium-confectionery wholesale prices.
const FAMILY_INFO: Record<Family, { price: number; packFormat: string; packagingType: string }> = {
  "Variety Bags": { price: 8.5, packFormat: "laydown bag", packagingType: "printed film" },
  "Gift Tins": { price: 18.0, packFormat: "tin", packagingType: "decorative tin" },
  "Counter Displays": { price: 11.0, packFormat: "counter display case", packagingType: "corrugate display" },
  "Molded Novelty": { price: 10.0, packFormat: "molded novelty", packagingType: "foil wrap" },
};

const FAMILY_CODE: Record<Family, string> = {
  "Variety Bags": "VB",
  "Gift Tins": "GT",
  "Counter Displays": "CD",
  "Molded Novelty": "MN",
};

const FORMULA_FAMILY: Record<Family, string> = {
  "Variety Bags": "milk-choc-std",
  "Gift Tins": "assorted-std",
  "Counter Displays": "singles-std",
  "Molded Novelty": "molded-std",
};

const FLAVORS: Record<Family, readonly string[]> = {
  "Variety Bags": ["milk chocolate", "caramel swirl", "peanut butter cup", "dark chocolate"],
  "Gift Tins": ["hazelnut truffle", "toffee crunch", "peppermint bark", "cherry cordial"],
  "Counter Displays": ["milk chocolate", "caramel", "almond"],
  "Molded Novelty": ["milk chocolate", "white chocolate", "dark chocolate", "cookies and cream"],
};

const PACK_SIZES: Record<Family, readonly { size: number; uom: string }[]> = {
  "Variety Bags": [
    { size: 35, uom: "ct" },
    { size: 38, uom: "ct" },
    { size: 40, uom: "ct" },
    { size: 42, uom: "ct" },
  ],
  "Gift Tins": [
    { size: 8, uom: "oz" },
    { size: 10, uom: "oz" },
    { size: 12, uom: "oz" },
  ],
  "Counter Displays": [
    { size: 24, uom: "ct" },
    { size: 36, uom: "ct" },
    { size: 48, uom: "ct" },
  ],
  "Molded Novelty": [
    { size: 1, uom: "oz" },
    { size: 2, uom: "oz" },
    { size: 3, uom: "oz" },
  ],
};

/** Which lines carry each family's volume, in priority order. Shared by
 *  Item_Line_Mapping, Current_Plan.primary_line_id, and the historical-items
 *  line-mapping anomaly below — one table, several consumers.
 *
 *  Run rates and allocation splits are tuned so the *volume* fits inside a
 *  physically realistic monthly hours budget (Line_Capacity below never
 *  exceeds a calendar month's ~744h ceiling, and normally sits in the
 *  420-700h band) — a high-speed confectionery line plausibly runs
 *  4,000-16,000 units/hour depending on format; faster for Variety Bags
 *  bagging, slower for Gift Tins decorate/fill. */
const FAMILY_LINE_ALLOC: Record<Family, readonly { lineId: string; pct: number; priority: number; runRate: number }[]> = {
  "Variety Bags": [
    { lineId: "LINE-03", pct: 0.55, priority: 1, runRate: 9_000 },
    { lineId: "LINE-04", pct: 0.45, priority: 2, runRate: 12_500 },
  ],
  // A minority slice spills onto Line 04 too — Line 01/02 alone stack too
  // high once Halloween's tail and Holiday's start share a month.
  "Gift Tins": [
    { lineId: "LINE-02", pct: 0.55, priority: 1, runRate: 8_500 },
    { lineId: "LINE-01", pct: 0.2, priority: 2, runRate: 10_000 },
    { lineId: "LINE-04", pct: 0.25, priority: 3, runRate: 11_000 },
  ],
  // The bulk stays on the dedicated line; a meaningful slice spills onto
  // Line 04 — it still needs headroom to absorb a Line 03 shift, not another
  // full-sized family stacked on top of Variety Bags.
  "Counter Displays": [
    { lineId: "LINE-01", pct: 0.6, priority: 1, runRate: 12_000 },
    { lineId: "LINE-04", pct: 0.4, priority: 2, runRate: 13_800 },
  ],
  // Mostly off Line 01/04 — it would otherwise stack on top of Gift Tins /
  // Counter Displays / Variety Bags in the months one programme's production
  // window overlaps another's, well past a physically real ceiling. A small
  // Line 04 slice keeps Line 02 from carrying it alone.
  "Molded Novelty": [
    { lineId: "LINE-02", pct: 0.7, priority: 1, runRate: 9_500 },
    { lineId: "LINE-04", pct: 0.3, priority: 2, runRate: 11_500 },
  ],
};

/** `baseHours` is the physically realistic anchor `generateLineCapacity`
 *  jitters month to month (V2 §20) — never derived from load. A calendar
 *  month has at most ~744h (31 * 24); a two/three-shift line sits well
 *  below that. */
const LINES = [
  { id: "LINE-01", name: "Line 01 — Assembly & Novelty", baseHours: 620 },
  { id: "LINE-02", name: "Line 02 — Tin Fill & Decorate", baseHours: 540 },
  { id: "LINE-03", name: "Line 03 — High-Speed Bagging", baseHours: 650 },
  { id: "LINE-04", name: "Line 04 — Flexible Bagging & Display", baseHours: 600 },
] as const;

type MaterialId =
  | "MAT-COCOA"
  | "MAT-SUGAR"
  | "MAT-MILK"
  | "MAT-FILM"
  | "MAT-FOIL"
  | "MAT-CORR"
  | "MAT-TRAY"
  | "MAT-TIN"
  | "MAT-ARTWORK";

interface MaterialDef {
  id: MaterialId;
  name: string;
  type: "RAW_MATERIAL" | "PACKAGING" | "ARTWORK";
  family: string;
  uom: string;
}

const MATERIALS: readonly MaterialDef[] = [
  { id: "MAT-COCOA", name: "Cocoa liquor", type: "RAW_MATERIAL", family: "Cocoa", uom: "kg" },
  { id: "MAT-SUGAR", name: "Sugar", type: "RAW_MATERIAL", family: "Sugar", uom: "kg" },
  { id: "MAT-MILK", name: "Milk solids", type: "RAW_MATERIAL", family: "Dairy", uom: "kg" },
  { id: "MAT-FILM", name: "Printed film laminate", type: "PACKAGING", family: "Printed Film", uom: "kg" },
  { id: "MAT-FOIL", name: "Foil wrap", type: "PACKAGING", family: "Foil", uom: "kg" },
  { id: "MAT-CORR", name: "Corrugate shipper", type: "PACKAGING", family: "Corrugate", uom: "ea" },
  { id: "MAT-TRAY", name: "Moulded tray", type: "PACKAGING", family: "Tray", uom: "ea" },
  { id: "MAT-TIN", name: "Decorative tin", type: "PACKAGING", family: "Tin", uom: "ea" },
  { id: "MAT-ARTWORK", name: "Artwork release", type: "ARTWORK", family: "Artwork", uom: "ea" },
];

const MATERIALS_BY_ID: Record<MaterialId, MaterialDef> = Object.fromEntries(
  MATERIALS.map((m) => [m.id, m])
) as Record<MaterialId, MaterialDef>;

/**
 * Who supplies each material, in the order a planner would name them.
 *
 * More than one on purpose: a component bought from a single source and one
 * split across three behave differently under pressure, and a screen ranking
 * suppliers has nothing to say when every material has exactly one. `share` is
 * the split of volume, and the last entry of each is deliberately the slower
 * one — a second source usually is.
 */
interface SupplierRef {
  id: string;
  name: string;
  /** Share of receipts, summing to 1 within a material. */
  share: number;
  /** Multiplier on the material's lead-time mean for this supplier. */
  leadTimeFactor: number;
}

const MATERIAL_SUPPLIERS: Record<MaterialId, readonly SupplierRef[]> = {
  "MAT-COCOA": [
    { id: "SUP-201", name: "Meridian Cocoa Trading", share: 0.62, leadTimeFactor: 0.94 },
    { id: "SUP-202", name: "Cala Bean Importers", share: 0.26, leadTimeFactor: 1.05 },
    { id: "SUP-203", name: "Harborlight Cocoa", share: 0.12, leadTimeFactor: 1.18 },
  ],
  "MAT-SUGAR": [
    { id: "SUP-205", name: "Union Sweetener Co", share: 0.71, leadTimeFactor: 0.96 },
    { id: "SUP-206", name: "Fieldstone Refiners", share: 0.29, leadTimeFactor: 1.12 },
  ],
  "MAT-MILK": [
    { id: "SUP-207", name: "Dairyfield Ingredients", share: 0.58, leadTimeFactor: 0.95 },
    { id: "SUP-208", name: "Pinehill Dairy Co-op", share: 0.42, leadTimeFactor: 1.08 },
  ],
  "MAT-FILM": [
    { id: "SUP-118", name: "Northvale Flexibles", share: 0.55, leadTimeFactor: 0.88 },
    { id: "SUP-119", name: "Kestrel Print & Laminate", share: 0.31, leadTimeFactor: 1.06 },
    { id: "SUP-120", name: "Anchor Film Converting", share: 0.14, leadTimeFactor: 1.32 },
  ],
  "MAT-FOIL": [
    { id: "SUP-142", name: "Alumina Wrap Supply", share: 0.78, leadTimeFactor: 0.97 },
    { id: "SUP-143", name: "Sterling Foil Works", share: 0.22, leadTimeFactor: 1.14 },
  ],
  "MAT-CORR": [
    { id: "SUP-160", name: "Boxcraft Corrugate", share: 0.64, leadTimeFactor: 0.95 },
    { id: "SUP-161", name: "Ridgeway Packaging", share: 0.36, leadTimeFactor: 1.09 },
  ],
  "MAT-TRAY": [
    { id: "SUP-166", name: "Formwell Molding", share: 0.83, leadTimeFactor: 0.98 },
    { id: "SUP-167", name: "Claybrook Thermoform", share: 0.17, leadTimeFactor: 1.16 },
  ],
  "MAT-TIN": [
    { id: "SUP-171", name: "Heritage Tinware", share: 0.6, leadTimeFactor: 0.92 },
    { id: "SUP-172", name: "Eastgate Metal Pack", share: 0.4, leadTimeFactor: 1.13 },
  ],
  "MAT-ARTWORK": [{ id: "SUP-190", name: "Studio Release Partners", share: 1, leadTimeFactor: 1 }],
};

/** The primary source, which is what a BOM line names. */
const MATERIAL_SUPPLIER: Record<MaterialId, { id: string; name: string }> = Object.fromEntries(
  Object.entries(MATERIAL_SUPPLIERS).map(([id, list]) => [
    id,
    { id: list[0]?.id ?? "SUP-000", name: list[0]?.name ?? "Unknown" },
  ])
) as Record<MaterialId, { id: string; name: string }>;

/** Picks a supplier for one receipt, by volume share. */
function pickSupplier(rng: Rng, materialId: MaterialId): SupplierRef {
  const list = MATERIAL_SUPPLIERS[materialId];
  let roll = rng.float();
  for (const supplier of list) {
    roll -= supplier.share;
    if (roll <= 0) return supplier;
  }
  return list[list.length - 1] ?? list[0]!;
}

const SPEC_FAMILY: Record<MaterialId, string> = {
  "MAT-COCOA": "cocoa-liquor-std",
  "MAT-SUGAR": "granulated-std",
  "MAT-MILK": "milk-solid-std",
  "MAT-FILM": "laminate-7c",
  "MAT-FOIL": "foil-8micron",
  "MAT-CORR": "corrugate-c-flute",
  "MAT-TRAY": "tray-pet-std",
  "MAT-TIN": "tin-round-std",
  "MAT-ARTWORK": "artwork-release-std",
};

/** system/actual lead-time shape per material. MAT-FILM is the master-data
 *  story: system says 42 days, actuals cluster around a 67d median / 81d P80. */
const LEAD_TIME_PROFILE: Record<MaterialId, { system: number; mean: number; sd: number; count: number }> = {
  "MAT-COCOA": { system: 35, mean: 36, sd: 6, count: 22 },
  "MAT-SUGAR": { system: 21, mean: 22, sd: 4, count: 20 },
  "MAT-MILK": { system: 18, mean: 19, sd: 4, count: 18 },
  "MAT-FILM": { system: 42, mean: 70, sd: 17, count: 26 },
  "MAT-FOIL": { system: 30, mean: 33, sd: 6, count: 16 },
  "MAT-CORR": { system: 25, mean: 27, sd: 5, count: 14 },
  "MAT-TRAY": { system: 38, mean: 41, sd: 7, count: 12 },
  "MAT-TIN": { system: 55, mean: 60, sd: 9, count: 10 },
  "MAT-ARTWORK": { system: 20, mean: 24, sd: 6, count: 12 },
};

const MATERIAL_QTY_RANGE: Record<MaterialId, readonly [number, number]> = {
  "MAT-COCOA": [9_000, 22_000],
  "MAT-SUGAR": [8_000, 20_000],
  "MAT-MILK": [5_000, 14_000],
  "MAT-FILM": [8_000, 18_000],
  "MAT-FOIL": [4_000, 11_000],
  "MAT-CORR": [3_000, 9_000],
  "MAT-TRAY": [2_500, 7_000],
  "MAT-TIN": [4_000, 12_000],
  "MAT-ARTWORK": [1, 6],
};

interface BomTemplateLine {
  componentId: MaterialId;
  qty: number;
  uom: string;
  scrap: number;
  status: "stable" | "review" | "wait";
  /** Raw ingredients stay identical across analogues (V2 §11); packaging varies with pack format. */
  jitter: boolean;
}

const BOM_TEMPLATES: Record<Family, readonly BomTemplateLine[]> = {
  "Variety Bags": [
    { componentId: "MAT-COCOA", qty: 0.018, uom: "kg", scrap: 0.015, status: "stable", jitter: false },
    { componentId: "MAT-SUGAR", qty: 0.014, uom: "kg", scrap: 0.012, status: "stable", jitter: false },
    { componentId: "MAT-MILK", qty: 0.008, uom: "kg", scrap: 0.018, status: "stable", jitter: false },
    { componentId: "MAT-FILM", qty: 0.0062, uom: "kg", scrap: 0.035, status: "wait", jitter: true },
    { componentId: "MAT-CORR", qty: 0.00045, uom: "ea", scrap: 0.02, status: "review", jitter: true },
    { componentId: "MAT-ARTWORK", qty: 0.00003, uom: "ea", scrap: 0, status: "wait", jitter: true },
  ],
  "Gift Tins": [
    { componentId: "MAT-COCOA", qty: 0.022, uom: "kg", scrap: 0.015, status: "stable", jitter: false },
    { componentId: "MAT-SUGAR", qty: 0.016, uom: "kg", scrap: 0.012, status: "stable", jitter: false },
    { componentId: "MAT-MILK", qty: 0.01, uom: "kg", scrap: 0.018, status: "stable", jitter: false },
    { componentId: "MAT-TIN", qty: 1.0, uom: "ea", scrap: 0.03, status: "review", jitter: true },
    { componentId: "MAT-ARTWORK", qty: 0.00004, uom: "ea", scrap: 0, status: "wait", jitter: true },
  ],
  "Counter Displays": [
    { componentId: "MAT-COCOA", qty: 0.15, uom: "kg", scrap: 0.015, status: "stable", jitter: false },
    { componentId: "MAT-SUGAR", qty: 0.11, uom: "kg", scrap: 0.012, status: "stable", jitter: false },
    { componentId: "MAT-MILK", qty: 0.065, uom: "kg", scrap: 0.018, status: "stable", jitter: false },
    { componentId: "MAT-FILM", qty: 0.02, uom: "kg", scrap: 0.035, status: "wait", jitter: true },
    { componentId: "MAT-CORR", qty: 1.0, uom: "ea", scrap: 0.02, status: "review", jitter: true },
    { componentId: "MAT-ARTWORK", qty: 0.00003, uom: "ea", scrap: 0, status: "wait", jitter: true },
  ],
  "Molded Novelty": [
    { componentId: "MAT-COCOA", qty: 0.03, uom: "kg", scrap: 0.015, status: "stable", jitter: false },
    { componentId: "MAT-SUGAR", qty: 0.02, uom: "kg", scrap: 0.012, status: "stable", jitter: false },
    { componentId: "MAT-MILK", qty: 0.012, uom: "kg", scrap: 0.018, status: "stable", jitter: false },
    { componentId: "MAT-TRAY", qty: 1.0, uom: "ea", scrap: 0.025, status: "review", jitter: true },
    { componentId: "MAT-FOIL", qty: 0.004, uom: "kg", scrap: 0.03, status: "review", jitter: true },
    { componentId: "MAT-ARTWORK", qty: 0.00003, uom: "ea", scrap: 0, status: "wait", jitter: true },
  ],
};

/* ------------------------------------------------------------------ */
/* Programs                                                             */
/* ------------------------------------------------------------------ */

interface DateWindow {
  start: string;
  end: string;
}

interface Program {
  code: "HAL" | "HOL" | "VAL";
  planningPeriod: string;
  eventOrProgram: string;
  themeWord: string;
  businessUnit: string;
  salesWindow: DateWindow;
  productionWindow: DateWindow;
  historicalPeriod: string;
  historicalEvent: string;
  historicalSalesWindow: DateWindow;
  historicalProductionWindow: DateWindow;
  totalBusinessValue: number;
  formalRatioTarget: number;
  familyWeight: Record<Family, number>;
  familyFormalRatioBase: Record<Family, number>;
  /** The concrete "this seasonal SKU isn't created yet" story for the program. */
  flagshipGap?: { family: Family; customer: string };
}

const PROGRAMS: readonly Program[] = [
  {
    code: "HAL",
    planningPeriod: "2027-Halloween",
    eventOrProgram: "Halloween 2027",
    themeWord: "Halloween",
    businessUnit: "Confectionery",
    salesWindow: { start: "2027-08-16", end: "2027-10-31" },
    productionWindow: { start: "2027-04-26", end: "2027-08-06" },
    historicalPeriod: "2026-Halloween",
    historicalEvent: "Halloween 2026",
    historicalSalesWindow: { start: "2026-08-17", end: "2026-10-31" },
    historicalProductionWindow: { start: "2026-05-04", end: "2026-07-31" },
    totalBusinessValue: 620_000_000,
    formalRatioTarget: 446 / 620,
    familyWeight: { "Variety Bags": 0.5, "Gift Tins": 0.1, "Counter Displays": 0.25, "Molded Novelty": 0.15 },
    familyFormalRatioBase: { "Variety Bags": 0.55, "Gift Tins": 0.9, "Counter Displays": 0.85, "Molded Novelty": 0.85 },
    flagshipGap: { family: "Variety Bags", customer: "Meridian Mass" },
  },
  {
    code: "HOL",
    planningPeriod: "2027-Holiday",
    eventOrProgram: "Holiday 2027",
    themeWord: "Holiday",
    businessUnit: "Confectionery",
    salesWindow: { start: "2027-11-01", end: "2027-12-26" },
    productionWindow: { start: "2027-07-05", end: "2027-10-29" },
    historicalPeriod: "2026-Holiday",
    historicalEvent: "Holiday 2026",
    historicalSalesWindow: { start: "2026-11-02", end: "2026-12-26" },
    historicalProductionWindow: { start: "2026-07-06", end: "2026-10-30" },
    totalBusinessValue: 410_000_000,
    formalRatioTarget: 0.85,
    familyWeight: { "Variety Bags": 0.2, "Gift Tins": 0.55, "Counter Displays": 0.15, "Molded Novelty": 0.1 },
    familyFormalRatioBase: { "Variety Bags": 0.85, "Gift Tins": 0.9, "Counter Displays": 0.8, "Molded Novelty": 0.75 },
  },
  {
    code: "VAL",
    planningPeriod: "2028-Valentine",
    eventOrProgram: "Valentine 2028",
    themeWord: "Valentine",
    businessUnit: "Confectionery",
    salesWindow: { start: "2028-01-08", end: "2028-02-14" },
    productionWindow: { start: "2027-10-04", end: "2027-12-17" },
    // Deliberately just "Valentine 2028" (not "Valentine Refresh 2028"): the
    // programme label has to agree with the historical event's label
    // ("Valentine 2027") for comparableHistorical() to find a comparable
    // prior season at all (V2 §16.3) — a themed sub-title would silently
    // orphan the whole event from its own history.
    historicalPeriod: "2027-Valentine",
    historicalEvent: "Valentine 2027",
    historicalSalesWindow: { start: "2027-01-09", end: "2027-02-14" },
    historicalProductionWindow: { start: "2026-10-05", end: "2026-12-18" },
    totalBusinessValue: 150_000_000,
    formalRatioTarget: 0.55,
    familyWeight: { "Gift Tins": 0.45, "Molded Novelty": 0.25, "Variety Bags": 0.2, "Counter Displays": 0.1 },
    familyFormalRatioBase: { "Gift Tins": 0.25, "Molded Novelty": 0.7, "Variety Bags": 0.8, "Counter Displays": 0.75 },
    flagshipGap: { family: "Gift Tins", customer: "Meridian Mass" },
  },
];

/* ------------------------------------------------------------------ */
/* Small deterministic helpers                                         */
/* ------------------------------------------------------------------ */

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}
function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}
function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
function pickBrand(rng: Rng): string {
  const r = rng.float();
  if (r < 0.5) return BRANDS[0];
  if (r < 0.8) return BRANDS[1];
  return BRANDS[2];
}
function pickPackSize(rng: Rng, family: Family): { size: number; uom: string } {
  return rng.pick(PACK_SIZES[family]);
}
function pickFlavor(rng: Rng, family: Family): string {
  return rng.pick(FLAVORS[family]);
}
/**
 * Names the way someone in the business would say them: "Ridgeline Variety Bag
 * 42ct".
 *
 * The programme deliberately does not appear. Every row on a reconcile screen
 * belongs to the same programme — the page header already says so — and
 * repeating "Halloween (prior season)" on twenty rows pushed the one genuinely
 * distinguishing part, the format and size, off to the right where it was
 * hardest to scan. Brand, family and customer stay in their own columns rather
 * than being folded into the name.
 */
function itemName(
  brand: string,
  family: Family,
  pack: { size: number; uom: string },
  flavor: string
): string {
  // Named the way a confectionery planner would say it out loud: what it is
  // made of, then what it comes in. "Copperleaf Counter Display 36ct" told a
  // reader the pack and nothing about the product — twenty rows of it read as
  // twenty format codes rather than twenty things you could picture.
  return `${brand} ${titleCase(flavor)} ${FORMAT_NOUN[family]} ${pack.size}${pack.uom}`;
}

function titleCase(value: string): string {
  return value.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/** The singular noun a planner uses for each family. */
const FORMAT_NOUN: Record<Family, string> = {
  "Variety Bags": "Minis Bag",
  "Gift Tins": "Gift Tin",
  "Counter Displays": "Bar Display",
  "Molded Novelty": "Molded Novelty",
};
function otherFamilies(exclude: Family): Family[] {
  return FAMILIES.filter((f) => f !== exclude);
}

/** Irwin-Hall(3), standardized to mean 0 / sd 1, then rescaled — an
 *  approximately bell-shaped, bounded draw without a real normal sampler. */
function normalish(rng: Rng, mean: number, sd: number, min = 5): number {
  const u = rng.float() + rng.float() + rng.float();
  const z = (u - 1.5) / 0.5;
  return Math.max(min, Math.round(mean + z * sd));
}

function monthRange(startYm: string, endYm: string): string[] {
  const startParts = startYm.split("-").map(Number);
  const endParts = endYm.split("-").map(Number);
  let y = startParts[0] ?? 0;
  let m = startParts[1] ?? 1;
  const ey = endParts[0] ?? 0;
  const em = endParts[1] ?? 1;
  const months: string[] = [];
  while (y < ey || (y === ey && m <= em)) {
    months.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return months;
}

/* ------------------------------------------------------------------ */
/* BOM                                                                  */
/* ------------------------------------------------------------------ */

function bomRowsFor(rng: Rng, parentItemId: string, family: Family): RawRow[] {
  return BOM_TEMPLATES[family].map((line) => {
    const material = MATERIALS_BY_ID[line.componentId];
    const qty = line.jitter ? line.qty * rng.range(0.88, 1.12) : line.qty;
    return {
      parent_item_id: parentItemId,
      component_id: line.componentId,
      component_name: material.name,
      component_type: material.type,
      quantity_per_parent: round6(qty),
      uom: line.uom,
      component_family: material.family,
      scrap_pct: line.scrap,
      planning_status: line.status,
      supplier_id: MATERIAL_SUPPLIER[line.componentId].id,
      ...(line.componentId === "MAT-FILM"
        ? { notes: "Artwork and film changeover drive lead time" }
        : {}),
    } satisfies RawRow;
  });
}

/* ------------------------------------------------------------------ */
/* Business_Plan / Current_Plan / Historical_Items — one program        */
/* ------------------------------------------------------------------ */

interface PricedSegment {
  family: Family;
  customer: string;
  channel: string;
  brand: string;
  weight: number;
  value: number;
  price: number;
  units: number;
}

function priceSegments(rng: Rng, program: Program): PricedSegment[] {
  const raw = FAMILIES.flatMap((family) =>
    CUSTOMERS.map((customer) => {
      const baseWeight = program.familyWeight[family] * customer.weight;
      const weight = baseWeight * rng.range(0.85, 1.15);
      const brand = pickBrand(rng);
      return { family, customer: customer.name, channel: customer.channel, brand, weight };
    })
  );
  const totalWeight = raw.reduce((s, seg) => s + seg.weight, 0);
  return raw.map((seg) => {
    const value = (seg.weight / totalWeight) * program.totalBusinessValue;
    const price = FAMILY_INFO[seg.family].price * rng.range(0.95, 1.05);
    return { ...seg, value, price, units: value / price };
  });
}

/**
 * Formalization ratio per segment. The flagship-gap segment (when the
 * program has one) is always fully unresolved — "this seasonal SKU is not
 * created yet" — and the remaining segments are rescaled so the program
 * still lands on `formalRatioTarget` overall (V2 §11 coherence: one target,
 * not one hand-picked number per row).
 */
function computeFormalRatios(program: Program, priced: PricedSegment[]): (PricedSegment & { formalRatio: number })[] {
  const flagship = program.flagshipGap;
  const flagshipSeg = flagship
    ? priced.find((s) => s.family === flagship.family && s.customer === flagship.customer)
    : undefined;

  const ratios = priced.map((seg) => ({
    seg,
    ratio: flagshipSeg && seg === flagshipSeg ? 0 : program.familyFormalRatioBase[seg.family],
  }));
  const targetSum = program.totalBusinessValue * program.formalRatioTarget;

  // Water-filling: after the flagship segment is forced to zero, redistribute
  // the shortfall (or surplus) across the remaining segments proportional to
  // their movable value, so the program still lands on `formalRatioTarget`
  // overall rather than silently drifting off it (V2 §11 coherence).
  for (let iter = 0; iter < 8; iter++) {
    const currentSum = ratios.reduce((s, r) => s + r.seg.value * r.ratio, 0);
    const diff = targetSum - currentSum;
    if (Math.abs(diff) < 1) break;

    const movable = ratios.filter((r) => !(flagshipSeg && r.seg === flagshipSeg) && (diff > 0 ? r.ratio < 1 : r.ratio > 0));
    const movableCapacity = movable.reduce((s, r) => s + r.seg.value * (diff > 0 ? 1 - r.ratio : r.ratio), 0);
    if (movableCapacity <= 0) break;

    for (const r of movable) {
      const room = diff > 0 ? 1 - r.ratio : r.ratio;
      const share = (r.seg.value * room) / movableCapacity;
      const delta = (diff * share) / r.seg.value;
      r.ratio = clamp01(r.ratio + delta);
    }
  }

  return priced.map((seg) => {
    const found = ratios.find((r) => r.seg === seg);
    return { ...seg, formalRatio: found ? found.ratio : 0 };
  });
}

interface ProgramOutput {
  businessPlanRows: RawRow[];
  currentPlanRows: RawRow[];
  historicalRows: RawRow[];
  bomRows: RawRow[];
  itemRefs: { itemId: string; family: Family }[];
}

function linePrimaryForHistory(rng: Rng, family: Family): string {
  // Counter Displays is the deliberate line-mapping anomaly: Item_Line_Mapping
  // says LINE-01/LINE-04, but history shows it mostly ran on LINE-02.
  if (family === "Counter Displays") {
    return rng.float() < 0.85 ? "LINE-02" : "LINE-01";
  }
  const alloc = FAMILY_LINE_ALLOC[family];
  const r = rng.float();
  let cum = 0;
  for (const a of alloc) {
    cum += a.pct;
    if (r <= cum) return a.lineId;
  }
  return alloc[alloc.length - 1]?.lineId ?? "LINE-01";
}

function buildHistoricalRow(args: {
  themeWord: string;
  historicalPeriod: string;
  historicalEvent: string;
  historicalProductionWindow: DateWindow;
  historicalSalesWindow: DateWindow;
  family: Family;
  brand: string;
  customer: string;
  channel: string;
  itemId: string;
  actualUnits: number;
  price: number;
  packSize: { size: number; uom: string };
  primaryLine: string;
  flavor: string;
}): RawRow {
  const { family, packSize } = args;
  return {
    historical_period: args.historicalPeriod,
    item_id: args.itemId,
    item_name: itemName(args.brand, family, packSize, args.flavor),
    brand: args.brand,
    product_family: family,
    actual_units: Math.max(0, Math.round(args.actualUnits)),
    event_or_program: args.historicalEvent,
    customer: args.customer,
    channel: args.channel,
    pack_format: FAMILY_INFO[family].packFormat,
    pack_size: packSize.size,
    size_uom: packSize.uom,
    flavor_or_variant: args.flavor,
    formula_family: FORMULA_FAMILY[family],
    packaging_type: FAMILY_INFO[family].packagingType,
    base_pack: `BP-${FAMILY_CODE[family]}-${packSize.size}`,
    actual_value: Math.max(0, Math.round(args.actualUnits * args.price)),
    currency: "USD",
    plant: "PLT-01",
    primary_line_id: args.primaryLine,
    production_start_date: args.historicalProductionWindow.start,
    production_end_date: args.historicalProductionWindow.end,
    sales_start_date: args.historicalSalesWindow.start,
    sales_end_date: args.historicalSalesWindow.end,
    status: "shipped",
  } satisfies RawRow;
}

function generateProgram(rng: Rng, program: Program): ProgramOutput {
  const priced = priceSegments(rng, program);
  const withRatio = computeFormalRatios(program, priced);

  const businessPlanRows: RawRow[] = withRatio.map((seg) => ({
    planning_period: program.planningPeriod,
    event_or_program: program.eventOrProgram,
    business_unit: program.businessUnit,
    brand: seg.brand,
    target_value: Math.round(seg.value),
    target_units: Math.round(seg.units),
    customer: seg.customer,
    channel: seg.channel,
    product_family: seg.family,
    growth_pct: round4(rng.range(0.02, 0.09)),
    currency: "USD",
  }));

  const currentPlanRows: RawRow[] = [];
  const historicalRows: RawRow[] = [];
  const bomRows: RawRow[] = [];
  const itemRefs: { itemId: string; family: Family }[] = [];

  let itemSeq = 1;
  let histSeq = 1;

  for (const seg of withRatio) {
    let currentItemId: string | undefined;

    if (seg.formalRatio > 0.001) {
      const plannedUnits = Math.round((seg.value * seg.formalRatio) / seg.price);
      const plannedValue = Math.round(seg.value * seg.formalRatio);
      if (plannedUnits > 0) {
        currentItemId = `SKU-${program.code}-${String(itemSeq).padStart(2, "0")}`;
        itemSeq++;
        const primaryLine = FAMILY_LINE_ALLOC[seg.family][0]?.lineId ?? "LINE-01";
        const packSize = pickPackSize(rng, seg.family);
        // Its own stream, so naming the current-plan items does not shift
        // every random draw that follows and rewrite the seeded dataset.
        const currentFlavor = pickFlavor(new Rng(`flavor::${currentItemId}`), seg.family);
        currentPlanRows.push({
          planning_period: program.planningPeriod,
          item_id: currentItemId,
          item_name: itemName(seg.brand, seg.family, packSize, currentFlavor),
          brand: seg.brand,
          product_family: seg.family,
          planned_units: plannedUnits,
          event_or_program: program.eventOrProgram,
          customer: seg.customer,
          channel: seg.channel,
          planned_value: plannedValue,
          currency: "USD",
          plant: "PLT-01",
          primary_line_id: primaryLine,
          production_start_date: program.productionWindow.start,
          production_end_date: program.productionWindow.end,
          sales_start_date: program.salesWindow.start,
          sales_end_date: program.salesWindow.end,
          status: "firm",
        });
        bomRows.push(...bomRowsFor(rng, currentItemId, seg.family));
        itemRefs.push({ itemId: currentItemId, family: seg.family });
      }
    }

    if (currentItemId) {
      const successorUnits = (seg.value * seg.formalRatio) / seg.price;
      const histUnits = successorUnits * rng.range(0.9, 1.08);
      const histItemId = `SKU-${program.code}-H-${String(histSeq).padStart(2, "0")}`;
      histSeq++;
      const packSize = pickPackSize(rng, seg.family);
      historicalRows.push(
        buildHistoricalRow({
          themeWord: program.themeWord,
          historicalPeriod: program.historicalPeriod,
          historicalEvent: program.historicalEvent,
          historicalProductionWindow: program.historicalProductionWindow,
          historicalSalesWindow: program.historicalSalesWindow,
          family: seg.family,
          brand: seg.brand,
          customer: seg.customer,
          channel: seg.channel,
          itemId: histItemId,
          actualUnits: histUnits,
          price: seg.price * rng.range(0.9, 1.0),
          packSize,
          primaryLine: linePrimaryForHistory(rng, seg.family),
          flavor: pickFlavor(rng, seg.family),
        })
      );
      // Matched to its current-season successor by attributes (V2 §21) — this
      // is "already represented", never unresolved load.
      bomRows.push(...bomRowsFor(rng, histItemId, seg.family));
    }
  }

  // The unresolved amount is computed, never hand-picked (V2 §11): it is
  // exactly what Business_Plan promises minus what Current_Plan actually
  // represents. The orphan historical items below are sized to exactly this
  // figure, which is the whole reconciliation story — prior-season items with
  // no 2027 successor that plausibly explain the gap.
  const actualFormalTotal = currentPlanRows.reduce((s, r) => s + (r.planned_value as number), 0);
  const unresolvedTotal = Math.max(0, program.totalBusinessValue - actualFormalTotal);
  const avgPrice = FAMILIES.reduce((s, f) => s + program.familyWeight[f] * FAMILY_INFO[f].price, 0);
  const unresolvedUnitsTarget = avgPrice > 0 ? unresolvedTotal / avgPrice : 0;

  const gapFamily: Family =
    program.flagshipGap?.family ??
    (Object.entries(program.familyWeight).sort((a, b) => b[1] - a[1])[0]?.[0] as Family | undefined) ??
    FAMILIES[0];
  const others = otherFamilies(gapFamily);
  const orphanFamilies: Family[] = [gapFamily, gapFamily, gapFamily, others[0] ?? gapFamily, others[1] ?? gapFamily];

  const orphanWeights = orphanFamilies.map(() => rng.range(0.5, 1.5));
  const orphanWeightSum = orphanWeights.reduce((s, w) => s + w, 0);

  for (let i = 0; i < orphanFamilies.length; i++) {
    const family = orphanFamilies[i] ?? gapFamily;
    const weight = orphanWeights[i] ?? 1;
    const share = orphanWeightSum > 0 ? weight / orphanWeightSum : 0;
    const units = unresolvedUnitsTarget * share;
    if (units < 1) continue;

    const price = FAMILY_INFO[family].price * rng.range(0.9, 1.0);
    const customer = rng.pick(CUSTOMERS);
    const brand = pickBrand(rng);
    const packSize = pickPackSize(rng, family);
    const histItemId = `SKU-${program.code}-H-${String(histSeq).padStart(2, "0")}`;
    histSeq++;

    historicalRows.push(
      buildHistoricalRow({
        themeWord: program.themeWord,
        historicalPeriod: program.historicalPeriod,
        historicalEvent: program.historicalEvent,
        historicalProductionWindow: program.historicalProductionWindow,
        historicalSalesWindow: program.historicalSalesWindow,
        family,
        brand,
        customer: customer.name,
        channel: customer.channel,
        itemId: histItemId,
        actualUnits: units,
        price,
        packSize,
        primaryLine: linePrimaryForHistory(rng, family),
        flavor: pickFlavor(rng, family),
      })
    );
    // The last orphan is deliberately left unspecified: a renovation whose
    // bill of materials was never set up. Its volume is as real as any other,
    // but its components can only be read from comparable products — which is
    // the whole analogous-forecasting case (V2 §17, Golden Scenario B).
    // Everything downstream must show it as inferred rather than firm.
    const unspecified = i === orphanFamilies.length - 1;
    if (!unspecified) bomRows.push(...bomRowsFor(rng, histItemId, family));
    // No 2027 successor — this is exactly the "carry forward" unresolved load
    // the engine's candidate matcher will surface.
  }

  return {
    businessPlanRows,
    currentPlanRows,
    historicalRows,
    bomRows,
    itemRefs,
  };
}

/* ------------------------------------------------------------------ */
/* A second, older comparable season per programme                     */
/* ------------------------------------------------------------------ */

interface OlderSeason {
  programCode: Program["code"];
  historicalPeriod: string;
  historicalEvent: string;
  historicalProductionWindow: DateWindow;
  historicalSalesWindow: DateWindow;
}

/**
 * `comparableHistorical()` only ever turns the *latest* matching period into
 * candidates — but a planner choosing "last 3 seasons" (V2 §16.3) needs more
 * than one season sitting in the data to choose from. These rows exist for
 * that future control, not to explain any of the current unresolved amount:
 * kept deliberately small, no BOM, and never sized against a target.
 */
/**
 * How large the older comparable season is relative to the one after it.
 * Chosen so the two seasons imply mid-single-digit growth — a believable
 * programme trend rather than a step change.
 */
const PRIOR_SEASON_FACTOR = 0.93;

const OLDER_SEASONS: readonly OlderSeason[] = [
  {
    programCode: "HAL",
    historicalPeriod: "2025-Halloween",
    historicalEvent: "Halloween 2025",
    historicalProductionWindow: { start: "2025-05-05", end: "2025-08-01" },
    historicalSalesWindow: { start: "2025-08-18", end: "2025-10-31" },
  },
  {
    programCode: "HOL",
    historicalPeriod: "2025-Holiday",
    historicalEvent: "Holiday 2025",
    historicalProductionWindow: { start: "2025-07-07", end: "2025-10-31" },
    historicalSalesWindow: { start: "2025-11-03", end: "2025-12-26" },
  },
  {
    programCode: "VAL",
    historicalPeriod: "2026-Valentine",
    historicalEvent: "Valentine 2026",
    historicalProductionWindow: { start: "2025-10-06", end: "2025-12-19" },
    historicalSalesWindow: { start: "2026-01-10", end: "2026-02-14" },
  },
];

/**
 * A second, older comparable season per programme.
 *
 * Built as a prior-year echo of the season that precedes the plan, not as a
 * fresh set of random products. That matters for more than tidiness: the
 * season-basis control joins seasons on the *business description* of a
 * product, so an older season carrying different pack sizes and a different
 * customer set would not join at all — it would read as a pile of extra SKUs
 * and imply a growth rate that is really just a change of sample.
 *
 * Carries BOMs like any other historical item. Without them, selecting this
 * season into the basis would produce items that contribute volume but explode
 * into nothing, which does not merely lose detail — it *deflates* every
 * component's coverage ratio and pushes materials toward WAIT on the strength
 * of missing data rather than real uncertainty.
 */
function generateOlderSeasonRows(
  program: Program,
  older: OlderSeason,
  latestRows: readonly RawRow[],
  specifiedItemIds: ReadonlySet<string>
): { rows: RawRow[]; boms: RawRow[] } {
  const rows: RawRow[] = [];
  const boms: RawRow[] = [];
  let seq = 1;

  for (const latest of latestRows) {
    // The unspecified renovation (no bill of materials of its own) is new this
    // season: it gets no prior-year echo, so it has no row in any earlier
    // season and is marked new wherever it appears. The sequence still
    // advances, so every other echo keeps its item id.
    if (!specifiedItemIds.has(String(latest.item_id))) {
      seq++;
      continue;
    }
    // A dedicated stream per item, so adding the older season does not shift
    // every random draw that follows and silently rewrite the seeded dataset.
    const rng = new Rng(`older::${program.code}::${String(latest.item_id)}`);
    // Roughly a year of growth below the following season, with enough jitter
    // that the trend is a real observation rather than one flat ratio.
    const factor = PRIOR_SEASON_FACTOR * rng.range(0.94, 1.06);
    const units = Math.round((latest.actual_units as number) * factor);
    if (units < 1) continue;

    const itemId = `SKU-${program.code}-P2-${String(seq).padStart(2, "0")}`;
    seq++;
    const price =
      (latest.actual_units as number) > 0
        ? (latest.actual_value as number) / (latest.actual_units as number)
        : 0;

    rows.push({
      ...latest,
      historical_period: older.historicalPeriod,
      event_or_program: older.historicalEvent,
      production_start_date: older.historicalProductionWindow.start,
      production_end_date: older.historicalProductionWindow.end,
      sales_start_date: older.historicalSalesWindow.start,
      sales_end_date: older.historicalSalesWindow.end,
      item_id: itemId,
      actual_units: units,
      actual_value: Math.round(units * price * rng.range(0.95, 1.0)),
    });
    boms.push(...bomRowsFor(rng, itemId, latest.product_family as Family));
  }

  return { rows, boms };
}


/* ------------------------------------------------------------------ */
/* Item_Line_Mapping                                                    */
/* ------------------------------------------------------------------ */

function generateItemLineMappings(itemRefs: { itemId: string; family: Family }[]): { rows: RawRow[] } {
  const rows: RawRow[] = [];

  for (const family of FAMILIES) {
    for (const alloc of FAMILY_LINE_ALLOC[family]) {
      rows.push({
        item_or_family_id: family,
        mapping_level: "PRODUCT_FAMILY",
        line_id: alloc.lineId,
        run_rate_units_per_hour: alloc.runRate,
        priority: alloc.priority,
        allocation_pct: alloc.pct,
        valid_from: "2027-01-01",
        valid_to: "2028-03-31",
        changeover_hours: 2.5,
        ...(family === "Variety Bags" && alloc.lineId === "LINE-03"
          ? { notes: "Primary high-speed bagging line" }
          : {}),
      });
    }
  }

  const basePackOverrides = [
    {
      id: "BP-VB-40",
      lineId: "LINE-03",
      runRate: 9_200,
      changeover: 2.0,
      notes: "Base pack override — 40ct runs marginally faster than the family average",
    },
    { id: "BP-GT-10", lineId: "LINE-02", runRate: 7_400, changeover: 4.0, notes: undefined },
  ] as const;
  for (const bp of basePackOverrides) {
    rows.push({
      item_or_family_id: bp.id,
      mapping_level: "BASE_PACK",
      line_id: bp.lineId,
      run_rate_units_per_hour: bp.runRate,
      priority: 1,
      allocation_pct: 1.0,
      valid_from: "2027-01-01",
      valid_to: "2028-03-31",
      changeover_hours: bp.changeover,
      ...(bp.notes ? { notes: bp.notes } : {}),
    });
  }

  const overrideLine: Record<Family, string> = {
    "Variety Bags": "LINE-04",
    "Gift Tins": "LINE-01",
    "Counter Displays": "LINE-04",
    "Molded Novelty": "LINE-01",
  };
  const overrideRate: Record<string, number> = {
    "LINE-01": 5_800,
    "LINE-02": 4_200,
    "LINE-03": 9_000,
    "LINE-04": 7_000,
  };
  // Variety Bags is deliberately excluded from this pool: it is Halloween's
  // flagship-gap family, and its formal items need to keep the PRODUCT_FAMILY
  // (or BP-VB-40 base-pack) mapping into LINE-03 undiluted. An ITEM-level
  // override routing a Halloween Variety Bags item to LINE-04 would silently
  // pull the very formal hours the LINE-03 capacity story depends on
  // (Problem 1) — an unrelated family demonstrates the same "planner
  // overrode this one item to another line" pattern just as well.
  const overrideCandidates = itemRefs.filter((ref) => ref.family !== "Variety Bags");
  for (const ref of overrideCandidates.slice(0, 3)) {
    const lineId = overrideLine[ref.family];
    const runRate = overrideRate[lineId] ?? 5_800;
    rows.push({
      item_or_family_id: ref.itemId,
      mapping_level: "ITEM",
      line_id: lineId,
      run_rate_units_per_hour: runRate,
      priority: 1,
      allocation_pct: 1.0,
      valid_from: "2027-01-01",
      valid_to: "2028-03-31",
      changeover_hours: 3.0,
      notes: "Planner override — routed to an alternate line for this specific item",
    });
  }

  return { rows };
}

/* ------------------------------------------------------------------ */
/* Line_Capacity                                                        */
/* ------------------------------------------------------------------ */

/** Never below this, however quiet the month — a line still exists. */
const MIN_LINE_HOURS = 300;
/** A calendar month has at most 31 * 24 = 744h; no line can exceed that,
 *  however much volume lands on it (V2 §20 — hours are never inflated to
 *  hit a utilisation target; the *load* is what has to fit inside them). */
const MAX_BASE_CALENDAR_HOURS = 744;

/**
 * Approved overtime in the plant-wide peak months.
 *
 * July 2027 is the one month where two programmes are in production at once —
 * Halloween is finishing while Holiday is starting — and October carries the
 * tail of Holiday alongside the start of Valentine. A real plant answers that
 * with extra shifts, so these lines get a wider (still physically possible)
 * ceiling in exactly those months. Without it the *formal* plan alone would
 * read above 100%, which says the committed plan cannot be built and makes
 * every other number on the page suspect.
 *
 * This is the same treatment Line 04 already gets; the ceiling stays inside
 * the calendar, and the load is never trimmed to flatter it.
 */
const OVERTIME_MONTHS: Record<string, { base: number; maintenance: number; project: number; labor: number; note: string }> = {
  "LINE-01::2027-07": {
    base: 744,
    maintenance: 15,
    project: 5,
    labor: 15,
    note: "Peak overlap: Halloween finishing while Holiday builds — approved additional shifts",
  },
  "LINE-02::2027-07": {
    base: 690,
    maintenance: 20,
    project: 5,
    labor: 40,
    note: "Peak overlap: Halloween finishing while Holiday builds — approved additional shifts",
  },
  "LINE-02::2027-10": {
    base: 560,
    maintenance: 25,
    project: 5,
    labor: 25,
    note: "Holiday tail overlapping Valentine build — approved additional shifts",
  },
};

function generateLineCapacity(rng: Rng, delta: number, planningNow: string): RawRow[] {
  // Cover the whole production range, and start no later than the month the
  // planner is actually in so the capacity view is never blank on open.
  const nominalStart = shiftYearIn("2027-01", delta);
  const nowMonth = planningNow.slice(0, 7);
  const months = monthRange(nowMonth < nominalStart ? nowMonth : nominalStart, shiftYearIn("2028-03", delta));
  const peakMonth = shiftYearIn("2027-06", delta);
  const overtimeMonth = shiftYearIn("2027-07", delta);
  const rows: RawRow[] = [];

  for (const line of LINES) {
    for (const period of months) {
      const isHalloweenPeakLine3 = line.id === "LINE-03" && period === peakMonth;
      const isOvertimeLine4 = line.id === "LINE-04" && (period === peakMonth || period === overtimeMonth);

      // Physically realistic calendar hours: a two/three-shift pattern that
      // varies month to month around the line's own anchor (`LINES[].baseHours`)
      // — never inflated to hit a utilisation target (V2 §20). Always inside
      // the 420-700h band, and clamped so it can never exceed a calendar
      // month's ~744h physical ceiling. The *load* that lands on a line is
      // tuned (via Item_Line_Mapping run rates and allocation splits) to fit
      // inside these hours, never the other way round.
      const jitter = rng.range(0.88, 1.05);
      let baseCalendarHours = Math.round(line.baseHours * jitter);
      baseCalendarHours = Math.min(MAX_BASE_CALENDAR_HOURS, Math.max(420, baseCalendarHours));

      let maintenance = Math.round(rng.range(20, 50));
      let project = Math.round(rng.range(0, 20));
      let labor = Math.round(rng.range(15, 35));
      const other = Math.round(rng.range(0, 8));
      let custom = 0;
      let notes: string | undefined;

      if (isHalloweenPeakLine3) {
        // The peak Halloween production month: a scheduled annual PM
        // shutdown plus reduced crewing narrows the ceiling further, right
        // where the carry-forward Variety Bags load lands hardest — the
        // golden-demo moment (V2 §28.1). Still a physically real calendar
        // month; the narrowing comes entirely from larger (but plausible)
        // deductions, never from shrinking base_calendar_hours below reality.
        baseCalendarHours = 680;
        maintenance = 150;
        project = 30;
        labor = 60;
        notes = "Annual PM shutdown week plus reduced weekend crewing ahead of Halloween peak";
      }
      const overtime = OVERTIME_MONTHS[shiftYearIn(`${line.id}::${period}`, -delta)];
      if (overtime) {
        baseCalendarHours = overtime.base;
        maintenance = overtime.maintenance;
        project = overtime.project;
        labor = overtime.labor;
        notes = overtime.note;
      }
      if (isOvertimeLine4) {
        // The flexible alternate line: approved overtime widens its ceiling
        // right when Line 03 needs an outlet, so shifting production onto
        // Line 04 stays a feasible scenario (V2 §14.4) — a bounded add-back
        // (never more than the deductions it offsets, so available hours
        // still never exceed base_calendar_hours) against a light downtime
        // month, giving this line genuine headroom.
        baseCalendarHours = 700;
        maintenance = 15;
        project = 5;
        labor = 10;
        custom = 25;
        notes = "Approved overtime block to absorb Line 03 overflow";
      }

      let availableHours = baseCalendarHours - maintenance - project - labor - other + custom;
      if (availableHours < MIN_LINE_HOURS) {
        // A real line never quite drops below this floor — give back some of
        // the (already generous) deductions rather than inflating
        // base_calendar_hours past what the calendar physically allows.
        const shortfall = MIN_LINE_HOURS - availableHours;
        maintenance = Math.max(0, maintenance - shortfall);
        availableHours = baseCalendarHours - maintenance - project - labor - other + custom;
      }
      availableHours = Math.round(availableHours);

      rows.push({
        period,
        plant: "PLT-01",
        line_id: line.id,
        line_name: line.name,
        base_calendar_hours: baseCalendarHours,
        planned_maintenance_hours: maintenance,
        project_downtime_hours: project,
        labor_constraint_hours: labor,
        other_constraint_hours: other,
        custom_adjustment_hours: custom,
        target_utilization_pct: 0.9,
        ...(notes ? { notes } : {}),
      });
    }
  }
  return rows;
}

/* ------------------------------------------------------------------ */
/* Lead_Time_History                                                    */
/* ------------------------------------------------------------------ */

function materialQuantity(rng: Rng, materialId: MaterialId): number {
  const range = MATERIAL_QTY_RANGE[materialId];
  return Math.round(rng.range(range[0], range[1]));
}

/** Median of a sample, without mutating the caller's array. */
function medianOf(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/**
 * `deliveryRng` is its own stream so that recording what each supplier promised
 * and delivered does not shift a single lead-time draw — the MAT-FILM
 * 42d-system / 67d-median story is built from `rng` and must not move.
 */
function generateLeadTimeHistory(rng: Rng, deliveryRng: Rng, planningNow: string): RawRow[] {
  const nowMs = Date.parse(planningNow);
  const rows: RawRow[] = [];
  let seq = 1;

  for (const material of MATERIALS) {
    const profile = LEAD_TIME_PROFILE[material.id];

    // The whole master-data story rests on the observed median sitting a long
    // way above the system assumption (V2 §28.3). With a sample this small a
    // free-running draw puts the median wherever it lands, so the sample is
    // re-centred on the profile's mean: the spread and shape are still drawn,
    // but the statistic the demo is *about* is constructed rather than lucky.
    const drawn = Array.from({ length: profile.count }, () =>
      normalish(rng, profile.mean, profile.sd, 10)
    );
    const shift = profile.mean - medianOf(drawn);
    const leadDaysByIndex = drawn.map((d) => Math.max(1, Math.round(d + shift)));

    for (let i = 0; i < profile.count; i++) {
      // Each receipt is from a particular supplier and carries that supplier's
      // own pace, so the ranking a planner reads is a real property of the
      // sample rather than the same number repeated.
      const supplier = pickSupplier(rng, material.id);
      const leadDays = Math.max(
        1,
        Math.round((leadDaysByIndex[i] ?? profile.mean) * supplier.leadTimeFactor)
      );
      const daysBack = rng.int(30, 730);
      const poMs = nowMs - daysBack * 86_400_000;
      const receiptMs = poMs + leadDays * 86_400_000;
      const quantity = materialQuantity(rng, material.id);

      // What the supplier confirmed at order time: their own usual pace plus a
      // little cushion — not the system assumption, which is a contract figure
      // and a different thing (V2 §18.5). A slower supplier confirms later, and
      // still misses more often, because its spread is wider.
      const promisedDays = Math.round(profile.mean * supplier.leadTimeFactor + profile.sd * 0.4);
      const promisedMs = poMs + promisedDays * 86_400_000;
      // Most receipts arrive in full; a minority are short-shipped. The slower
      // second sources short-ship a little more often.
      const shortShipChance = supplier.leadTimeFactor > 1.1 ? 0.2 : 0.1;
      const receivedQty =
        deliveryRng.float() < shortShipChance
          ? Math.round(quantity * deliveryRng.range(0.86, 0.985))
          : quantity;

      rows.push({
        material_id: material.id,
        material_name: material.name,
        po_id: `PO-${String(700_000 + seq).padStart(6, "0")}`,
        po_date: isoDate(poMs),
        receipt_date: isoDate(receiptMs),
        quantity,
        uom: material.uom,
        supplier_id: supplier.id,
        supplier_name: supplier.name,
        material_family: material.family,
        specification_family: SPEC_FAMILY[material.id],
        plant: "PLT-01",
        system_lead_time_days: profile.system,
        promised_date: isoDate(promisedMs),
        received_qty: receivedQty,
      });
      seq++;
    }
  }
  return rows;
}

/* ------------------------------------------------------------------ */
/* Inventory_Supply                                                     */
/* ------------------------------------------------------------------ */

function generateInventorySupply(rng: Rng, delta: number): RawRow[] {
  const months = ["2027-03", "2027-04", "2027-05", "2027-06", "2027-07", "2027-08"].map((m) => shiftYearIn(m, delta));
  const baseline: Record<string, { onHand: number; openPo: number; planned: number; uom: string }> = {
    "MAT-COCOA": { onHand: 120_000, openPo: 60_000, planned: 20_000, uom: "kg" },
    "MAT-SUGAR": { onHand: 95_000, openPo: 50_000, planned: 15_000, uom: "kg" },
    "MAT-MILK": { onHand: 60_000, openPo: 35_000, planned: 10_000, uom: "kg" },
    "MAT-FILM": { onHand: 40_000, openPo: 22_000, planned: 8_000, uom: "kg" },
  };
  const rows: RawRow[] = [];
  for (const materialId of Object.keys(baseline)) {
    const base = baseline[materialId];
    if (!base) continue;
    for (const period of months) {
      rows.push({
        material_id: materialId,
        plant: "PLT-01",
        period,
        on_hand_qty: Math.round(base.onHand * rng.range(0.85, 1.15)),
        open_po_qty: Math.round(base.openPo * rng.range(0.8, 1.2)),
        planned_receipt_qty: Math.round(base.planned * rng.range(0.5, 1.5)),
        uom: base.uom,
      });
    }
  }
  return rows;
}

/* ------------------------------------------------------------------ */
/* Readiness_History                                                    */
/* ------------------------------------------------------------------ */

/** Weeks-before-production-start a real export would plausibly snapshot at. */
const READINESS_CHECKPOINTS = [52, 44, 38, 32, 26, 20, 14, 8, 4, 0] as const;
const READINESS_HORIZON_WEEKS = READINESS_CHECKPOINTS[0];

/**
 * Weekly-ish snapshots of how much of a season's expected *value* was in the
 * formal plan, for the Overview readiness curve (V2 §39). Two series per
 * programme:
 *
 * - the prior season, a completed history closing to ~96-100% by its own
 *   production start — what "last year's pace" is read against.
 * - the current season up to a few weeks before today, running a seeded
 *   number of points behind last year.
 *
 * Both are anchored on the one figure the generator already knows today's
 * live number will land on: the programme's formal share of expected value
 * (`formalRatioTarget`, which Current_Plan is built to hit). That is what lets
 * this year's history meet the live "today" point without a seam, rather than
 * drawing a line that visibly disagrees with the number beside it.
 */
function generateReadinessHistory(rng: Rng, program: Program, planningNow: string): RawRow[] {
  const rows: RawRow[] = [];
  const nowMs = Date.parse(planningNow);
  const historicalProductionStartMs = Date.parse(program.historicalProductionWindow.start);
  const productionStartMs = Date.parse(program.productionWindow.start);
  const weeksBeforeNow = Math.floor((productionStartMs - nowMs) / (7 * 86_400_000));

  const finalPrior = 0.96 + rng.float() * 0.04; // last year closed 96-100% represented
  const behindBy = 0.08 + rng.float() * 0.08; // this year runs 8-16 points behind
  const today = program.formalRatioTarget;
  // Last year's position at this same point, capped so it still has room to
  // close towards its own finish.
  const priorAtToday = Math.min(finalPrior - 0.02, today + behindBy);
  const gap = Math.max(0, priorAtToday - today);

  // Completeness closes fastest near the build: g falls from 1 at the horizon
  // to 0 at production start. Anchored so last year sits at `priorAtToday` in
  // the week that corresponds to today.
  const anchorWeeks = Math.min(READINESS_HORIZON_WEEKS, Math.max(1, weeksBeforeNow));
  const g = (weeks: number) => (weeks / READINESS_HORIZON_WEEKS) ** 1.5;
  const prior = (weeks: number) =>
    Math.max(0.03, clamp01(finalPrior - (finalPrior - priorAtToday) * (g(weeks) / g(anchorWeeks))));

  for (const weeksBefore of READINESS_CHECKPOINTS) {
    const historicalPct = prior(weeksBefore);
    rows.push({
      season_period: program.historicalPeriod,
      weeks_before_production_start: weeksBefore,
      represented_pct: round4(historicalPct),
      as_of_date: isoDate(historicalProductionStartMs - weeksBefore * 7 * 86_400_000),
      notes: "",
    });

    // A snapshot from the future isn't a snapshot, and one right beside the
    // live figure adds nothing — this stops a few weeks short of today.
    if (weeksBefore <= weeksBeforeNow + 3) continue;
    rows.push({
      season_period: program.planningPeriod,
      weeks_before_production_start: weeksBefore,
      represented_pct: round4(Math.max(0.02, historicalPct - gap)),
      as_of_date: isoDate(productionStartMs - weeksBefore * 7 * 86_400_000),
      notes: "",
    });
  }

  return rows;
}

/* ------------------------------------------------------------------ */
/* Line_History                                                         */
/* ------------------------------------------------------------------ */

/**
 * How each line tends to lose and gain hours. Line 03, the constrained
 * high-speed line, breaks down most; Line 04, the flexible alternate, carries
 * the most overtime; Line 02 fills tins, so it waits on late tin and artwork
 * deliveries more than the bagging lines do.
 */
const LINE_HISTORY_PROFILE: Record<string, { downtime: number; overtime: number; lateArrivals: number }> = {
  "LINE-01": { downtime: 18, overtime: 12, lateArrivals: 2 },
  "LINE-02": { downtime: 22, overtime: 16, lateArrivals: 5 },
  "LINE-03": { downtime: 41, overtime: 20, lateArrivals: 3 },
  "LINE-04": { downtime: 16, overtime: 34, lateArrivals: 2 },
};

/** The twelve completed months before the planner's own month. */
function generateLineHistory(rng: Rng, planningNow: string): RawRow[] {
  const nowMonth = planningNow.slice(0, 7);
  const [y, m] = nowMonth.split("-").map(Number) as [number, number];
  const months: string[] = [];
  for (let back = 12; back >= 1; back--) {
    const total = y * 12 + (m - 1) - back;
    months.push(`${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`);
  }

  const rows: RawRow[] = [];
  for (const line of LINES) {
    const profile = LINE_HISTORY_PROFILE[line.id] ?? { downtime: 20, overtime: 15, lateArrivals: 2 };
    for (const period of months) {
      const scheduled = Math.round(line.baseHours * rng.range(0.84, 0.94));
      const downtime = Math.round(profile.downtime * rng.range(0.55, 1.5));
      const overtime = Math.round(profile.overtime * rng.range(0.3, 1.6));
      const lateArrivals = Math.max(0, Math.round(profile.lateArrivals * rng.range(0.2, 1.8)));
      const lateHoursLost = Math.round(lateArrivals * rng.range(1.5, 3.5));
      const run = Math.max(0, scheduled - downtime - lateHoursLost + overtime);
      rows.push({
        period,
        plant: "PLT-01",
        line_id: line.id,
        scheduled_hours: scheduled,
        run_hours: run,
        unplanned_downtime_hours: downtime,
        overtime_hours: overtime,
        late_arrivals: lateArrivals,
        late_arrival_hours_lost: lateHoursLost,
      });
    }
  }
  return rows;
}

/* ------------------------------------------------------------------ */
/* Entry points                                                         */
/* ------------------------------------------------------------------ */

export function generateDemoRawInput(options: DemoDatasetOptions = {}): RawPlanningInput {
  const seed = options.seed ?? DEFAULT_DEMO_SEED;
  // No explicit anchor means "now" — a demo should never open on a stale date.
  const planningNow = options.planningNow ?? new Date().toISOString();
  const yearDelta = demoAnchorYear(planningNow) - NATIVE_ANCHOR_YEAR;
  const rng = new Rng(seed);

  const businessPlans: RawRow[] = [];
  const currentPlanItems: RawRow[] = [];
  const historicalItems: RawRow[] = [];
  const boms: RawRow[] = [];
  const readinessHistory: RawRow[] = [];
  const itemRefs: { itemId: string; family: Family }[] = [];

  for (const nativeProgram of PROGRAMS) {
    const program = shiftProgram(nativeProgram, yearDelta);
    const out = generateProgram(rng, program);
    businessPlans.push(...out.businessPlanRows);
    currentPlanItems.push(...out.currentPlanRows);
    historicalItems.push(...out.historicalRows);
    boms.push(...out.bomRows);
    itemRefs.push(...out.itemRefs);
    readinessHistory.push(
      ...generateReadinessHistory(new Rng(`${seed}::readiness::${program.code}`), program, planningNow)
    );

    // A second, older comparable season per programme, so the season-basis
    // control has more than one season to offer. Complete with BOMs, so
    // selecting it produces a real material picture rather than a hole.
    const older = OLDER_SEASONS.find((o) => o.programCode === program.code);
    if (older) {
      const olderOut = generateOlderSeasonRows(
        program,
        shiftOlderSeason(older, yearDelta),
        out.historicalRows,
        new Set(out.bomRows.map((b) => String(b.parent_item_id)))
      );
      historicalItems.push(...olderOut.rows);
      boms.push(...olderOut.boms);
    }
  }

  // Item_Line_Mapping has to exist before hours can be projected onto it
  // (Item_Line_Mapping run rates and allocation splits are what the volume
  // has to fit inside). Line_Capacity itself is generated independently —
  // physically realistic hours, never sized off the load (V2 §20).
  const { rows: itemLineMappings } = generateItemLineMappings(itemRefs);
  // Each of these is independent of the programme loop, so each draws from its
  // own named stream. Sharing one stream made them silently sensitive to any
  // change upstream — adding a row anywhere earlier would shift every
  // capacity, lead-time and inventory figure and quietly break the designed
  // demo narratives that depend on them.
  const lineCapacity = generateLineCapacity(new Rng(`${seed}::line-capacity`), yearDelta, planningNow);

  const leadTimeHistory = generateLeadTimeHistory(
    new Rng(`${seed}::lead-time`),
    new Rng(`${seed}::deliveries`),
    planningNow
  );
  const inventorySupply = generateInventorySupply(new Rng(`${seed}::inventory`), yearDelta);
  const lineHistory = generateLineHistory(new Rng(`${seed}::line-history`), planningNow);

  return {
    metadata: {
      id: `demo-${seed}`,
      name: "Heizen Demo Dataset",
      mode: "DEMO",
      seed,
      createdAt: planningNow,
      planningNow,
      currency: "USD",
    },
    businessPlans,
    currentPlanItems,
    historicalItems,
    boms,
    lineCapacity,
    itemLineMappings,
    leadTimeHistory,
    inventorySupply,
    readinessHistory,
    lineHistory,
  };
}

export function generateDemoDataset(options: DemoDatasetOptions = {}): PlanningDataset {
  const { dataset } = normalizePlanningInput(generateDemoRawInput(options));
  return dataset;
}
