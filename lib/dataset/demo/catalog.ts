/**
 * Synthetic merchandise catalog and store network for the demo.
 *
 * Product names follow Scouting America's program vocabulary so the demo
 * reads like the problem it is about — but every SKU code, quantity, cost,
 * store and sale is synthetic. None of it is Scouting America's data.
 */

export type SeasonProfile = "uniform" | "insignia" | "derby" | "camping" | "apparel" | "literature";

/** Monthly demand shape, January first. Normalised where used. */
export const SEASONALITY: Record<SeasonProfile, readonly number[]> = {
  // Join season (Aug–Oct) dominates; a second bump at crossover in Feb.
  uniform: [1.0, 1.05, 0.85, 0.7, 0.6, 0.55, 0.75, 1.45, 1.75, 1.35, 1.0, 0.9],
  // Courts of honor and blue & gold run through the school year.
  insignia: [1.1, 1.25, 1.05, 0.95, 0.85, 0.7, 0.75, 1.0, 1.2, 1.1, 1.0, 1.05],
  // Pinewood derby season.
  derby: [2.2, 1.8, 0.8, 0.5, 0.4, 0.3, 0.3, 0.4, 0.6, 0.9, 1.6, 2.0],
  // Summer camp.
  camping: [0.6, 0.7, 1.0, 1.3, 1.6, 1.8, 1.5, 0.9, 0.8, 0.8, 0.7, 0.6],
  // Gift season.
  apparel: [0.9, 0.8, 0.8, 0.9, 1.0, 0.9, 0.9, 1.0, 1.1, 1.0, 1.3, 1.45],
  literature: [0.9, 0.9, 0.8, 0.75, 0.7, 0.65, 0.8, 1.4, 1.6, 1.2, 0.95, 0.9],
};

export interface CatalogItem {
  name: string;
  family: string;
  category: string;
  program: string;
  season: SeasonProfile;
  /** Annual units across the network, at current run rate. */
  annual: [number, number];
  cost: [number, number];
  sizeRange?: string;
  color?: string;
}

const CUB_RANKS = ["Lion", "Tiger", "Wolf", "Bear", "Webelos", "Arrow of Light"];
const SCOUTS_RANKS = ["Scout", "Tenderfoot", "Second Class", "First Class", "Star", "Life", "Eagle"];

/**
 * The procedural part of the portfolio. Showcase transitions are written out
 * by hand in `generate.ts`; these fill out the ~150-transition picture.
 */
