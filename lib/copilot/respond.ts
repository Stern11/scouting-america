/**
 * Deterministic intent engine for "Ask Heizen".
 *
 * Keyword matching only — no network call, no LLM, no randomness. Every
 * number in a reply is read off a `TransitionView` the pages already render,
 * or off a scenario view rebuilt from the same dataset with one lever moved.
 * When the data cannot answer (no store-level data, nothing on order, no JDA
 * plan) the reply says so rather than inventing a figure.
 *
 * What-ifs never touch the baseline: they come back as a `set_lever` action,
 * which the bar writes to the Planning Simulator's draft.
 */

import type { ScenarioAdjustments, TransitionView } from "@/types/transition";
import { buildTransition } from "@/lib/transitions/build";
import { sortForAttention } from "@/lib/transitions/portfolio";
import { fmtDateShort, fmtMoney, fmtNum, fmtNum1, fmtPct } from "@/lib/utils/format";
import type { CopilotContext, CopilotReply } from "./types";

/* ------------------------------------------------------------------ */
/* Suggestions                                                         */
/* ------------------------------------------------------------------ */

export const SUGGESTED_QUESTIONS: readonly string[] = [
  "Why are we ordering more Cub Scout shirts when we still have old inventory?",
  "Which stores will run out before the replacement shipment arrives?",
  "What happens if the new Cub Scout Shirt shipment is delayed by two weeks?",
  "Which SKU transitions have the most legacy inventory at risk?",
  "Where can we move inventory instead of ordering more?",
  "How much successor inventory could we avoid purchasing if legacy stock is interchangeable?",
  "Which transitions need my attention today?",
];

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const n = (x: number) => fmtNum(Math.round(x));
const plural = (x: number, word: string) => `${n(x)} ${word}${Math.round(x) === 1 ? "" : "s"}`;

/** Words too common across the catalogue to identify a product on their own. */
const GENERIC = new Set(["legacy", "branding", "america", "scouting", "with", "and", "the", "set", "kit"]);

const STATUS_RANK: Record<TransitionView["status"], number> = {
  ACTION_NEEDED: 0,
  MONITOR: 1,
  TRANSITIONING: 2,
  HEALTHY: 3,
  COMPLETE: 4,
};

function words(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !GENERIC.has(w));
}

/** A transition named in the question — by SKU id, transition id, or name. */
function namedTransition(question: string, transitions: readonly TransitionView[]): TransitionView | undefined {
  const q = question.toLowerCase();
  const ids: string[] = q.match(/\b[a-z]{2,3}-\d{3,4}\b/g) ?? [];
  if (ids.length > 0) {
    const byId = transitions.find(
      (t) =>
        ids.includes(t.id.toLowerCase()) ||
        [...t.lineage.predecessors, ...t.lineage.successors].some((s) => ids.includes(s.skuId.toLowerCase()))
    );
    if (byId) return byId;
  }
  const qWords = new Set(q.split(/[^a-z0-9]+/).filter(Boolean));
  const hit = (w: string) => qWords.has(w) || qWords.has(`${w}s`) || (w.endsWith("s") && qWords.has(w.slice(0, -1)));
  let best: { t: TransitionView; matched: number; ratio: number } | undefined;
  for (const t of transitions) {
    const nameWords = words(t.name);
    if (nameWords.length === 0) continue;
    const matched = nameWords.filter(hit).length;
    // A single shared word ("scout", "uniform") is not a name.
    if (matched < Math.min(2, nameWords.length)) continue;
    const ratio = matched / nameWords.length;
    if (
      !best ||
      matched > best.matched ||
      (matched === best.matched && ratio > best.ratio) ||
      (matched === best.matched && ratio === best.ratio && STATUS_RANK[t.status] < STATUS_RANK[best.t.status])
    ) {
      best = { t, matched, ratio };
    }
  }
  return best?.t;
}

