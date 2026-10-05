import { describe, expect, it } from "vitest";
import { DEMO_PLANNING_NOW, generateDemoDataset } from "@/lib/dataset/demo/generate";
import { buildTransition, buildTransitions } from "@/lib/transitions/build";
import { fmtNum } from "@/lib/utils/format";
import { respond, SUGGESTED_QUESTIONS } from "./respond";
import type { CopilotContext } from "./types";

const dataset = generateDemoDataset({ planningNow: DEMO_PLANNING_NOW });
const transitions = buildTransitions(dataset);
const ctx = (pathname = "/overview"): CopilotContext => ({
  transitions,
  dataset,
  overridesByTransition: {},
  pathname,
  storeCount: dataset.stores.length,
});
const shirt = transitions.find((t) => t.name === "Cub Scout Shirt")!;

describe("Ask Heizen", () => {
  it("resolves the flagship by product name and explains the order against legacy stock", () => {
    const reply = respond(SUGGESTED_QUESTIONS[0]!, ctx());
    const r = shirt.replenishment;
    expect(reply.text).toContain("Cub Scout Shirt");
    expect(reply.text).toContain(fmtNum(r.requirement));
    expect(reply.text).toContain(fmtNum(r.usableLegacy));
    expect(reply.text).toContain(fmtNum(r.ignoringLegacyUnits));
    if (r.jda?.plannedOrderUnits !== undefined) expect(reply.text).toContain(fmtNum(r.jda.plannedOrderUnits));
  });

  it("resolves a transition by SKU id", () => {
    const reply = respond("Why are we ordering CS-2841 when we have old inventory?", ctx());
    expect(reply.text).toContain("Cub Scout Shirt");
  });

  it("lists stores that run out before the shipment, from the on-screen transition", () => {
    const reply = respond(SUGGESTED_QUESTIONS[1]!, ctx(`/transitions/${shirt.id}`));
    expect(reply.text).toContain(`${fmtNum(shirt.coverage.atRiskCount)} store`);
    const firstAtRisk = shirt.coverage.rows.find((r) => r.atRisk)!;
    expect(reply.text).toContain(firstAtRisk.store.storeName);
    expect(reply.action).toEqual({ kind: "navigate", href: `/transitions/${shirt.id}` });
  });

  it("answers a delay what-if as a simulator lever and never mutates the dataset", () => {
    const before = JSON.stringify(dataset);
    const reply = respond(SUGGESTED_QUESTIONS[2]!, ctx());
    expect(reply.action).toEqual({ kind: "set_lever", transitionId: shirt.id, key: "inboundDelayWeeks", value: 2 });
    const scenario = buildTransition(dataset, shirt.id, {
      scenario: { transitionId: shirt.id, adjustments: { inboundDelayWeeks: 2 } },
    })!;
    expect(reply.text).toContain(`${fmtNum(shirt.coverage.atRiskCount)} → ${fmtNum(scenario.coverage.atRiskCount)}`);
    expect(reply.text).toContain(`${fmtNum(shirt.replenishment.finalOrderUnits)} → ${fmtNum(scenario.replenishment.finalOrderUnits)}`);
    expect(JSON.stringify(dataset)).toBe(before);
  });

  it("parses digit weeks in a delay", () => {
    const reply = respond("What if the Cub Scout Shirt shipment slips 3 weeks?", ctx());
    expect(reply.action).toMatchObject({ kind: "set_lever", key: "inboundDelayWeeks", value: 3 });
  });

  it("answers a substitutability what-if as a simulator lever", () => {
    const reply = respond("What if only 60% of legacy Cub Scout Shirt stock is usable?", ctx());
    expect(reply.action).toEqual({ kind: "set_lever", transitionId: shirt.id, key: "substitutabilityPct", value: 0.6 });
    expect(reply.text).toContain(fmtNum(shirt.inventory.usableLegacy));
  });

  it("ranks legacy inventory at risk", () => {
    const reply = respond(SUGGESTED_QUESTIONS[3]!, ctx());
    const top = transitions
      .filter((t) => t.status !== "COMPLETE" && t.sellThrough.remainingUnits > 0)
      .sort((a, b) => (b.sellThrough.remainingValue ?? 0) - (a.sellThrough.remainingValue ?? 0))[0]!;
    expect(reply.text).toContain(top.name);
    expect(reply.text).toContain(fmtNum(top.sellThrough.remainingUnits));
  });

  it("finds transfers instead of purchases", () => {
    const reply = respond(SUGGESTED_QUESTIONS[4]!, ctx());
    const total = transitions
      .filter((t) => t.status !== "COMPLETE")
      .reduce((n, t) => n + t.coverage.transferUnits, 0);
    expect(reply.text).toContain(fmtNum(total));
  });

  it("reports purchasing deferred or avoided — never savings", () => {
    const reply = respond(SUGGESTED_QUESTIONS[5]!, ctx());
    expect(reply.text).toMatch(/deferred or avoided/);
    expect(reply.text.toLowerCase()).not.toContain("saving");
    const one = respond("How much CS-2841 could we avoid purchasing?", ctx());
    expect(one.text).toContain(fmtNum(shirt.replenishment.avoidedUnits));
  });

  it("lists what needs attention today", () => {
    const reply = respond(SUGGESTED_QUESTIONS[6]!, ctx());
    const count = transitions.filter((t) => t.status === "ACTION_NEEDED").length;
    expect(reply.text).toContain(`${count} transition`);
    expect(reply.action).toEqual({ kind: "navigate", href: "/actions" });
  });

  it("navigates", () => {
    expect(respond("open the cub scout uniform shirt", ctx()).action).toEqual({
      kind: "navigate",
      href: `/transitions/${shirt.id}`,
    });
    expect(respond("open simulator", ctx()).action).toEqual({ kind: "navigate", href: "/simulator" });
    expect(respond("go to actions", ctx()).action).toEqual({ kind: "navigate", href: "/actions" });
  });

  it("falls back gracefully on an unknown question", () => {
    const reply = respond("what's the weather in Irving?", ctx());
    expect(reply.action).toEqual({ kind: "none" });
    expect(reply.unavailable).toBeDefined();
    expect(reply.text).toContain("try");
  });

  it("says when nothing is loaded", () => {
    const reply = respond(SUGGESTED_QUESTIONS[1]!, { ...ctx(), transitions: [] });
    expect(reply.unavailable).toBeDefined();
  });

  it("every suggested question gets a real answer", () => {
    for (const q of SUGGESTED_QUESTIONS) {
      expect(respond(q, ctx()).unavailable, q).toBeUndefined();
    }
  });
});
