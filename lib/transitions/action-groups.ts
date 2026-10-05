/**
 * The work queue sorted by what the planner is actually doing — keeping
 * shops stocked, buying the right amount, or tidying up — and urgency in
 * plain words rather than priority codes.
 */

import type { ActionPriority, PlannerAction } from "@/types/transition";

export type ActionGroup = "stock" | "buy" | "tidy";

export const ACTION_GROUPS: { key: ActionGroup; title: string; blurb: string }[] = [
  { key: "stock", title: "Keep shops stocked", blurb: "Move stock, send from the DC, speed up deliveries" },
  { key: "buy", title: "Buy the right amount", blurb: "Orders, holds and forecast fixes" },
  { key: "tidy", title: "Confirm & tidy up", blurb: "Matches, sell-throughs and close-outs" },
];

export function actionGroup(action: PlannerAction): ActionGroup {
  switch (action.type) {
    case "TRANSFER_INVENTORY":
    case "ACCELERATE_INBOUND":
    case "INVESTIGATE_STORE_RISK":
      return "stock";
    case "REPLENISH_SUCCESSOR":
      // A DC-to-shop send keeps shops stocked; a vendor order is buying.
      return action.id.endsWith(":replenish-dc") ? "stock" : "buy";
    case "HOLD_REPLENISHMENT":
    case "UPDATE_DEMAND_ASSUMPTION":
      return "buy";
    default:
      return "tidy";
  }
}

export const URGENCY_LABEL: Record<ActionPriority, string> = {
  CRITICAL: "Urgent",
  HIGH: "This week",
  MEDIUM: "This cycle",
  MONITOR: "When ready",
};

/** What each kind of action is called, for filters and labels. */
export const ACTION_TYPE_LABEL: Record<PlannerAction["type"], string> = {
  CONFIRM_SUCCESSOR: "Confirm successor",
  REPLENISH_SUCCESSOR: "Replenish",
  HOLD_REPLENISHMENT: "Hold replenishment",
  TRANSFER_INVENTORY: "Transfer inventory",
  ACCELERATE_INBOUND: "Expedite inbound",
  REVIEW_TRANSITION: "Legacy sell-through",
  MARK_LEGACY_DEPLETION: "Close out legacy",
  UPDATE_DEMAND_ASSUMPTION: "Update forecast",
  INVESTIGATE_STORE_RISK: "Investigate stores",
};
