/**
 * Which dataset the product is looking at, and what the planner has decided
 * about it.
 *
 * Deliberately holds no derived planning numbers — situations are recomputed
 * from (dataset + overrides) on read, the same rule the scenario store follows.
 * Demo mode persists only its seed; an uploaded dataset lives in IndexedDB
 * (see `lib/dataset/storage.ts`) because it is far too large for web storage.
 */

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type {
  ContributorDisposition,
  MatchConfig,
  MaterialRelease,
  SituationOverrides,
  VolumeCommitment,
} from "@/types/situation";
import type { DatasetMode } from "@/types/dataset";
import { scopedWebStorage } from "./persist-storage";
import { DEFAULT_DEMO_SEED } from "@/lib/dataset/demo/generate";

export const DATASET_STORAGE_KEY = "heizen.dataset";

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

  activeSituationId: string | null;
  /** Planner dispositions, keyed by situation id. */
  overridesBySituation: Record<string, SituationOverrides>;

  hasHydrated: boolean;
  setHasHydrated: (value: boolean) => void;

  chooseDemo: (seed?: string) => void;
  regenerateDemo: (seed: string) => void;
  /** `stored` is whether the workbook actually reached IndexedDB. */
  chooseUpload: (input: { fileName: string; uploadedAt: string; datasetName: string; stored: boolean }) => void;
  clearDataset: () => void;

  setActiveSituation: (id: string | null) => void;
  setDisposition: (situationId: string, candidateId: string, disposition: ContributorDisposition) => void;
  setDispositions: (situationId: string, dispositions: Record<string, ContributorDisposition>) => void;
  resetDispositions: (situationId: string) => void;
  setMatchConfig: (situationId: string, config: MatchConfig | undefined) => void;
  /** Which historical periods form the planning basis for one situation. */
  setSeasonBasis: (situationId: string, periods: string[] | undefined) => void;
  /** Commits a scenario volume as a governed provisional assumption. */
  commitVolume: (situationId: string, commitment: VolumeCommitment) => void;
  /** Records that a component has been released for ordering. */
  releaseMaterial: (situationId: string, release: MaterialRelease) => void;
  undoMaterialRelease: (situationId: string, materialId: string) => void;
  releaseCommitment: (situationId: string, candidateId: string) => void;
}

const emptyOverrides = (): SituationOverrides => ({ dispositions: {} });

