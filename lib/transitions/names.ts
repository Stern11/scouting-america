/**
 * Words a Scout Shop planner uses for a product, instead of SKU codes.
 *
 * "Move 125 old-logo shirts" reads faster than "Transfer 125 units of
 * CS-1048". SKU codes stay available wherever the detail is shown; the
 * headline language is about the product.
 */

import type { SkuRow, TransitionReason } from "@/types/dataset";

/** The noun of a product name: "Cub Scout Shirt" → "shirt", plural on request. */
export function productNoun(name: string, count = 2): string {
  const words = name
    .replace(/\(.*?\)/g, "")
    .replace(/[—–-].*$/, "")
    .trim()
    .split(/\s+/)
    .filter((w) => !/^\d/.test(w));
  const last = (words[words.length - 1] ?? "item").toLowerCase();
  if (count === 1) return last.endsWith("socks") || last === "pants" ? last : last.replace(/s$/, "");
  return pluralize(last);
}

function pluralize(word: string): string {
  if (/(s|pants)$/.test(word)) return word;
  if (/(ch|sh|x)$/.test(word)) return `${word}es`;
  if (/[^aeiou]y$/.test(word)) return `${word.slice(0, -1)}ies`;
  return `${word}s`;
}

/**
 * How the two sides of a transition are named in plain words. A rebrand —
 * by reason, or because the new SKU carries the new brand and the old one
 * doesn't — reads "Old logo → Scouting America".
 */
export function versionLabels(
  reason: TransitionReason | undefined,
  successors: readonly Pick<SkuRow, "brand">[] = [],
  predecessors: readonly Pick<SkuRow, "brand">[] = []
): { old: string; new: string; oldAdjective: string } {
  const newBrand = successors[0]?.brand;
  const rebranded =
    reason === "REBRAND" ||
    (newBrand !== undefined && /scouting america/i.test(newBrand) && predecessors.every((p) => p.brand !== newBrand));
  if (rebranded) return { old: "Old logo", new: "Scouting America", oldAdjective: "old-logo" };
  return { old: "Old version", new: "New version", oldAdjective: "older" };
}
