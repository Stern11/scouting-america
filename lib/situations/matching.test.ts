import { describe, it, expect } from "vitest";
import {
  assignRepresentation,
  buildCandidates,
  compareToCurrentItem,
  DEFAULT_MATCH_CONFIG,
  explainMatch,
  matchToCurrentPlan,
  proposeDisposition,
} from "./matching";
import type { CurrentPlanRow, HistoricalItemRow } from "@/types/dataset";
import type { MatchResult } from "@/types/situation";

function historical(overrides: Partial<HistoricalItemRow> = {}): HistoricalItemRow {
  return {
    id: "hi_1",
    historicalPeriod: "2026-Halloween",
    itemId: "item_a",
    itemName: "Ridgeline Variety Bag",
    brand: "Ridgeline",
    productFamily: "Variety Bags",
    actualUnits: 1000,
    eventOrProgram: "Halloween",
    customer: "Walmart",
    channel: "Mass",
    ...overrides,
  };
}

function current(overrides: Partial<CurrentPlanRow> = {}): CurrentPlanRow {
  return {
    id: "cp_1",
    planningPeriod: "2027-Halloween",
    itemId: "item_b",
    itemName: "Ridgeline Variety Bag 2027",
    brand: "Ridgeline",
    productFamily: "Variety Bags",
    plannedUnits: 900,
    eventOrProgram: "Halloween",
    customer: "Walmart",
    channel: "Mass",
    ...overrides,
  };
}

describe("compareToCurrentItem", () => {
  it("scores 1 when every comparable dimension agrees", () => {
    const result = compareToCurrentItem(historical(), current());
    expect(result.score).toBe(1);
    expect(result.comparedDimensions).toBe(5);
    expect(result.outcomes.every((o) => o.status === "same")).toBe(true);
  });

  it("reflects the weighted miss when brand differs", () => {
    const result = compareToCurrentItem(historical(), current({ brand: "Otherbrand" }));
    // brand weight=3 is the only miss out of total weight 3+3+1+2+1=10.
    const totalWeight = DEFAULT_MATCH_CONFIG.dimensions.reduce((s, d) => s + d.weight, 0);
    const expected = (totalWeight - 3) / totalWeight;
    expect(result.score).toBeCloseTo(expected, 10);
    const brandOutcome = result.outcomes.find((o) => o.dimension === "brand");
    expect(brandOutcome?.status).toBe("different");
  });

  it("excludes a dimension blank on one side from both numerator and denominator", () => {
    const withBlankChannel = compareToCurrentItem(historical({ channel: undefined }), current());
    // channel weight=1 excluded from denominator too, so the other 4 dims (all
    // matching) still score 1 — not penalized for the missing attribute.
    expect(withBlankChannel.score).toBe(1);
    expect(withBlankChannel.comparedDimensions).toBe(4);
  });

  it("does not score a partially-blank row lower than the same row blank on both sides", () => {
    // One side blank (channel undefined on historical only) vs both sides blank.
    const oneSideBlank = compareToCurrentItem(historical({ channel: undefined }), current());
    const bothSidesBlank = compareToCurrentItem(
      historical({ channel: undefined }),
      current({ channel: undefined })
    );
    expect(oneSideBlank.score).toBe(bothSidesBlank.score);
  });

  it("short-circuits to score 1 when item_id matches, even with differing attributes", () => {
    const result = compareToCurrentItem(
      historical({ itemId: "same_item", brand: "BrandA", customer: "CustA" }),
      current({ itemId: "same_item", brand: "BrandB", customer: "CustB" })
    );
    expect(result.score).toBe(1);
  });
});

describe("matchToCurrentPlan", () => {
  const itemMatch = current({ itemId: "item_x", brand: "Ridgeline", customer: "Walmart" });
  const itemPartial = current({
    id: "cp_2",
    itemId: "item_y",
    brand: "OtherBrand",
    customer: "Walmart",
  });

  it("picks the current item with the highest score", () => {
    const result = matchToCurrentPlan(historical(), [itemPartial, itemMatch]);
    expect(result.matchedItemId).toBe("item_x");
  });

  it("breaks ties toward the item with more compared dimensions", () => {
    // Two current items that both score 1.0 (every comparable dimension
    // agrees), but "partial" is missing the event attribute entirely, so it
    // has fewer comparable dimensions than "full". Same score, different
    // comparedDimensions -> full must win the tie-break.
    const partial = current({ id: "cp_partial", itemId: "item_partial", eventOrProgram: undefined });
    const full = current({ id: "cp_full", itemId: "item_full" });
    const result = matchToCurrentPlan(historical(), [partial, full]);
    expect(result.matchedItemId).toBe("item_full");
    expect(result.score).toBe(1);
    expect(result.comparedDimensions).toBe(5);
  });

  it("drops the matched item pointer below threshold but keeps outcomes", () => {
    const poorMatch = current({ itemId: "item_poor", brand: "Nope", customer: "Nobody", channel: "Club" });
    const result = matchToCurrentPlan(historical(), [poorMatch]);
    expect(result.score).toBeLessThan(DEFAULT_MATCH_CONFIG.threshold);
    expect(result.matchedItemId).toBeUndefined();
    expect(result.matchedItemName).toBeUndefined();
    expect(result.outcomes.length).toBeGreaterThan(0);
  });

  it("returns a zero-score empty result when there are no current items", () => {
    const result = matchToCurrentPlan(historical(), []);
    expect(result.score).toBe(0);
    expect(result.comparedDimensions).toBe(0);
    expect(result.outcomes).toEqual([]);
  });
});

