/**
 * Capacity scenarios — plant / line / month, separate from demand scenarios.
 *
 * Stores overrides only — never a derived number. The plan is recomputed by
 * `buildCapacityPlan` from the dataset, the built situations and these
 * adjustments, so the baseline is never touched and nothing derived is
 * persisted (V2 §53).
 *
 * Not keyed by programme: a line in June carries every programme at once, so
 * a capacity scenario belongs to the plant, not to Halloween or Holiday.
 */

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  EMPTY_CAPACITY_ADJUSTMENTS,
  lineMonthKey,
  type CapacityAdjustmentCategory,
  type CapacityAdjustments,
  type CapacityScenario,
} from "@/lib/situations/capacity-plan";
import { MAX_MOVE_WEEKS } from "@/lib/situations/pull-forward";
import { sameAdjustments } from "@/lib/situations/scenario";
import { scopedWebStorage } from "./persist-storage";

export const CAPACITY_SCENARIO_STORAGE_KEY = "heizen.capacity-scenarios";

/** The draft differs from what was last saved. */
export function isCapacityScenarioDirty(scenario: CapacityScenario | undefined): boolean {
  return scenario !== undefined && !sameAdjustments(scenario.adjustments, scenario.savedAdjustments);
}

export interface CapacityScenarioState {
  scenarios: Record<string, CapacityScenario>;
  activeScenarioId: string | null;
  hasHydrated: boolean;
  setHasHydrated: (value: boolean) => void;

  createScenario: (name: string, now: string) => string;
  duplicateScenario: (scenarioId: string, now: string) => string | null;
  renameScenario: (scenarioId: string, name: string) => void;
  deleteScenario: (scenarioId: string) => void;
  setActiveScenario: (scenarioId: string | null) => void;
  setNote: (scenarioId: string, note: string) => void;
  /** Makes the current draft the saved snapshot. */
  saveScenario: (scenarioId: string) => void;
  /** Throws the draft away and restores the saved snapshot. */
  discardChanges: (scenarioId: string) => void;

  setAvailableHours: (scenarioId: string, lineId: string, period: string, hours: number) => void;
  setExtraShift: (scenarioId: string, lineId: string, period: string, on: boolean) => void;
  /** Weeks a line's carry-forward builds may be pulled forward, 0..MAX_MOVE_WEEKS. */
  setMoveWeeks: (scenarioId: string, lineId: string, weeks: number) => void;
  /** `brandPack` is `brandPackKey(brand, packFormat)`; share is 0-1. */
  setAllocation: (scenarioId: string, brandPack: string, share: number) => void;

  clearAdjustment: (scenarioId: string, category: CapacityAdjustmentCategory, key: string) => void;
  resetScenario: (scenarioId: string) => void;
}

let counter = 0;

function nextId(): string {
  counter += 1;
  return `cap_${counter}`;
}

const cloneAdjustments = (a: Partial<CapacityAdjustments> | undefined): CapacityAdjustments => ({
  availableHours: { ...a?.availableHours },
  extraShifts: { ...a?.extraShifts },
  moveWeeks: { ...a?.moveWeeks },
  allocation: { ...a?.allocation },
});

