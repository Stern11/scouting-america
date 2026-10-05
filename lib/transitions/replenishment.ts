/**
 * How much successor to actually order, once legacy stock is counted.
 *
 *   expected demand over the horizon
 * + safety stock (weeks × weekly demand)
 * = requirement
 * − usable legacy inventory
 * − successor inventory on hand
 * − inbound supply arriving inside the horizon
 * = recommended successor replenishment   (never below zero)
 *
 * The horizon is the vendor lead time plus one review cycle: an order placed
 * today has to carry the business until the next order can land.
 *
 * The same requirement with legacy stock left out is what an item-level plan
 * that treats the successor as a fresh SKU would order. The difference is
 * reported as purchasing *deferred or avoided* — not as savings: some of it
 * is only bought later, and some is never needed.
 */

import type { Replenishment, WeeklyProjectionPoint } from "@/types/transition";
import { addDaysTo } from "./time";

export interface ReplenishmentInput {
  available: boolean;
  planningNow: string;
  horizonWeeks: number;
  leadTimeWeeks: number | null;
  horizonDemand: number;
  weeklyDemand: number;
  safetyStockWeeks: number;
  usableLegacy: number;
  successorOnHand: number;
  eligibleInbound: number;
  /** Usable units arriving, by week from now. */
  receipts: readonly { weeksAway: number; usableUnits: number; eligible: boolean }[];
  orderOverrideUnits?: number;
  /** No successor: nothing is ever ordered. */
  noSuccessor: boolean;
  jda?: Replenishment["jda"];
  unitCost?: number;
}

export function calculateReplenishmentRequirement(input: ReplenishmentInput): Replenishment {
  const safetyStockUnits = Math.round(input.weeklyDemand * input.safetyStockWeeks);
  const requirement = Math.round(input.horizonDemand) + safetyStockUnits;
  const supply = input.usableLegacy + input.successorOnHand + input.eligibleInbound;
  const successorSupply = input.successorOnHand + input.eligibleInbound;

  const recommendedUnits = input.noSuccessor ? 0 : Math.max(0, requirement - supply);
  const ignoringLegacyUnits = input.noSuccessor ? 0 : Math.max(0, requirement - successorSupply);
  const avoidedUnits = Math.max(0, ignoringLegacyUnits - recommendedUnits);
  const finalOrderUnits = input.noSuccessor ? 0 : (input.orderOverrideUnits ?? recommendedUnits);
  const excessUnits = Math.max(0, supply + finalOrderUnits - requirement);

  const projection = projectWeekly(input);
  const breach = projection.find((p) => p.usableUnits - p.demand + p.receipts < safetyStockUnits);
  const neededByDate = breach ? breach.date : null;
  const orderByDate =
    neededByDate && input.leadTimeWeeks !== null ? addDaysTo(neededByDate, -input.leadTimeWeeks * 7) : null;

  return {
    available: input.available,
    horizonWeeks: input.horizonWeeks,
    leadTimeWeeks: input.leadTimeWeeks,
    horizonDemand: Math.round(input.horizonDemand),
    safetyStockWeeks: input.safetyStockWeeks,
    safetyStockUnits,
    requirement,
    usableLegacy: input.usableLegacy,
    successorOnHand: input.successorOnHand,
    eligibleInbound: input.eligibleInbound,
    recommendedUnits,
    ignoringLegacyUnits,
    avoidedUnits,
    orderOverrideUnits: input.orderOverrideUnits,
    finalOrderUnits,
    excessUnits,
    neededByDate,
    orderByDate,
    projection,
    jda: input.jda,
    unitCost: input.unitCost,
  };
}

/**
 * Week-by-week usable stock with no new order placed: what is on hand, less
 * flat weekly demand, plus each receipt in the week it lands.
 */
function projectWeekly(input: ReplenishmentInput): WeeklyProjectionPoint[] {
  const points: WeeklyProjectionPoint[] = [];
  let usable = input.usableLegacy + input.successorOnHand;
  for (let week = 0; week < input.horizonWeeks; week++) {
    const receipts = input.receipts
      .filter((r) => r.eligible && Math.floor(r.weeksAway) === week)
      .reduce((n, r) => n + r.usableUnits, 0);
    points.push({
      week,
      date: addDaysTo(input.planningNow, week * 7),
      usableUnits: Math.max(0, Math.round(usable)),
      receipts,
      demand: Math.round(input.weeklyDemand),
    });
    usable = Math.max(0, usable + receipts - input.weeklyDemand);
  }
  return points;
}