export function proceduralCatalog(): CatalogItem[] {
  const items: CatalogItem[] = [];
  for (const rank of CUB_RANKS) {
    if (rank === "Wolf") continue; // Wolf neckerchief is a showcase transition
    items.push({ name: `${rank} Neckerchief`, family: "Cub Scout Neckwear", category: "Uniform Accessories", program: "Cub Scouts", season: "uniform", annual: [2600, 5200], cost: [3.1, 4.2], color: "Rank color" });
  }
  for (const rank of CUB_RANKS) {
    items.push({ name: `${rank} Neckerchief Slide`, family: "Cub Scout Neckwear", category: "Uniform Accessories", program: "Cub Scouts", season: "uniform", annual: [2200, 4800], cost: [1.6, 2.4] });
  }
  for (const rank of CUB_RANKS) {
    items.push({ name: `${rank} Handbook`, family: "Cub Scout Handbooks", category: "Literature", program: "Cub Scouts", season: "literature", annual: [3000, 6500], cost: [7.5, 9.8] });
  }
  for (const rank of ["Lion", "Tiger", "Wolf", "Bear"]) {
    items.push({ name: `${rank} Cap`, family: "Cub Scout Headwear", category: "Uniforms", program: "Cub Scouts", season: "uniform", annual: [1400, 3200], cost: [6.2, 7.8], sizeRange: "Youth S/M–L/XL" });
  }
  for (const rank of SCOUTS_RANKS) {
    items.push({ name: `${rank} Rank Patch`, family: "Rank Insignia", category: "Patches", program: "Scouts BSA", season: "insignia", annual: [1800, 7200], cost: [0.9, 1.4] });
  }
  const other: CatalogItem[] = [
    { name: "World Crest Emblem", family: "Uniform Insignia", category: "Patches", program: "All programs", season: "insignia", annual: [9000, 14000], cost: [0.7, 1.0] },
    { name: "Council Shoulder Patch Blank", family: "Uniform Insignia", category: "Patches", program: "All programs", season: "insignia", annual: [5000, 9000], cost: [0.8, 1.2] },
    { name: "Unit Numeral Set", family: "Uniform Insignia", category: "Patches", program: "All programs", season: "insignia", annual: [6000, 11000], cost: [1.1, 1.6] },
    { name: "Trained Strip", family: "Leader Insignia", category: "Patches", program: "Adult Leaders", season: "insignia", annual: [2500, 4800], cost: [0.6, 0.9] },
    { name: "Den Chief Patch", family: "Leadership Insignia", category: "Patches", program: "Scouts BSA", season: "insignia", annual: [900, 1800], cost: [0.9, 1.2] },
    { name: "Patrol Leader Patch", family: "Leadership Insignia", category: "Patches", program: "Scouts BSA", season: "insignia", annual: [1600, 2800], cost: [0.9, 1.2] },
    { name: "Senior Patrol Leader Patch", family: "Leadership Insignia", category: "Patches", program: "Scouts BSA", season: "insignia", annual: [700, 1300], cost: [0.9, 1.2] },
    { name: "Merit Badge Sash", family: "Award Displays", category: "Uniform Accessories", program: "Scouts BSA", season: "insignia", annual: [2400, 4200], cost: [5.4, 6.8], sizeRange: "Youth–Adult" },
    { name: "Square Knot Emblem", family: "Leader Insignia", category: "Patches", program: "Adult Leaders", season: "insignia", annual: [3000, 5600], cost: [0.8, 1.1] },
    { name: "Interpreter Strip", family: "Uniform Insignia", category: "Patches", program: "All programs", season: "insignia", annual: [500, 1100], cost: [0.7, 1.0] },
    { name: "Scouts BSA Uniform Shirt (Long Sleeve)", family: "Scouts BSA Uniform", category: "Uniforms", program: "Scouts BSA", season: "uniform", annual: [5200, 8600], cost: [18.5, 22.0], sizeRange: "Youth S–Adult 2XL", color: "Tan" },
    { name: "Scouts BSA Uniform Shorts", family: "Scouts BSA Uniform", category: "Uniforms", program: "Scouts BSA", season: "uniform", annual: [2600, 4400], cost: [12.4, 14.8], sizeRange: "Youth S–Adult 2XL", color: "Olive" },
    { name: "Venturing Uniform Shirt", family: "Venturing Uniform", category: "Uniforms", program: "Venturing", season: "uniform", annual: [900, 1800], cost: [19.0, 22.5], sizeRange: "Adult S–2XL", color: "Green" },
    { name: "Sea Scout Uniform Shirt", family: "Sea Scout Uniform", category: "Uniforms", program: "Sea Scouts", season: "uniform", annual: [400, 900], cost: [20.0, 23.5], sizeRange: "Adult S–2XL", color: "White" },
    { name: "Activity Uniform Shirt", family: "Activity Uniform", category: "Uniforms", program: "All programs", season: "uniform", annual: [3800, 6400], cost: [6.8, 8.4], sizeRange: "Youth S–Adult 3XL" },
    { name: "Cub Scout Belt", family: "Cub Scout Uniform", category: "Uniforms", program: "Cub Scouts", season: "uniform", annual: [3400, 5600], cost: [5.2, 6.4], sizeRange: "Youth 22–32" },
    { name: "Scouts BSA Web Belt", family: "Scouts BSA Uniform", category: "Uniforms", program: "Scouts BSA", season: "uniform", annual: [2600, 4600], cost: [6.0, 7.2], sizeRange: "Youth–Adult" },
    { name: "Pinewood Derby Car Kit", family: "Derby Kits", category: "Program Kits", program: "Cub Scouts", season: "derby", annual: [16000, 24000], cost: [2.6, 3.4] },
    { name: "Pinewood Derby Wheel Set", family: "Derby Kits", category: "Program Kits", program: "Cub Scouts", season: "derby", annual: [5200, 8800], cost: [1.8, 2.4] },
    { name: "Pinewood Derby Tungsten Weights", family: "Derby Kits", category: "Program Kits", program: "Cub Scouts", season: "derby", annual: [4200, 7200], cost: [3.6, 4.8] },
    { name: "Raingutter Regatta Kit", family: "Derby Kits", category: "Program Kits", program: "Cub Scouts", season: "camping", annual: [3000, 5200], cost: [2.4, 3.2] },
    { name: "Space Derby Kit", family: "Derby Kits", category: "Program Kits", program: "Cub Scouts", season: "derby", annual: [1200, 2400], cost: [3.0, 3.8] },
    { name: "Scouts BSA Handbook", family: "Scouts BSA Handbooks", category: "Literature", program: "Scouts BSA", season: "literature", annual: [7000, 11000], cost: [9.2, 11.4] },
    { name: "Merit Badge Pamphlet — Camping", family: "Merit Badge Pamphlets", category: "Literature", program: "Scouts BSA", season: "literature", annual: [1400, 2600], cost: [2.6, 3.2] },
    { name: "Merit Badge Pamphlet — First Aid", family: "Merit Badge Pamphlets", category: "Literature", program: "Scouts BSA", season: "literature", annual: [1500, 2700], cost: [2.6, 3.2] },
    { name: "Fieldbook", family: "Scouts BSA Handbooks", category: "Literature", program: "Scouts BSA", season: "literature", annual: [900, 1600], cost: [10.5, 12.5] },
    { name: "Mess Kit", family: "Camp Kitchen", category: "Camping", program: "All programs", season: "camping", annual: [2600, 4200], cost: [7.4, 9.0] },
    { name: "Field Water Bottle", family: "Hydration", category: "Camping", program: "All programs", season: "camping", annual: [4200, 7400], cost: [3.8, 4.8] },
    { name: "Daypack 24L", family: "Packs", category: "Camping", program: "All programs", season: "camping", annual: [1600, 2800], cost: [14.0, 17.5] },
    { name: "Sleeping Bag 30°F", family: "Sleep Systems", category: "Camping", program: "All programs", season: "camping", annual: [900, 1600], cost: [26.0, 31.0] },
    { name: "Camp Chair", family: "Camp Furniture", category: "Camping", program: "All programs", season: "camping", annual: [1200, 2200], cost: [11.0, 13.5] },
    { name: "Headlamp", family: "Lighting", category: "Camping", program: "All programs", season: "camping", annual: [3400, 5600], cost: [6.4, 7.8] },
    { name: "Rain Poncho", family: "Rain Gear", category: "Camping", program: "All programs", season: "camping", annual: [2200, 3800], cost: [3.4, 4.2] },
    { name: "Trail First Aid Kit", family: "Safety", category: "Camping", program: "All programs", season: "camping", annual: [2400, 4000], cost: [8.2, 9.6] },
    { name: "Baseplate Compass", family: "Navigation", category: "Camping", program: "All programs", season: "camping", annual: [2600, 4400], cost: [5.6, 6.8] },
    { name: "Whittling Chip Pocketknife", family: "Knives", category: "Camping", program: "Cub Scouts", season: "camping", annual: [2000, 3600], cost: [9.8, 11.8] },
    { name: "Fire Starter", family: "Camp Kitchen", category: "Camping", program: "All programs", season: "camping", annual: [1800, 3000], cost: [3.2, 3.9] },
    { name: "Logo T-Shirt", family: "Logo Apparel", category: "Non-uniform Apparel", program: "All programs", season: "apparel", annual: [5000, 9000], cost: [5.2, 6.6], sizeRange: "Youth S–Adult 3XL" },
    { name: "Logo Hoodie", family: "Logo Apparel", category: "Non-uniform Apparel", program: "All programs", season: "apparel", annual: [2000, 3600], cost: [14.5, 17.0], sizeRange: "Youth S–Adult 3XL" },
    { name: "Fleece Jacket", family: "Outerwear", category: "Non-uniform Apparel", program: "All programs", season: "apparel", annual: [1100, 2000], cost: [19.5, 23.0], sizeRange: "Adult S–3XL" },
    { name: "Logo Ball Cap", family: "Logo Headwear", category: "Non-uniform Apparel", program: "All programs", season: "apparel", annual: [2400, 4200], cost: [5.8, 7.0] },
    { name: "Knit Beanie", family: "Logo Headwear", category: "Non-uniform Apparel", program: "All programs", season: "apparel", annual: [1400, 2600], cost: [4.6, 5.6] },
    { name: "Sticker Pack", family: "Gifts & Novelty", category: "Gifts", program: "All programs", season: "apparel", annual: [3000, 5000], cost: [1.0, 1.4] },
    { name: "Lanyard", family: "Gifts & Novelty", category: "Gifts", program: "All programs", season: "apparel", annual: [2000, 3600], cost: [1.2, 1.6] },
    { name: "Keychain", family: "Gifts & Novelty", category: "Gifts", program: "All programs", season: "apparel", annual: [2400, 4000], cost: [1.1, 1.5] },
    { name: "Canvas Tote", family: "Gifts & Novelty", category: "Gifts", program: "All programs", season: "apparel", annual: [1200, 2200], cost: [3.6, 4.4] },
    { name: "Award Pin Set", family: "Awards", category: "Awards", program: "All programs", season: "insignia", annual: [2200, 4000], cost: [2.0, 2.6] },
    { name: "Den Flag", family: "Unit Equipment", category: "Unit Supplies", program: "Cub Scouts", season: "uniform", annual: [800, 1500], cost: [8.4, 10.2] },
    { name: "Troop Flag", family: "Unit Equipment", category: "Unit Supplies", program: "Scouts BSA", season: "uniform", annual: [500, 1000], cost: [22.0, 26.0] },
    { name: "Uniform Insignia Kit", family: "Uniform Insignia", category: "Patches", program: "Cub Scouts", season: "uniform", annual: [3200, 5600], cost: [3.4, 4.2] },
    { name: "Cub Scout Activity Shirt", family: "Activity Uniform", category: "Uniforms", program: "Cub Scouts", season: "uniform", annual: [2800, 4600], cost: [6.2, 7.6], sizeRange: "Youth XS–XL" },
    { name: "Webelos Colors", family: "Cub Scout Insignia", category: "Uniform Accessories", program: "Cub Scouts", season: "uniform", annual: [1600, 2800], cost: [2.2, 2.8] },
    { name: "Belt Loop Set", family: "Cub Scout Awards", category: "Awards", program: "Cub Scouts", season: "insignia", annual: [3600, 6000], cost: [0.9, 1.2] },
    { name: "Adventure Pin Set", family: "Cub Scout Awards", category: "Awards", program: "Cub Scouts", season: "insignia", annual: [3200, 5400], cost: [1.0, 1.4] },
    { name: "Eagle Scout Medal", family: "Awards", category: "Awards", program: "Scouts BSA", season: "insignia", annual: [1600, 2400], cost: [6.0, 7.4] },
    { name: "Eagle Scout Certificate Folder", family: "Awards", category: "Awards", program: "Scouts BSA", season: "insignia", annual: [1400, 2200], cost: [3.4, 4.0] },
    { name: "Leader Uniform Shirt", family: "Leader Uniform", category: "Uniforms", program: "Adult Leaders", season: "uniform", annual: [2400, 4000], cost: [19.5, 23.0], sizeRange: "Adult S–4XL", color: "Tan" },
    { name: "Leader Uniform Pants", family: "Leader Uniform", category: "Uniforms", program: "Adult Leaders", season: "uniform", annual: [1400, 2400], cost: [16.5, 19.5], sizeRange: "Adult 28–50", color: "Olive" },
    { name: "Hiking Socks", family: "Footwear Accessories", category: "Camping", program: "All programs", season: "camping", annual: [3000, 5200], cost: [3.6, 4.4], sizeRange: "Youth M–Adult XL" },
  ];
  items.push(...other);
  return items;
}

