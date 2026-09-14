"use client";

/**
 * Scenario Lab (V2 §13).
 *
 * Two jobs, kept apart: demand planning (per programme — does what is missing
 * explain the gap, and what if I carry more?) and capacity planning (per plant
 * — can the lines build it, and what will I do if not?). Each has its own
 * scenario. `?mode=demand|capacity` picks one; `?situation=` opens demand
 * planning on that programme, and `?item=` focuses one SKU inside it.
 *
 * Next's `useSearchParams` requires a Suspense boundary around whatever reads
 * it, so that reader is split into its own child component.
 */

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { LabHeader, type LabMode } from "@/components/scenario-lab/lab-header";
import { DemandPlanning } from "@/components/scenario-lab/demand-planning";
import { CapacityPlanning } from "@/components/scenario-lab/capacity-planning";
import { Page } from "@/components/shared/page";

function ScenarioLabRoute() {
  const searchParams = useSearchParams();
  const mode: LabMode = searchParams.get("mode") === "capacity" ? "capacity" : "demand";
  const situationId = searchParams.get("situation") ?? undefined;
  const focusItemId = searchParams.get("item") ?? undefined;

  return (
    <div>
      <LabHeader mode={mode} situationId={situationId} />
      {mode === "capacity" ? (
        <CapacityPlanning />
      ) : (
        <DemandPlanning situationId={situationId} focusItemId={focusItemId} />
      )}
    </div>
  );
}

export default function ScenarioLabPage() {
  return (
    <Suspense fallback={<Page>{null}</Page>}>
      <ScenarioLabRoute />
    </Suspense>
  );
}