function routeTransition(pathname: string, transitions: readonly TransitionView[]): TransitionView | undefined {
  const id = /\/transitions\/([^/?#]+)/.exec(pathname)?.[1] ?? /[?&]transition=([^&#]+)/.exec(pathname)?.[1];
  return id ? transitions.find((t) => t.id === decodeURIComponent(id)) : undefined;
}

/** Named → on-screen → (when the question needs one) the most urgent active transition. */
function resolve(question: string, ctx: CopilotContext, fallbackToUrgent: boolean): TransitionView | undefined {
  return (
    namedTransition(question, ctx.transitions) ??
    routeTransition(ctx.pathname, ctx.transitions) ??
    (fallbackToUrgent ? sortForAttention(ctx.transitions.filter((t) => t.status !== "COMPLETE"))[0] : undefined)
  );
}

function active(ctx: CopilotContext): TransitionView[] {
  return ctx.transitions.filter((t) => t.status !== "COMPLETE");
}

function reply(text: string, extra: Partial<CopilotReply> = {}): CopilotReply {
  return { text, action: { kind: "none" }, visualsUpdated: [], ...extra };
}

function nothingLoaded(): CopilotReply {
  return reply("No transitions are loaded yet.", { unavailable: "No planning data loaded." });
}

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, a: 1, an: 1 };

function parseWeeks(q: string): number | undefined {
  const m = /\b(\d+|one|two|three|four|five|six|a|an)\s*(?:-|\s)?(?:weeks?|wks?)\b/.exec(q);
  if (!m?.[1]) return undefined;
  const v = NUMBER_WORDS[m[1]] ?? Number(m[1]);
  return Number.isFinite(v) ? v : undefined;
}

function scenarioView(ctx: CopilotContext, id: string, adjustments: ScenarioAdjustments): TransitionView | undefined {
  if (!ctx.dataset) return undefined;
  return buildTransition(ctx.dataset, id, {
    overridesByTransition: ctx.overridesByTransition,
    scenario: { transitionId: id, adjustments },
  });
}

const simulatorHref = (id: string) => `/simulator?transition=${encodeURIComponent(id)}`;
const successorLabel = (t: TransitionView) => t.lineage.successors.map((s) => s.skuId).join(" + ") || "the successor";

/* ------------------------------------------------------------------ */
/* Intents                                                             */
/* ------------------------------------------------------------------ */

function tryNavigate(q: string, ctx: CopilotContext): CopilotReply | null {
  if (!/^(open|show|go to|take me to|navigate to|view)\b/.test(q)) return null;
  if (/\bsimulator|scenario/.test(q)) {
    const t = resolve(q, ctx, false);
    return reply(t ? `Opening ${t.name} in the Planning Simulator.` : "Opening the Planning Simulator.", {
      action: { kind: "navigate", href: t ? simulatorHref(t.id) : "/simulator" },
      visualsUpdated: ["Planning Simulator"],
    });
  }
  if (/\bactions?\b|work queue/.test(q)) {
    return reply("Opening Actions.", { action: { kind: "navigate", href: "/actions" }, visualsUpdated: ["Actions"] });
  }
  if (/\boverview|home\b/.test(q)) {
    return reply("Opening Overview.", { action: { kind: "navigate", href: "/overview" }, visualsUpdated: ["Overview"] });
  }
  const t = namedTransition(q, ctx.transitions);
  if (t) {
    return reply(`Opening ${t.name}.`, {
      action: { kind: "navigate", href: `/transitions/${encodeURIComponent(t.id)}` },
      visualsUpdated: ["SKU Transitions"],
    });
  }
  if (/\btransitions?\b/.test(q)) {
    return reply("Opening SKU Transitions.", {
      action: { kind: "navigate", href: "/transitions" },
      visualsUpdated: ["SKU Transitions"],
    });
  }
  return null;
}

function tryDelay(q: string, ctx: CopilotContext): CopilotReply | null {
  if (!/\b(delay|delayed|late|slips?|pushed|push(?:es)? out)\b/.test(q)) return null;
  if (!/\b(shipment|inbound|po|purchase order|arriv|receipt|delivery|order)/.test(q)) return null;
  const t = resolve(q, ctx, true);
  if (!t) return nothingLoaded();
  const weeks = parseWeeks(q) ?? 2;
  const next = t.inventory.receipts.find((r) => t.lineage.successors.some((s) => s.skuId === r.skuId));
  if (!next) {
    return reply(`Nothing is on order for ${successorLabel(t)}, so there is no shipment to delay.`, {
      unavailable: "No inbound supply on order for this transition.",
    });
  }
  const scenario = scenarioView(ctx, t.id, { inboundDelayWeeks: weeks });
  if (!scenario) return nothingLoaded();
  const b = t.coverage;
  const s = scenario.coverage;
  const stores = b.available
    ? `stores at risk go ${n(b.atRiskCount)} → ${n(s.atRiskCount)} (${n(s.atRiskAfterPlanCount)} still short after transfers and DC stock)`
    : "store-level impact is not available without store data";
  return reply(
    `If ${next.purchaseOrderId ?? "the next shipment"} lands ${plural(weeks, "week")} later, ${stores}. ` +
      `The recommended ${successorLabel(t)} order moves ${n(t.replenishment.finalOrderUnits)} → ${n(scenario.replenishment.finalOrderUnits)} units. ` +
      `I've set the delay in the Planning Simulator; the baseline is unchanged.`,
    {
      action: { kind: "set_lever", transitionId: t.id, key: "inboundDelayWeeks", value: weeks },
      visualsUpdated: ["Planning Simulator"],
    }
  );
}

function parsePercent(q: string): number | undefined {
  if (/\bnot (fully )?interchangeable|can'?t be used|cannot be used|none of the legacy/.test(q)) return 0;
  const m = /(\d{1,3})\s*%/.exec(q) ?? /(\d{1,3})\s*percent/.exec(q);
  if (m?.[1]) return Math.min(100, Number(m[1])) / 100;
  if (/\b(fully|completely|100)\b.*interchangeable|interchangeable/.test(q)) return 1;
  return undefined;
}

function tryAvoidPurchasing(q: string, ctx: CopilotContext): CopilotReply | null {
  if (!/\bavoid(ed)?\b.*\b(purchas|buy|order)|\b(defer|deferred)\b.*\b(purchas|buy|order)/.test(q)) return null;
  const pct = /%|percent|\bonly\b/.test(q) ? parsePercent(q) : undefined;
  const t = resolve(q, ctx, false);
  if (t && pct !== undefined) return substitutabilityWhatIf(t, pct, ctx);
  if (t) {
    const r = t.replenishment;
    if (!r.available) {
      return reply(`${t.name} has no successor to order, so there is nothing to avoid.`, {
        unavailable: "No successor replenishment for this transition.",
      });
    }
    const value = r.unitCost !== undefined ? ` (${fmtMoney(r.avoidedUnits * r.unitCost, t.currency)} at cost)` : "";
    return reply(
      `${n(r.avoidedUnits)} ${successorLabel(t)} units${value} can be deferred or avoided: ${n(r.usableLegacy)} usable legacy units at ${fmtPct(t.assumptions.substitutabilityPct)} interchangeable. ` +
        `Ordering as if legacy stock did not exist would mean ${n(r.ignoringLegacyUnits)} units; the recommendation is ${n(r.recommendedUnits)}.`
    );
  }
  const list = active(ctx).filter((v) => v.replenishment.available);
  const units = list.reduce((sum, v) => sum + v.replenishment.avoidedUnits, 0);
  let value: number | null = 0;
  for (const v of list) {
    if (v.replenishment.avoidedUnits === 0) continue;
    if (v.replenishment.unitCost === undefined) value = null;
    else if (value !== null) value += v.replenishment.avoidedUnits * v.replenishment.unitCost;
  }
  const top = [...list].sort((a, b) => b.replenishment.avoidedUnits - a.replenishment.avoidedUnits)[0];
  return reply(
    `Across ${plural(list.length, "active transition")}, ${n(units)} successor units${value !== null ? ` (${fmtMoney(value, list[0]?.currency)} at cost)` : ""} can be deferred or avoided by counting usable legacy stock. ` +
      (top && top.replenishment.avoidedUnits > 0
        ? `The most is ${top.name}: ${n(top.replenishment.avoidedUnits)} units.`
        : "No single transition stands out.")
  );
}

function substitutabilityWhatIf(t: TransitionView, pct: number, ctx: CopilotContext): CopilotReply {
  const scenario = scenarioView(ctx, t.id, { substitutabilityPct: pct });
  if (!scenario) return nothingLoaded();
  return reply(
    `At ${fmtPct(pct)} interchangeable, usable legacy for ${t.name} goes ${n(t.inventory.usableLegacy)} → ${n(scenario.inventory.usableLegacy)} units. ` +
      `The recommended order moves ${n(t.replenishment.finalOrderUnits)} → ${n(scenario.replenishment.finalOrderUnits)}, and purchasing deferred or avoided moves ${n(t.replenishment.avoidedUnits)} → ${n(scenario.replenishment.avoidedUnits)}. ` +
      `Set in the Planning Simulator; the baseline is unchanged.`,
    {
      action: { kind: "set_lever", transitionId: t.id, key: "substitutabilityPct", value: pct },
      visualsUpdated: ["Planning Simulator"],
    }
  );
}

function trySubstitutability(q: string, ctx: CopilotContext): CopilotReply | null {
  if (!/interchangeable|substitut|\busable\b|can be used/.test(q) || !/\b(if|what|suppose|assume)\b/.test(q)) return null;
  const pct = parsePercent(q);
  if (pct === undefined) return null;
  const t = resolve(q, ctx, true);
  if (!t) return nothingLoaded();
  if (t.lineage.predecessors.length === 0) {
    return reply(`${t.name} has no legacy SKU, so substitutability does not apply.`, {
      unavailable: "No legacy inventory for this transition.",
    });
  }
  return substitutabilityWhatIf(t, pct, ctx);
}

function tryWhyOrdering(q: string, ctx: CopilotContext): CopilotReply | null {
  if (!/\bwhy\b.*\b(order|buy|purchas|replenish)/.test(q) && !/\b(order|ordering|buy)\b.*\b(old|legacy|existing) (inventory|stock)/.test(q))
    return null;
  const t = resolve(q, ctx, true);
  if (!t) return nothingLoaded();
  const r = t.replenishment;
  if (!r.available) {
    return reply(`${t.name} has no successor to order — the plan is to sell through ${n(t.inventory.legacyOnHand)} legacy units.`, {
      unavailable: "No successor replenishment for this transition.",
    });
  }
  const jda =
    r.jda?.plannedOrderUnits !== undefined
      ? ` JDA plans ${n(r.jda.plannedOrderUnits)}, treating ${successorLabel(t)} as a new SKU.`
      : "";
  const verdict =
    r.finalOrderUnits > 0
      ? `so the recommendation is ${n(r.finalOrderUnits)} units — not the ${n(r.ignoringLegacyUnits)} an order ignoring legacy stock would need.`
      : `so no order is needed today — ignoring legacy stock would have called for ${n(r.ignoringLegacyUnits)}.`;
  return reply(
    `${t.name} needs ${n(r.requirement)} units over ${r.horizonWeeks} weeks (continuity demand plus ${fmtNum1(r.safetyStockWeeks)} weeks' safety stock). ` +
      `${n(r.usableLegacy)} usable legacy, ${n(r.successorOnHand)} successor on hand and ${n(r.eligibleInbound)} inbound cover most of it, ${verdict}` +
      jda
  );
}

function tryStoresRunOut(q: string, ctx: CopilotContext): CopilotReply | null {
  if (!/\b(run out|runs out|stock ?outs?|out of stock|short)\b/.test(q) || !/\bstores?\b|\bwhere\b|\bwhich\b/.test(q)) return null;
  const named = namedTransition(q, ctx.transitions) ?? routeTransition(ctx.pathname, ctx.transitions);
  if (!named && /\b(all|across|network|portfolio|every)\b/.test(q)) return portfolioStockouts(ctx);
  const t = named ?? resolve(q, ctx, true);
  if (!t) return nothingLoaded();
  const c = t.coverage;
  if (!c.available) {
    return reply(`Store-level coverage isn't available for ${t.name}. ${c.unavailableReason ?? ""}`.trim(), {
      unavailable: c.unavailableReason ?? "No store-level data.",
    });
  }
  if (c.atRiskCount === 0) {
    return reply(`No ${t.name} store runs out before its next shipment can reach it.`);
  }
  const next = t.inventory.receipts.find((r) => t.lineage.successors.some((s) => s.skuId === r.skuId));
  const worst = c.rows
    .filter((r) => r.atRisk)
    .slice(0, 3)
    .map((r) => `${r.store.storeName} (${fmtNum1(r.weeksOfCover ?? 0)} wks)`)
    .join(", ");
  const shipment = next
    ? `before the ${fmtDateShort(next.expectedDate)} ${successorLabel(t)} shipment${next.purchaseOrderId ? ` (${next.purchaseOrderId})` : ""} can reach them`
    : `before any new ${successorLabel(t)} stock could arrive — nothing is on order`;
  const covered = c.atRiskCount - c.atRiskAfterPlanCount;
  return reply(
    `${plural(c.atRiskCount, "store")} run out ${shipment}${c.earliestStockout ? `; the first on ${fmtDateShort(c.earliestStockout)}` : ""}. ` +
      `Lowest cover: ${worst}. ` +
      `Transfers and DC stock cover ${n(covered)}; ${n(c.atRiskAfterPlanCount)} remain short.`,
    {
      action: { kind: "navigate", href: `/transitions/${encodeURIComponent(t.id)}` },
      visualsUpdated: ["Store coverage"],
    }
  );
}

function portfolioStockouts(ctx: CopilotContext): CopilotReply {
  const list = active(ctx).filter((t) => t.coverage.atRiskCount > 0).sort((a, b) => b.coverage.atRiskCount - a.coverage.atRiskCount);
  if (list.length === 0) return reply("No store runs out before its next shipment in any active transition.");
  const total = list.reduce((sum, t) => sum + t.coverage.atRiskCount, 0);
  return reply(
    `${n(total)} store stockouts are projected across ${plural(list.length, "transition")}. ` +
      `Most: ${list.slice(0, 3).map((t) => `${t.name} (${n(t.coverage.atRiskCount)})`).join(", ")}.`
  );
}

function tryLegacyAtRisk(q: string, ctx: CopilotContext): CopilotReply | null {
  if (!/legacy/.test(q) || !/\b(at risk|stranded|left over|leftover|remain|most|excess)\b/.test(q)) return null;
  const list = active(ctx)
    .filter((t) => t.sellThrough.remainingUnits > 0)
    .sort(
      (a, b) =>
        (b.sellThrough.remainingValue ?? b.sellThrough.remainingUnits) - (a.sellThrough.remainingValue ?? a.sellThrough.remainingUnits)
    );
  if (list.length === 0) return reply("No transition is projected to leave legacy stock behind at today's sell rates.");
  const describe = (t: TransitionView) =>
    `${t.name} ${n(t.sellThrough.remainingUnits)} units${t.sellThrough.remainingValue !== undefined ? ` (${fmtMoney(t.sellThrough.remainingValue, t.currency)})` : ""}`;
  return reply(
    `${plural(list.length, "transition")} are projected to leave legacy stock unsold when their sell-through window closes. ` +
      `Most at risk: ${list.slice(0, 3).map(describe).join("; ")}.`,
    { action: { kind: "navigate", href: "/transitions" }, visualsUpdated: ["SKU Transitions"] }
  );
}

function tryMoveInventory(q: string, ctx: CopilotContext): CopilotReply | null {
  if (!/\b(move|transfer|rebalanc|redistribut|shift)\w*\b/.test(q) || /\bdelay/.test(q)) return null;
  const named = namedTransition(q, ctx.transitions);
  const list = (named ? [named] : active(ctx))
    .filter((t) => t.coverage.transfers.length > 0)
    .sort((a, b) => b.coverage.transferUnits - a.coverage.transferUnits);
  if (list.length === 0) {
    return reply(
      named ? `No ${named.name} store has stock to spare for a store that is running out.` : "No store-to-store transfer would prevent a stockout right now."
    );
  }
  const top = list[0]!;
  const move = top.coverage.transfers[0];
  const storeName = (id: string) => top.coverage.rows.find((r) => r.store.storeId === id)?.store.storeName ?? id;
  const total = list.reduce((sum, t) => sum + t.coverage.transferUnits, 0);
  return reply(
    `${n(total)} units can move between stores across ${plural(list.length, "transition")} before buying more — ${list
      .slice(0, 3)
      .map((t) => `${t.name} ${n(t.coverage.transferUnits)}`)
      .join(", ")}. ` +
      (move
        ? `For example, ${plural(move.units, "unit")} of ${move.skuId} from ${storeName(move.fromStoreId)} (${fmtNum1(move.fromCoverBefore)} wks) to ${storeName(move.toStoreId)} (${fmtNum1(move.toCoverBefore)} wks).`
        : ""),
    { action: { kind: "navigate", href: `/transitions/${encodeURIComponent(top.id)}` }, visualsUpdated: ["Store coverage"] }
  );
}

function tryAttention(q: string, ctx: CopilotContext): CopilotReply | null {
  if (!/\b(attention|today|urgent|priorit\w*|first|what should i do|need(s)? me|need my)\b/.test(q)) return null;
  const list = sortForAttention(ctx.transitions.filter((t) => t.status === "ACTION_NEEDED"));
  if (list.length === 0) {
    return reply("No transition needs action today. Every active transition has enough coverage for current demand and inbound supply.", {
      action: { kind: "navigate", href: "/actions" },
      visualsUpdated: ["Actions"],
    });
  }
  return reply(
    `${plural(list.length, "transition")} need action today. ` +
      `First: ${list
        .slice(0, 3)
        .map((t) => `${t.name} — ${t.nextStep}`)
        .join("; ")}.`,
    { action: { kind: "navigate", href: "/actions" }, visualsUpdated: ["Actions"] }
  );
}

function fallback(): CopilotReply {
  return reply(
    `I can answer from the transition data — try "${SUGGESTED_QUESTIONS[1]}", "${SUGGESTED_QUESTIONS[2]}" or "${SUGGESTED_QUESTIONS[6]}"`,
    { unavailable: "Question not recognised." }
  );
}

/* ------------------------------------------------------------------ */

export function respond(question: string, ctx: CopilotContext): CopilotReply {
  const q = question.trim().toLowerCase();
  if (!q) return fallback();
  if (ctx.transitions.length === 0) return nothingLoaded();
  return (
    tryNavigate(q, ctx) ??
    tryDelay(q, ctx) ??
    tryAvoidPurchasing(q, ctx) ??
    trySubstitutability(q, ctx) ??
    tryWhyOrdering(q, ctx) ??
    tryStoresRunOut(q, ctx) ??
    tryLegacyAtRisk(q, ctx) ??
    tryMoveInventory(q, ctx) ??
    tryAttention(q, ctx) ??
    fallback()
  );
}