export const useCapacityScenarioStore = create<CapacityScenarioState>()(
  persist(
    (set, get) => {
      /** Applies one change and stamps `updatedAt`. `undefined` removes the key. */
      const patch = (
        scenarioId: string,
        category: CapacityAdjustmentCategory,
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
        hasHydrated: false,
        setHasHydrated: (value) => set({ hasHydrated: value }),

        createScenario: (name, now) => {
          const id = nextId();
          set((state) => ({
            scenarios: {
              ...state.scenarios,
              [id]: {
                id,
                name,
                adjustments: cloneAdjustments(EMPTY_CAPACITY_ADJUSTMENTS),
                savedAdjustments: cloneAdjustments(EMPTY_CAPACITY_ADJUSTMENTS),
                createdAt: now,
                updatedAt: now,
              },
            },
            activeScenarioId: id,
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
            return {
              scenarios,
              activeScenarioId: state.activeScenarioId === scenarioId ? null : state.activeScenarioId,
            };
          }),

        setActiveScenario: (scenarioId) => set({ activeScenarioId: scenarioId }),

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
          patch(scenarioId, "availableHours", lineMonthKey(lineId, period), Math.max(0, hours)),
        // Off is the baseline, so turning a shift off removes the override
        // rather than storing a zero that would count as a change.
        setExtraShift: (scenarioId, lineId, period, on) =>
          patch(scenarioId, "extraShifts", lineMonthKey(lineId, period), on ? 1 : undefined),
        setMoveWeeks: (scenarioId, lineId, weeks) => {
          const clamped = Math.round(Math.min(MAX_MOVE_WEEKS, Math.max(0, weeks)));
          patch(scenarioId, "moveWeeks", lineId, clamped !== 0 ? clamped : undefined);
        },
        setAllocation: (scenarioId, brandPack, share) => {
          const clamped = Math.min(1, Math.max(0, share));
          patch(scenarioId, "allocation", brandPack, clamped >= 0.9995 ? undefined : clamped);
        },

        clearAdjustment: (scenarioId, category, key) => patch(scenarioId, category, key, undefined),

        resetScenario: (scenarioId) =>
          set((state) => {
            const scenario = state.scenarios[scenarioId];
            if (!scenario) return state;
            return {
              scenarios: {
                ...state.scenarios,
                [scenarioId]: { ...scenario, adjustments: cloneAdjustments(EMPTY_CAPACITY_ADJUSTMENTS) },
              },
            };
          }),
      };
    },
    {
      name: CAPACITY_SCENARIO_STORAGE_KEY,
      // 2: `pullForwardWeeks` (0-12) became signed `moveWeeks` (±8), and
      // `savedAdjustments` was added — what a scenario held is treated as saved.
      // 3: building later was removed. Negative `moveWeeks` (in the draft and
      // the saved snapshot) become 0, which is no override at all.
      version: 3,
      migrate: (persisted, version) => {
        type OldScenario = Omit<CapacityScenario, "adjustments" | "savedAdjustments"> & {
          adjustments: Partial<CapacityAdjustments> & { pullForwardWeeks?: Record<string, number> };
          savedAdjustments?: Partial<CapacityAdjustments>;
        };
        const state = persisted as { scenarios?: Record<string, OldScenario> } | undefined;
        if (!state?.scenarios || version >= 3) return persisted;

        /** Keeps only forward pulls, clamped to the slider. */
        const forwardOnly = (weeks: Record<string, number> | undefined) =>
          Object.fromEntries(
            Object.entries(weeks ?? {})
              .map(([line, w]) => [line, Math.round(Math.min(MAX_MOVE_WEEKS, Math.max(0, w)))] as const)
              .filter(([, w]) => w > 0)
          );

        return {
          ...state,
          scenarios: Object.fromEntries(
            Object.entries(state.scenarios).map(([id, scenario]) => {
              if (version < 2) {
                const adjustments = cloneAdjustments({
                  ...scenario.adjustments,
                  moveWeeks: forwardOnly(scenario.adjustments.pullForwardWeeks),
                });
                return [id, { ...scenario, adjustments, savedAdjustments: cloneAdjustments(adjustments) }];
              }
              const adjustments = cloneAdjustments({
                ...scenario.adjustments,
                moveWeeks: forwardOnly(scenario.adjustments.moveWeeks),
              });
              const saved = scenario.savedAdjustments ?? scenario.adjustments;
              const savedAdjustments = cloneAdjustments({ ...saved, moveWeeks: forwardOnly(saved.moveWeeks) });
              return [id, { ...scenario, adjustments, savedAdjustments }];
            })
          ),
        };
      },
      storage: createJSONStorage(() => scopedWebStorage("local")),
      skipHydration: true,
      partialize: (state) => ({
        scenarios: state.scenarios,
        activeScenarioId: state.activeScenarioId,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        // Ids must not collide with anything restored from a previous session.
        const used = Object.keys(state.scenarios).map((id) => Number(id.replace(/^cap_/, "")) || 0);
        counter = Math.max(counter, ...used);
        state.setHasHydrated(true);
      },
    }
  )
);
