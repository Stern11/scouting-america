/**
 * Planning Simulator state: lever values only — never a derived number.
 *
 * Each transition has a live draft (what the sliders show) and the planner can
 * save named scenarios. Both hold adjustments, nothing else; the scenario
 * result is rebuilt from (dataset + overrides + levers) every time, so a
 * scenario can never drift from the baseline it is compared against, and the
 * baseline is never touched.
 */

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { ScenarioAdjustments } from "@/types/transition";
import { scopedWebStorage } from "./persist-storage";

export const SCENARIO_STORAGE_KEY = "heizen.scenarios";

export interface SavedScenario {
  id: string;
  transitionId: string;
  name: string;
  adjustments: ScenarioAdjustments;
  createdAt: string;
}

export type LeverKey = keyof ScenarioAdjustments;

export interface ScenarioState {
  /** Live levers per transition. */
  drafts: Record<string, ScenarioAdjustments>;
  saved: Record<string, SavedScenario>;
  hasHydrated: boolean;
  setHasHydrated: (value: boolean) => void;

  setLever: (transitionId: string, key: LeverKey, value: number | undefined) => void;
  setDraft: (transitionId: string, adjustments: ScenarioAdjustments) => void;
  resetDraft: (transitionId: string) => void;
  saveScenario: (transitionId: string, name: string, now: string) => string;
  deleteScenario: (id: string) => void;
}

let seq = 0;

export const useScenarioStore = create<ScenarioState>()(
  persist(
    (set, get) => ({
      drafts: {},
      saved: {},
      hasHydrated: false,
      setHasHydrated: (value) => set({ hasHydrated: value }),

      setLever: (transitionId, key, value) =>
        set((state) => {
          const draft = { ...state.drafts[transitionId] };
          if (value === undefined) delete draft[key];
          else draft[key] = value;
          return { drafts: { ...state.drafts, [transitionId]: draft } };
        }),

      setDraft: (transitionId, adjustments) =>
        set((state) => ({ drafts: { ...state.drafts, [transitionId]: { ...adjustments } } })),

      resetDraft: (transitionId) =>
        set((state) => {
          const drafts = { ...state.drafts };
          delete drafts[transitionId];
          return { drafts };
        }),

      saveScenario: (transitionId, name, now) => {
        seq += 1;
        const id = `scn-${now}-${seq}`;
        const adjustments = { ...get().drafts[transitionId] };
        set((state) => ({
          saved: { ...state.saved, [id]: { id, transitionId, name, adjustments, createdAt: now } },
        }));
        return id;
      },

      deleteScenario: (id) =>
        set((state) => {
          const saved = { ...state.saved };
          delete saved[id];
          return { saved };
        }),
    }),
    {
      name: SCENARIO_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => scopedWebStorage("local")),
      skipHydration: true,
      partialize: (state) => ({ drafts: state.drafts, saved: state.saved }),
      onRehydrateStorage: () => (state) => state?.setHasHydrated(true),
    }
  )
);
