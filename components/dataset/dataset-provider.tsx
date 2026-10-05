"use client";

/**
 * Resolves the active planning dataset and derives transitions from it.
 *
 * Both modes land here and nothing below this point knows which adapter
 * produced the data. Derived planning numbers are never persisted:
 * `buildTransitions` runs against (dataset + planner overrides) on every read,
 * which is what keeps the pages from drifting apart.
 */

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { PlanningDataset } from "@/types/dataset";
import type { TransitionView } from "@/types/transition";
import { buildTransitions } from "@/lib/transitions/build";
import { generateDemoDataset } from "@/lib/dataset/demo/generate";
import { loadUploadedDataset } from "@/lib/dataset/storage";
import { useDatasetStore } from "@/stores/dataset-store";

export interface DatasetContextValue {
  dataset: PlanningDataset | null;
  transitions: TransitionView[];
  /** True while the store is rehydrating or an upload is being read back. */
  loading: boolean;
  /** Set when an uploaded dataset was expected but could not be read back. */
  error: string | null;
}

const DatasetContext = createContext<DatasetContextValue>({
  dataset: null,
  transitions: [],
  loading: true,
  error: null,
});

export function DatasetProvider({ children }: { children: ReactNode }) {
  const hasHydrated = useDatasetStore((s) => s.hasHydrated);
  const mode = useDatasetStore((s) => s.mode);
  const seed = useDatasetStore((s) => s.seed);
  const datasetId = useDatasetStore((s) => s.datasetId);
  const overridesByTransition = useDatasetStore((s) => s.overridesByTransition);

  const [uploaded, setUploaded] = useState<PlanningDataset | null>(null);
  const [loadingUpload, setLoadingUpload] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A demo dataset is cheap and deterministic, so it is regenerated from the
  // seed rather than stored — the seed is the only thing worth persisting.
  // Its planning date is today, so the story reads the same any day it opens.
  const demo = useMemo(() => (mode === "DEMO" ? generateDemoDataset({ seed }) : null), [mode, seed]);

  useEffect(() => {
    if (mode !== "UPLOADED") {
      setUploaded(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoadingUpload(true);
    loadUploadedDataset()
      .then((stored) => {
        if (cancelled) return;
        setUploaded(stored);
        setError(
          stored
            ? null
            : "Your uploaded data is no longer available in this browser. Upload the workbook again to continue."
        );
      })
      .finally(() => {
        if (!cancelled) setLoadingUpload(false);
      });
    return () => {
      cancelled = true;
    };
    // `datasetId` changes on every new upload, which is the signal to re-read.
  }, [mode, datasetId]);

  const dataset = mode === "DEMO" ? demo : uploaded;

  const transitions = useMemo(
    () => (dataset ? buildTransitions(dataset, { overridesByTransition }) : []),
    [dataset, overridesByTransition]
  );

  const value = useMemo<DatasetContextValue>(
    () => ({
      dataset,
      transitions,
      loading: !hasHydrated || loadingUpload,
      error,
    }),
    [dataset, transitions, hasHydrated, loadingUpload, error]
  );

  return <DatasetContext.Provider value={value}>{children}</DatasetContext.Provider>;
}

export function useDataset(): DatasetContextValue {
  return useContext(DatasetContext);
}

/** One transition, by id. */
export function useTransition(id: string | undefined): TransitionView | undefined {
  const { transitions } = useDataset();
  return useMemo(() => transitions.find((t) => t.id === id), [transitions, id]);
}
