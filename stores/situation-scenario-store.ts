/**
 * Scenario state for the V2 workflow.
 *
 * Stores overrides only — never a derived number. The scenario result is
 * recomputed by applying these adjustments to a copy of the dataset and
 * re-running `buildSituations`, so baseline and scenario can never drift and
 * the uploaded workbook is never touched (V2 §53).
 */

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { ScenarioAdjustmentCategory, ScenarioAdjustments, SituationScenario } from "@/types/situation";
import { EMPTY_ADJUSTMENTS } from "@/types/situation";
import { analogueKey, capacityKey, mappingKey, sameAdjustments } from "@/lib/situations/scenario";
import { scopedWebStorage } from "./persist-storage";

export const SITUATION_SCENARIO_STORAGE_KEY = "heizen.situation-scenarios";

/**
 * A scenario with a draft. `adjustments` is what the lab shows and edits;
 * `savedAdjustments` is the last saved snapshot. Both are overrides only.
 */
export interface DraftSituationScenario extends SituationScenario {
  savedAdjustments: ScenarioAdjustments;
}

/** The draft differs from what was last saved. */
export function isScenarioDirty(scenario: DraftSituationScenario | undefined): boolean {
  return scenario !== undefined && !sameAdjustments(scenario.adjustments, scenario.savedAdjustments);
}

export interface SituationScenarioState {
  scenarios: Record<string, DraftSituationScenario>;
  activeScenarioId: string | null;
  /** Which numbers the workspace shows. Scenario state is always explicit. */
  viewMode: "baseline" | "scenario";
  hasHydrated: boolean;
  setHasHydrated: (value: boolean) => void;

  createScenario: (situationId: string, name: string, now: string) => string;
  duplicateScenario: (scenarioId: string, now: string) => string | null;
  renameScenario: (scenarioId: string, name: string) => void;
  deleteScenario: (scenarioId: string) => void;
  setActiveScenario: (scenarioId: string | null) => void;
  setViewMode: (mode: "baseline" | "scenario") => void;
  setNote: (scenarioId: string, note: string) => void;
  /** Makes the current draft the saved snapshot. */
  saveScenario: (scenarioId: string) => void;
  /** Throws the draft away and restores the saved snapshot. */
  discardChanges: (scenarioId: string) => void;

  setAvailableHours: (scenarioId: string, lineId: string, period: string, hours: number) => void;
  setTargetUtilization: (scenarioId: string, lineId: string, pct: number) => void;
  setRunRate: (scenarioId: string, itemOrFamilyId: string, lineId: string, rate: number) => void;
  setAllocation: (scenarioId: string, itemOrFamilyId: string, lineId: string, share: number) => void;
  setLeadTime: (scenarioId: string, materialId: string, days: number) => void;
  setVolumeUnits: (scenarioId: string, candidateId: string, units: number) => void;
  setAnalogueWeight: (
    scenarioId: string,
    candidateId: string,
    analogueId: string,
    weight: number
  ) => void;

  clearAdjustment: (scenarioId: string, category: ScenarioAdjustmentCategory, key: string) => void;
  resetCategory: (scenarioId: string, category: ScenarioAdjustmentCategory) => void;
  resetScenario: (scenarioId: string) => void;
}

let counter = 0;

function nextId(): string {
  counter += 1;
  return `scn_${counter}_${Math.round(counter * 2654435761) % 100000}`;
}

const cloneAdjustments = (a: ScenarioAdjustments): ScenarioAdjustments => ({
  availableHours: { ...a.availableHours },
  targetUtilization: { ...a.targetUtilization },
  runRate: { ...a.runRate },
  allocation: { ...a.allocation },
  leadTimeDays: { ...a.leadTimeDays },
  // Spreading a missing map yields {}, which is what makes a scenario saved
  // before this category existed rehydrate cleanly.
  volumeUnits: { ...a.volumeUnits },
  analogueWeights: { ...a.analogueWeights },
});