describe("proposeDisposition", () => {
  // Current contract (post one-to-one assignment): the signal is whether the
  // item was *assigned* a current-plan successor (matchedItemId present), not
  // how high it scored in isolation — an unassigned item can still score high
  // if it lost the assignment to a better-evidenced competitor for the same
  // current item.
  it("proposes intentional_exit for an exit-ish status regardless of match", () => {
    const match: MatchResult = { score: 1, comparedDimensions: 5, outcomes: [], matchedItemId: "x" };
    expect(proposeDisposition(historical({ status: "Discontinued" }), match)).toBe("intentional_exit");
  });

  it("proposes already_represented whenever the item carries an assigned matchedItemId", () => {
    const match: MatchResult = {
      score: DEFAULT_MATCH_CONFIG.threshold,
      comparedDimensions: 5,
      outcomes: [],
      matchedItemId: "x",
    };
    expect(proposeDisposition(historical(), match)).toBe("already_represented");
  });

  it("proposes under_review when unassigned but the score is at or above threshold (boundary inclusive)", () => {
    const match: MatchResult = {
      score: DEFAULT_MATCH_CONFIG.threshold,
      comparedDimensions: 3,
      outcomes: [],
      matchedItemId: undefined,
    };
    expect(proposeDisposition(historical(), match)).toBe("under_review");
  });

  it("proposes under_review when unassigned but the score is well above threshold", () => {
    const match: MatchResult = { score: 0.95, comparedDimensions: 5, outcomes: [], matchedItemId: undefined };
    expect(proposeDisposition(historical(), match)).toBe("under_review");
  });

  it("proposes carry_forward for a clearly unmatched item", () => {
    const match: MatchResult = { score: 0.1, comparedDimensions: 3, outcomes: [] };
    expect(proposeDisposition(historical(), match)).toBe("carry_forward");
  });

  it("proposes carry_forward just below threshold when unassigned", () => {
    const match: MatchResult = {
      score: DEFAULT_MATCH_CONFIG.threshold - 0.001,
      comparedDimensions: 3,
      outcomes: [],
    };
    expect(proposeDisposition(historical(), match)).toBe("carry_forward");
  });
});

describe("explainMatch", () => {
  it("names matched and differing dimensions in a readable string", () => {
    const match = compareToCurrentItem(historical(), current({ brand: "OtherBrand", channel: "Club" }));
    const text = explainMatch(match);
    expect(text).toContain("match");
    expect(text).toContain("differ");
    expect(text).toMatch(/Brand/);
    expect(text).toMatch(/Channel/);
  });

  it("reports no comparable attributes when nothing could be compared", () => {
    const empty: MatchResult = { score: 0, comparedDimensions: 0, outcomes: [] };
    expect(explainMatch(empty)).toBe("No comparable attributes");
  });
});

describe("buildCandidates", () => {
  const historicalRows: HistoricalItemRow[] = [
    historical({ id: "hi_low", itemId: "item_low", actualUnits: 100, actualValue: 500 }),
    historical({ id: "hi_high", itemId: "item_high", actualUnits: 1000, actualValue: 9000 }),
    historical({ id: "hi_noprice", itemId: "item_np", actualUnits: 200, actualValue: undefined }),
  ];
  const currentRows: CurrentPlanRow[] = [current()];

  it("applies a planner override from the dispositions map over the proposed one", () => {
    const candidates = buildCandidates(historicalRows, currentRows, { hi_low: "intentional_exit" });
    const overridden = candidates.find((c) => c.id === "hi_low")!;
    expect(overridden.disposition).toBe("intentional_exit");
    // The proposed disposition (what matching alone would have said) is preserved.
    expect(overridden.proposedDisposition).not.toBe("intentional_exit");
  });

  it("sorts candidates by actualValue descending", () => {
    const candidates = buildCandidates(historicalRows, currentRows, {}, DEFAULT_MATCH_CONFIG, 10);
    const values = candidates.map((c) => c.actualValue);
    expect(values).toEqual([...values].sort((a, b) => b - a));
    // hi_high (9000) should come before hi_low (500).
    expect(candidates[0]!.id).toBe("hi_high");
  });

  it("falls back to actualUnits * pricePerUnit when actualValue is absent", () => {
    const candidates = buildCandidates(historicalRows, currentRows, {}, DEFAULT_MATCH_CONFIG, 3);
    const noPrice = candidates.find((c) => c.id === "hi_noprice")!;
    expect(noPrice.actualValue).toBe(200 * 3);
  });
});

