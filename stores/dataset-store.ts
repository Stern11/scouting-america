/**
 * Which dataset the product is looking at, and what the planner has decided
 * about it.
 *
 * Deliberately holds no derived planning numbers — transitions are rebuilt
 * from (dataset + overrides) on every read. What lives here are decisions:
 * a confirmed successor, a substitutability the planner set, an action they
 * marked done — each logged, so the trail of who changed what survives.
 *
 * Demo mode persists only its seed; an uploaded dataset lives in IndexedDB
 * (see `lib/dataset/storage.ts`) because it is far too large for web storage.
 */

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { ActionState, AuditEntry, TransitionOverrides } from "@/types/transition";
import type { DatasetMode } from "@/types/dataset";
import { scopedWebStorage } from "./persist-storage";
import { DEFAULT_DEMO_SEED } from "@/lib/dataset/demo/generate";

export const DATASET_STORAGE_KEY = "heizen.dataset";

/** A planner decision as the trail records it. */
export interface DecisionNote {
  actor: string;
  /** "Confirmed CS-1048 → CS-2841". */
  text: string;
  /** Real time the decision was made — this is an event, not planning data. */
  at: string;
}

export interface DatasetStoreState {
  /** Null until the planner has chosen a mode — drives the first-run screen. */
  mode: DatasetMode | null;
  datasetId: string;
  datasetName: string;
  /** Demo only. */
  seed: string;
  /** Uploaded only. */
  uploadedFileName: string | null;
  uploadedAt: string | null;
  /** True once an uploaded dataset is known to be in IndexedDB, not just held in this tab. */
  hasStoredUpload: boolean;

  /** Planner decisions about each transition's baseline. */
  overridesByTransition: Record<string, TransitionOverrides>;
  /** What the planner did with each action, keyed by action id. */
  actionStates: Record<string, ActionState>;
  /** Every decision, newest last. */
  auditLog: AuditEntry[];

  hasHydrated: boolean;
  setHasHydrated: (value: boolean) => void;

  chooseDemo: (seed?: string) => void;
  regenerateDemo: (seed: string) => void;
  /** `stored` is whether the workbook actually reached IndexedDB. */
  chooseUpload: (input: { fileName: string; uploadedAt: string; datasetName: string; stored: boolean }) => void;
  clearDataset: () => void;

  /** Merges a decision into a transition's overrides and logs it. */
  setOverride: (transitionId: string, patch: TransitionOverrides, note: DecisionNote) => void;
  /** Removes overrides — back to what the data says. */
  clearOverrides: (transitionId: string, keys: (keyof TransitionOverrides)[], note: DecisionNote) => void;
  setActionState: (actionId: string, transitionId: string, state: ActionState, note: DecisionNote) => void;
  reopenAction: (actionId: string, transitionId: string, note: DecisionNote) => void;
}

let auditSeq = 0;
function audit(transitionId: string, note: DecisionNote): AuditEntry {
  auditSeq += 1;
  return { id: `audit-${note.at}-${auditSeq}`, at: note.at, actor: note.actor, transitionId, text: note.text };
}

/** Switching source invalidates every decision made against the old one. */
const freshDecisions = () => ({ overridesByTransition: {}, actionStates: {}, auditLog: [] as AuditEntry[] });

export const useDatasetStore = create<DatasetStoreState>()(
  persist(
    (set) => ({
      mode: null,
      datasetId: "demo",
      datasetName: "Scouting America demo",
      seed: DEFAULT_DEMO_SEED,
      uploadedFileName: null,
      uploadedAt: null,
      hasStoredUpload: false,

      overridesByTransition: {},
      actionStates: {},
      auditLog: [],

      hasHydrated: false,
      setHasHydrated: (value) => set({ hasHydrated: value }),

      chooseDemo: (seed) =>
        set((state) => ({
          mode: "DEMO",
          seed: seed ?? state.seed,
          datasetId: `demo:${seed ?? state.seed}`,
          datasetName: "Scouting America demo",
          uploadedFileName: null,
          uploadedAt: null,
          ...(state.mode === "DEMO" && (seed ?? state.seed) === state.seed ? {} : freshDecisions()),
        })),

      regenerateDemo: (seed) =>
        set({
          mode: "DEMO",
          seed,
          datasetId: `demo:${seed}`,
          datasetName: "Scouting America demo",
          ...freshDecisions(),
        }),

      chooseUpload: ({ fileName, uploadedAt, datasetName, stored }) =>
        set({
          mode: "UPLOADED",
          datasetId: `upload:${uploadedAt}`,
          datasetName,
          uploadedFileName: fileName,
          uploadedAt,
          hasStoredUpload: stored,
          ...freshDecisions(),
        }),

      clearDataset: () =>
        set({
          mode: null,
          uploadedFileName: null,
          uploadedAt: null,
          hasStoredUpload: false,
          ...freshDecisions(),
        }),

      setOverride: (transitionId, patch, note) =>
        set((state) => ({
          overridesByTransition: {
            ...state.overridesByTransition,
            [transitionId]: { ...state.overridesByTransition[transitionId], ...patch },
          },
          auditLog: [...state.auditLog, audit(transitionId, note)],
        })),

      clearOverrides: (transitionId, keys, note) =>
        set((state) => {
          const current = { ...state.overridesByTransition[transitionId] };
          for (const key of keys) delete current[key];
          return {
            overridesByTransition: { ...state.overridesByTransition, [transitionId]: current },
            auditLog: [...state.auditLog, audit(transitionId, note)],
          };
        }),

      setActionState: (actionId, transitionId, actionState, note) =>
        set((state) => ({
          actionStates: { ...state.actionStates, [actionId]: actionState },
          auditLog: [...state.auditLog, audit(transitionId, note)],
        })),

      reopenAction: (actionId, transitionId, note) =>
        set((state) => {
          const next = { ...state.actionStates };
          delete next[actionId];
          return { actionStates: next, auditLog: [...state.auditLog, audit(transitionId, note)] };
        }),
    }),
    {
      name: DATASET_STORAGE_KEY,
      version: 2,
      // localStorage, not session: the chosen mode should survive a refresh so
      // the planner is not sent back to the first-run screen. Scoped to the
      // signed-in account — see `stores/storage-scope.ts`.
      storage: createJSONStorage(() => scopedWebStorage("local")),
      skipHydration: true,
      // Anything stored by the previous product generation is meaningless
      // against this model: keep the dataset choice, drop the decisions.
      migrate: (persisted) => {
        const old = (persisted ?? {}) as Partial<DatasetStoreState>;
        return {
          mode: null,
          datasetId: "demo",
          datasetName: "Scouting America demo",
          seed: DEFAULT_DEMO_SEED,
          uploadedFileName: old.uploadedFileName ?? null,
          uploadedAt: old.uploadedAt ?? null,
          hasStoredUpload: false,
          ...freshDecisions(),
        } as Partial<DatasetStoreState> as DatasetStoreState;
      },
      partialize: (state) => ({
        mode: state.mode,
        datasetId: state.datasetId,
        datasetName: state.datasetName,
        seed: state.seed,
        uploadedFileName: state.uploadedFileName,
        uploadedAt: state.uploadedAt,
        hasStoredUpload: state.hasStoredUpload,
        overridesByTransition: state.overridesByTransition,
        actionStates: state.actionStates,
        auditLog: state.auditLog,
      }),
      onRehydrateStorage: () => (state) => state?.setHasHydrated(true),
    }
  )
);