export const useDatasetStore = create<DatasetStoreState>()(
  persist(
    (set) => ({
      mode: null,
      datasetId: "demo",
      datasetName: "Demo planning data",
      seed: DEFAULT_DEMO_SEED,
      uploadedFileName: null,
      uploadedAt: null,
      hasStoredUpload: false,

      activeSituationId: null,
      overridesBySituation: {},

      hasHydrated: false,
      setHasHydrated: (value) => set({ hasHydrated: value }),

      chooseDemo: (seed) =>
        set((state) => ({
          mode: "DEMO",
          seed: seed ?? state.seed,
          datasetId: `demo:${seed ?? state.seed}`,
          datasetName: "Demo planning data",
          uploadedFileName: null,
          uploadedAt: null,
          // Switching source invalidates every decision made against the old one.
          overridesBySituation: {},
          activeSituationId: null,
        })),

      regenerateDemo: (seed) =>
        set({
          mode: "DEMO",
          seed,
          datasetId: `demo:${seed}`,
          datasetName: "Demo planning data",
          overridesBySituation: {},
          activeSituationId: null,
        }),

      chooseUpload: ({ fileName, uploadedAt, datasetName, stored }) =>
        set({
          mode: "UPLOADED",
          datasetId: `upload:${uploadedAt}`,
          datasetName,
          uploadedFileName: fileName,
          uploadedAt,
          hasStoredUpload: stored,
          overridesBySituation: {},
          activeSituationId: null,
        }),

      clearDataset: () =>
        set({
          mode: null,
          uploadedFileName: null,
          uploadedAt: null,
          hasStoredUpload: false,
          overridesBySituation: {},
          activeSituationId: null,
        }),

      setActiveSituation: (id) => set({ activeSituationId: id }),

      setDisposition: (situationId, candidateId, disposition) =>
        set((state) => {
          const current = state.overridesBySituation[situationId] ?? emptyOverrides();
          return {
            overridesBySituation: {
              ...state.overridesBySituation,
              [situationId]: {
                ...current,
                dispositions: { ...current.dispositions, [candidateId]: disposition },
              },
            },
          };
        }),

      setDispositions: (situationId, dispositions) =>
        set((state) => {
          const current = state.overridesBySituation[situationId] ?? emptyOverrides();
          return {
            overridesBySituation: {
              ...state.overridesBySituation,
              [situationId]: {
                ...current,
                dispositions: { ...current.dispositions, ...dispositions },
              },
            },
          };
        }),

      resetDispositions: (situationId) =>
        set((state) => {
          const current = state.overridesBySituation[situationId] ?? emptyOverrides();
          return {
            overridesBySituation: {
              ...state.overridesBySituation,
              [situationId]: { ...current, dispositions: {} },
            },
          };
        }),

      setMatchConfig: (situationId, config) =>
        set((state) => {
          const current = state.overridesBySituation[situationId] ?? emptyOverrides();
          return {
            overridesBySituation: {
              ...state.overridesBySituation,
              [situationId]: { ...current, matchConfig: config },
            },
          };
        }),

      releaseMaterial: (situationId, release) =>
        set((state) => {
          const current = state.overridesBySituation[situationId] ?? emptyOverrides();
          return {
            overridesBySituation: {
              ...state.overridesBySituation,
              [situationId]: {
                ...current,
                releases: { ...current.releases, [release.materialId]: release },
              },
            },
          };
        }),

      undoMaterialRelease: (situationId, materialId) =>
        set((state) => {
          const current = state.overridesBySituation[situationId];
          if (!current?.releases) return state;
          const next = { ...current.releases };
          delete next[materialId];
          return {
            overridesBySituation: {
              ...state.overridesBySituation,
              [situationId]: { ...current, releases: next },
            },
          };
        }),

      commitVolume: (situationId, commitment) =>
        set((state) => {
          const current = state.overridesBySituation[situationId] ?? emptyOverrides();
          return {
            overridesBySituation: {
              ...state.overridesBySituation,
              [situationId]: {
                ...current,
                // Committing a volume necessarily means carrying the item
                // forward — a number that bears no load is not a commitment.
                dispositions: { ...current.dispositions, [commitment.candidateId]: "carry_forward" },
                commitments: { ...current.commitments, [commitment.candidateId]: commitment },
              },
            },
          };
        }),

      releaseCommitment: (situationId, candidateId) =>
        set((state) => {
          const current = state.overridesBySituation[situationId];
          if (!current?.commitments) return state;
          const next = { ...current.commitments };
          delete next[candidateId];
          return {
            overridesBySituation: {
              ...state.overridesBySituation,
              [situationId]: { ...current, commitments: next },
            },
          };
        }),

      setSeasonBasis: (situationId, periods) =>
        set((state) => {
          const current = state.overridesBySituation[situationId] ?? emptyOverrides();
          return {
            overridesBySituation: {
              ...state.overridesBySituation,
              // An empty selection is stored as "no override" rather than as an
              // empty basis: the engine falls back to the latest season, so the
              // planner cannot accidentally leave the plan with no history.
              [situationId]: { ...current, seasonBasis: periods?.length ? periods : undefined },
            },
          };
        }),
    }),
    {
      name: DATASET_STORAGE_KEY,
      version: 1,
      // localStorage, not session: the chosen mode should survive a refresh so
      // the planner is not sent back to the first-run screen. Scoped to the
      // signed-in account — see `stores/storage-scope.ts`.
      storage: createJSONStorage(() => scopedWebStorage("local")),
      skipHydration: true,
      partialize: (state) => ({
        mode: state.mode,
        datasetId: state.datasetId,
        datasetName: state.datasetName,
        seed: state.seed,
        uploadedFileName: state.uploadedFileName,
        uploadedAt: state.uploadedAt,
        hasStoredUpload: state.hasStoredUpload,
        activeSituationId: state.activeSituationId,
        overridesBySituation: state.overridesBySituation,
      }),
      onRehydrateStorage: () => (state) => state?.setHasHydrated(true),
    }
  )
);
