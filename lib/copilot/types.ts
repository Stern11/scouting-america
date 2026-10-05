/**
 * Types for "Ask Heizen" — the deterministic copilot.
 *
 * Grounded in `TransitionView`, the object `lib/transitions/build.ts` builds
 * for every screen. A reply is composed only from fields already on a view
 * (or on a scenario view rebuilt from the same dataset), so it can never
 * contradict what the pages show.
 *
 * Pure types only — see `respond.ts` for the engine.
 */

import type { PlanningDataset } from "@/types/dataset";
import type { ScenarioAdjustments, TransitionOverrides, TransitionView } from "@/types/transition";

export interface CopilotContext {
  transitions: readonly TransitionView[];
  /** Needed to rebuild a what-if; the dataset is never mutated. */
  dataset: PlanningDataset | null;
  overridesByTransition: Readonly<Record<string, TransitionOverrides>>;
  /** Route the planner is on — "/transitions/TR-1001", "/simulator?transition=…". */
  pathname: string;
  storeCount: number;
}

/**
 * What the bar does after replying. `set_lever` writes to the simulator's
 * draft (scenario state) and opens the simulator — never the baseline.
 */
export type CopilotAction =
  | { kind: "navigate"; href: string }
  | { kind: "set_lever"; transitionId: string; key: keyof ScenarioAdjustments; value: number }
  | { kind: "none" };

export interface CopilotReply {
  /** At most three short sentences. */
  text: string;
  action: CopilotAction;
  /** Short labels for what changed on screen, e.g. ["Planning Simulator"]. */
  visualsUpdated: string[];
  /** Set when the request was understood but cannot be answered from the data. */
  unavailable?: string;
}