describe("assignRepresentation — one-to-one assignment", () => {
  // Three historical rows with identical attributes all score 1.0 against the
  // single current item. Only one may be assigned to it; the others must lose
  // the assignment even though they scored perfectly, or the platform would
  // let unrelated prior items all claim to be "already represented" by the
  // same formal item.
  const tiedRows: HistoricalItemRow[] = [
    historical({ id: "hi_low", itemId: "item_low" }),
    historical({ id: "hi_high", itemId: "item_high" }),
    historical({ id: "hi_noprice", itemId: "item_np" }),
  ];
  const oneCurrentItem: CurrentPlanRow[] = [current()];

  it("assigns exactly one of several equally-well-matched rows to the shared current item", () => {
    const assignments = assignRepresentation(tiedRows, oneCurrentItem);
    const assigned = [...assignments.entries()].filter(([, result]) => result.matchedItemId !== undefined);
    expect(assigned.length).toBe(1);
    // Tie-break on score and comparedDimensions is exhausted (all equal), so
    // the final tie-break is ascending historicalId: "hi_high" sorts first.
    expect(assigned[0]![0]).toBe("hi_high");
  });

  it("keeps the unassigned rows' outcomes but strips their matchedItemId", () => {
    const assignments = assignRepresentation(tiedRows, oneCurrentItem);
    const loser = assignments.get("hi_low")!;
    expect(loser.matchedItemId).toBeUndefined();
    expect(loser.score).toBe(1); // still reports the score it would have had
    expect(loser.outcomes.length).toBeGreaterThan(0);
  });

  it("flows through buildCandidates: the assignment winner is already_represented, the losers are under_review", () => {
    const candidates = buildCandidates(tiedRows, oneCurrentItem, {});
    const byId = new Map(candidates.map((c) => [c.id, c]));
    expect(byId.get("hi_high")!.proposedDisposition).toBe("already_represented");
    expect(byId.get("hi_low")!.proposedDisposition).toBe("under_review");
    expect(byId.get("hi_noprice")!.proposedDisposition).toBe("under_review");
  });
});

describe("assignRepresentation — the assignment is solved, not picked greedily", () => {
  // H1 fits A exactly and B nearly; H2 fits only A. Taking the single best
  // pair (H1 -> A) first strands H2, which would then surface as a gap that
  // does not exist. Pairing H1 -> B and H2 -> A represents both.
  const h1 = historical({ id: "h1", itemId: "p1", customer: "Walmart", channel: "Mass" });
  const h2 = historical({ id: "h2", itemId: "p2", customer: "Target", channel: "Mass" });
  const a = current({ id: "cA", itemId: "A", customer: "Walmart", channel: "Mass" });
  const b = current({ id: "cB", itemId: "B", customer: "Walmart", channel: "Club" });

  it("sets up the scores the greedy choice gets wrong", () => {
    expect(compareToCurrentItem(h1, a).score).toBeCloseTo(1, 6);
    expect(compareToCurrentItem(h1, b).score).toBeCloseTo(0.9, 6);
    expect(compareToCurrentItem(h2, a).score).toBeCloseTo(0.8, 6);
    expect(compareToCurrentItem(h2, b).score).toBeCloseTo(0.7, 6);
  });

  it("represents both prior items when a greedy pick would strand one", () => {
    const assignments = assignRepresentation([h1, h2], [a, b]);
    expect(assignments.get("h1")!.matchedItemId).toBe("B");
    expect(assignments.get("h2")!.matchedItemId).toBe("A");
  });

  it("does not depend on the order rows arrive in", () => {
    const assignments = assignRepresentation([h2, h1], [b, a]);
    expect(assignments.get("h1")!.matchedItemId).toBe("B");
    expect(assignments.get("h2")!.matchedItemId).toBe("A");
  });

  it("prefers the higher total score when both assignments represent everything", () => {
    const clubRow = historical({ id: "h3", itemId: "p3", customer: "Walmart", channel: "Club" });
    const assignments = assignRepresentation([h1, clubRow], [a, b]);
    expect(assignments.get("h1")!.matchedItemId).toBe("A");
    expect(assignments.get("h3")!.matchedItemId).toBe("B");
  });

  it("still lets a carried-over item id win outright", () => {
    // H1 is literally item A carried into the new plan. H2 could only ever be
    // represented by A, but an identical id is evidence, not inference.
    const carried = historical({ id: "h1", itemId: "A", customer: "Walmart", channel: "Mass" });
    const candidates = buildCandidates([carried, h2], [a], {});
    const byId = new Map(candidates.map((c) => [c.id, c]));
    expect(byId.get("h1")!.match.matchedItemId).toBe("A");
    expect(byId.get("h2")!.match.matchedItemId).toBeUndefined();
    expect(byId.get("h2")!.proposedDisposition).toBe("under_review");
  });
});