/* ------------------------------------------------------------------ */
/* Store network                                                       */
/* ------------------------------------------------------------------ */

export interface StoreSeed {
  city: string;
  state: string;
  region: string;
  count: number;
}

/** 120 stores. Several cities run more than one shop. */
export const STORE_CITIES: readonly StoreSeed[] = [
  { city: "Dallas", state: "TX", region: "South Central", count: 4 },
  { city: "Irving", state: "TX", region: "South Central", count: 2 },
  { city: "Fort Worth", state: "TX", region: "South Central", count: 2 },
  { city: "Houston", state: "TX", region: "South Central", count: 5 },
  { city: "Austin", state: "TX", region: "South Central", count: 3 },
  { city: "San Antonio", state: "TX", region: "South Central", count: 3 },
  { city: "Oklahoma City", state: "OK", region: "South Central", count: 2 },
  { city: "Tulsa", state: "OK", region: "South Central", count: 1 },
  { city: "Little Rock", state: "AR", region: "South Central", count: 1 },
  { city: "New Orleans", state: "LA", region: "South Central", count: 1 },
  { city: "Baton Rouge", state: "LA", region: "South Central", count: 1 },
  { city: "Charlotte", state: "NC", region: "Southeast", count: 5 },
  { city: "Raleigh", state: "NC", region: "Southeast", count: 2 },
  { city: "Greensboro", state: "NC", region: "Southeast", count: 1 },
  { city: "Columbia", state: "SC", region: "Southeast", count: 1 },
  { city: "Greenville", state: "SC", region: "Southeast", count: 1 },
  { city: "Atlanta", state: "GA", region: "Southeast", count: 5 },
  { city: "Savannah", state: "GA", region: "Southeast", count: 1 },
  { city: "Orlando", state: "FL", region: "Southeast", count: 2 },
  { city: "Tampa", state: "FL", region: "Southeast", count: 2 },
  { city: "Jacksonville", state: "FL", region: "Southeast", count: 2 },
  { city: "Miami", state: "FL", region: "Southeast", count: 1 },
  { city: "Nashville", state: "TN", region: "Southeast", count: 2 },
  { city: "Knoxville", state: "TN", region: "Southeast", count: 1 },
  { city: "Memphis", state: "TN", region: "Southeast", count: 1 },
  { city: "Birmingham", state: "AL", region: "Southeast", count: 1 },
  { city: "Richmond", state: "VA", region: "Northeast", count: 2 },
  { city: "Virginia Beach", state: "VA", region: "Northeast", count: 1 },
  { city: "Baltimore", state: "MD", region: "Northeast", count: 1 },
  { city: "Philadelphia", state: "PA", region: "Northeast", count: 2 },
  { city: "Pittsburgh", state: "PA", region: "Northeast", count: 2 },
  { city: "Newark", state: "NJ", region: "Northeast", count: 1 },
  { city: "Albany", state: "NY", region: "Northeast", count: 1 },
  { city: "Rochester", state: "NY", region: "Northeast", count: 1 },
  { city: "Boston", state: "MA", region: "Northeast", count: 2 },
  { city: "Hartford", state: "CT", region: "Northeast", count: 1 },
  { city: "Manchester", state: "NH", region: "Northeast", count: 1 },
  { city: "Chicago", state: "IL", region: "Central", count: 5 },
  { city: "Indianapolis", state: "IN", region: "Central", count: 2 },
  { city: "Columbus", state: "OH", region: "Central", count: 2 },
  { city: "Cincinnati", state: "OH", region: "Central", count: 2 },
  { city: "Cleveland", state: "OH", region: "Central", count: 1 },
  { city: "Detroit", state: "MI", region: "Central", count: 2 },
  { city: "Grand Rapids", state: "MI", region: "Central", count: 1 },
  { city: "Milwaukee", state: "WI", region: "Central", count: 1 },
  { city: "Minneapolis", state: "MN", region: "Central", count: 2 },
  { city: "St. Louis", state: "MO", region: "Central", count: 2 },
  { city: "Kansas City", state: "MO", region: "Central", count: 2 },
  { city: "Omaha", state: "NE", region: "Central", count: 1 },
  { city: "Des Moines", state: "IA", region: "Central", count: 1 },
  { city: "Louisville", state: "KY", region: "Central", count: 1 },
  { city: "Denver", state: "CO", region: "Western", count: 3 },
  { city: "Colorado Springs", state: "CO", region: "Western", count: 1 },
  { city: "Salt Lake City", state: "UT", region: "Western", count: 3 },
  { city: "Phoenix", state: "AZ", region: "Western", count: 4 },
  { city: "Tucson", state: "AZ", region: "Western", count: 1 },
  { city: "Albuquerque", state: "NM", region: "Western", count: 1 },
  { city: "Las Vegas", state: "NV", region: "Western", count: 1 },
  { city: "Boise", state: "ID", region: "Western", count: 1 },
  { city: "Los Angeles", state: "CA", region: "Western", count: 3 },
  { city: "San Diego", state: "CA", region: "Western", count: 2 },
  { city: "Sacramento", state: "CA", region: "Western", count: 1 },
  { city: "San Jose", state: "CA", region: "Western", count: 1 },
  { city: "Portland", state: "OR", region: "Western", count: 2 },
  { city: "Seattle", state: "WA", region: "Western", count: 2 },
  { city: "Spokane", state: "WA", region: "Western", count: 1 },
];