export const useSituationScenarioStore = create<SituationScenarioState>()(
  persist(
    (set, get) => {
      /** Applies a change to one adjustment map and stamps `updatedAt`. */
      const patch = (
        scenarioId: string,
        category: ScenarioAdjustmentCategory,
        key: string,
        value: number | undefined
      ) =>
        set((state) => {
          const scenario = state.scenarios[scenarioId];
          if (!scenario) return state;
          const adjustments = cloneAdjustments(scenario.adjustments);
          const map = adjustments[category];
          if (value === undefined) delete map[key];
          else map[key] = value;
          return {
            scenarios: {
              ...state.scenarios,
              [scenarioId]: { ...scenario, adjustments, updatedAt: new Date().toISOString() },
            },
          };
        });

      return {
        scenarios: {},
        activeScenarioId: null,
        viewMode: "baseline",
        hasHydrated: false,
        setHasHydrated: (value) => set({ hasHydrated: value }),

        createScenario: (situationId, name, now) => {
          const id = nextId();
          set((state) => ({
            scenarios: {
              ...state.scenarios,
              [id]: {
                id,
                name,
                situationId,
                adjustments: cloneAdjustments(EMPTY_ADJUSTMENTS),
                savedAdjustments: cloneAdjustments(EMPTY_ADJUSTMENTS),
                createdAt: now,
                updatedAt: now,
              },
            },
            activeScenarioId: id,
            viewMode: "scenario",
          }));
          return id;
        },

        duplicateScenario: (scenarioId, now) => {
          const source = get().scenarios[scenarioId];
          if (!source) return null;
          const id = nextId();
          set((state) => ({
            scenarios: {
              ...state.scenarios,
              [id]: {
                ...source,
                id,
                name: `${source.name} copy`,
                adjustments: cloneAdjustments(source.adjustments),
                // A copy starts saved as it was made.
                savedAdjustments: cloneAdjustments(source.adjustments),
                createdAt: now,
                updatedAt: now,
              },
            },
            activeScenarioId: id,
          }));
          return id;
        },

        renameScenario: (scenarioId, name) =>
          set((state) => {
            const scenario = state.scenarios[scenarioId];
            if (!scenario) return state;
            return { scenarios: { ...state.scenarios, [scenarioId]: { ...scenario, name } } };
          }),

        deleteScenario: (scenarioId) =>
          set((state) => {
            const scenarios = { ...state.scenarios };
            delete scenarios[scenarioId];
            const activeScenarioId =
              state.activeScenarioId === scenarioId ? null : state.activeScenarioId;
            return {
              scenarios,
              activeScenarioId,
              viewMode: activeScenarioId ? state.viewMode : "baseline",
            };
          }),

        setActiveScenario: (scenarioId) =>
          set({ activeScenarioId: scenarioId, viewMode: scenarioId ? "scenario" : "baseline" }),

        setViewMode: (mode) => set({ viewMode: mode }),

        setNote: (scenarioId, note) =>
          set((state) => {
            const scenario = state.scenarios[scenarioId];
            if (!scenario) return state;
            return { scenarios: { ...state.scenarios, [scenarioId]: { ...scenario, note } } };
          }),

        saveScenario: (scenarioId) =>
          set((state) => {
            const scenario = state.scenarios[scenarioId];
            if (!scenario) return state;
            return {
              scenarios: {
                ...state.scenarios,
                [scenarioId]: { ...scenario, savedAdjustments: cloneAdjustments(scenario.adjustments) },
              },
            };
          }),

        discardChanges: (scenarioId) =>
          set((state) => {
            const scenario = state.scenarios[scenarioId];
            if (!scenario) return state;
            return {
              scenarios: {
                ...state.scenarios,
                [scenarioId]: { ...scenario, adjustments: cloneAdjustments(scenario.savedAdjustments) },
              },
            };
          }),

        setAvailableHours: (scenarioId, lineId, period, hours) =>
          patch(scenarioId, "availableHours", capacityKey(lineId, period), hours),
        setTargetUtilization: (scenarioId, lineId, pct) =>
          patch(scenarioId, "targetUtilization", lineId, pct),
        setRunRate: (scenarioId, itemOrFamilyId, lineId, rate) =>
          patch(scenarioId, "runRate", mappingKey(itemOrFamilyId, lineId), rate),
        setAllocation: (scenarioId, itemOrFamilyId, lineId, share) =>
          patch(scenarioId, "allocation", mappingKey(itemOrFamilyId, lineId), share),
        setLeadTime: (scenarioId, materialId, days) =>
          patch(scenarioId, "leadTimeDays", materialId, days),
        setVolumeUnits: (scenarioId, candidateId, units) =>
          patch(scenarioId, "volumeUnits", candidateId, units),
        setAnalogueWeight: (scenarioId, candidateId, analogueId, weight) =>
          patch(scenarioId, "analogueWeights", analogueKey(candidateId, analogueId), weight),

        clearAdjustment: (scenarioId, category, key) => patch(scenarioId, category, key, undefined),

        resetCategory: (scenarioId, category) =>
          set((state) => {
            const scenario = state.scenarios[scenarioId];
            if (!scenario) return state;
            const adjustments = cloneAdjustments(scenario.adjustments);
            adjustments[category] = {};
            return {
              scenarios: { ...state.scenarios, [scenarioId]: { ...scenario, adjustments } },
            };
          }),

        resetScenario: (scenarioId) =>
          set((state) => {
            const scenario = state.scenarios[scenarioId];
            if (!scenario) return state;
            return {
              scenarios: {
                ...state.scenarios,
                [scenarioId]: { ...scenario, adjustments: cloneAdjustments(EMPTY_ADJUSTMENTS) },
              },
            };
          }),
      };
    },
    {
      name: SITUATION_SCENARIO_STORAGE_KEY,
      // 2 added `volumeUnits`. Without it, a scenario saved under v1
      // rehydrates with that map undefined and every control reading it throws.
      // 3 added `savedAdjustments`: what a scenario already held is treated as
      // saved, so nobody is asked to save work they never touched.
      version: 3,
      migrate: (persisted) => {
        const state = persisted as { scenarios?: Record<string, SituationScenario & { savedAdjustments?: ScenarioAdjustments }> } | undefined;
        if (!state?.scenarios) return persisted;
        return {
          ...state,
          scenarios: Object.fromEntries(
            Object.entries(state.scenarios).map(([id, scenario]) => {
              const adjustments = cloneAdjustments(scenario.adjustments);
              return [
                id,
                {
                  ...scenario,
                  adjustments,
                  savedAdjustments: cloneAdjustments(scenario.savedAdjustments ?? adjustments),
                },
              ];
            })
          ),
        };
      },
      storage: createJSONStorage(() => scopedWebStorage("local")),
      skipHydration: true,
      partialize: (state) => ({
        scenarios: state.scenarios,
        activeScenarioId: state.activeScenarioId,
        viewMode: state.viewMode,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        // Ids must not collide with anything restored from a previous session.
        counter = Object.keys(state.scenarios).length + 1;
        state.setHasHydrated(true);
      },
    }
  )
);
