"use client";

/**
 * Planner decisions on one transition, each written with an audit note.
 *
 * The system recommends; the planner controls. Every override lands in the
 * dataset store's log with who made it and when, so the transition's history
 * reads like a planning record rather than a settings page.
 */

import { useCallback } from "react";
import { useDatasetStore } from "@/stores/dataset-store";
import { useCurrentUser } from "@/components/layout/use-current-user";
import type { ActionDisposition, TransitionOverrides } from "@/types/transition";

export function useDecisions(transitionId: string) {
  const { user } = useCurrentUser();
  const actor = user?.name.split(/\s+/)[0] ?? "Planner";
  const setOverride = useDatasetStore((s) => s.setOverride);
  const clearOverrides = useDatasetStore((s) => s.clearOverrides);
  const setActionState = useDatasetStore((s) => s.setActionState);
  const reopenAction = useDatasetStore((s) => s.reopenAction);

  const note = useCallback((text: string) => ({ actor, text, at: new Date().toISOString() }), [actor]);

  return {
    actor,
    override: useCallback(
      (patch: TransitionOverrides, text: string) => setOverride(transitionId, patch, note(text)),
      [setOverride, transitionId, note]
    ),
    clear: useCallback(
      (keys: (keyof TransitionOverrides)[], text: string) => clearOverrides(transitionId, keys, note(text)),
      [clearOverrides, transitionId, note]
    ),
    act: useCallback(
      (actionId: string, disposition: ActionDisposition, text: string) =>
        setActionState(actionId, transitionId, { disposition, at: new Date().toISOString() }, note(text)),
      [setActionState, transitionId, note]
    ),
    reopen: useCallback(
      (actionId: string, text: string) => reopenAction(actionId, transitionId, note(text)),
      [reopenAction, transitionId, note]
    ),
  };
}
