"use client";

/**
 * "Use your own data" onboarding (V2 §12, §26-30, §64-65).
 *
 * A thin client wrapper holding flow state; each step is its own component
 * under `components/onboarding/`. Parsing and validation run entirely in the
 * browser via `validateWorkbook` — the workbook is never sent anywhere.
 */

import { BrandMark } from "@/components/shared/brand-mark";
import { useCallback, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { UploadStepper, type UploadStep } from "@/components/onboarding/upload-stepper";
import { StepTemplate } from "@/components/onboarding/step-template";
import { StepUpload } from "@/components/onboarding/step-upload";
import { StepMapping } from "@/components/onboarding/step-mapping";
import { StepIssues } from "@/components/onboarding/step-issues";
import { StepScope } from "@/components/onboarding/step-scope";
import { validateWorkbook, type WorkbookValidation } from "@/lib/excel/validate";
import type { ColumnResolution, MappingPlan } from "@/lib/excel/column-mapping";
import type { SheetName } from "@/lib/dataset/issues";
import { sheetSpec } from "@/lib/excel/schema";
import { probePersistence, saveUploadedDataset } from "@/lib/dataset/storage";
import { useDatasetStore } from "@/stores/dataset-store";

const STEPS: UploadStep[] = [
  { id: 1, label: "Template" },
  { id: 2, label: "Upload" },
  { id: 3, label: "Mapping" },
  { id: 4, label: "Issues" },
  { id: 5, label: "Scope" },
];

type Step = 1 | 2 | 3 | 4 | 5;

function unresolvedRequiredColumns(mapping: MappingPlan): ColumnResolution[] {
  return mapping.resolutions.filter((res) => {
    if (res.status !== "unresolved") return false;
    const col = sheetSpec(res.sheet).columns.find((c) => c.name === res.expected);
    return col?.required ?? false;
  });
}

function baseName(fileName: string): string {
  return fileName.replace(/\.(xlsx|xls)$/i, "");
}

export default function UploadPage() {
  const router = useRouter();
  const chooseUpload = useDatasetStore((s) => s.chooseUpload);

  const [step, setStep] = useState<Step>(1);
  const [file, setFile] = useState<File | null>(null);
  const [fileBuffer, setFileBuffer] = useState<ArrayBuffer | null>(null);
  const [datasetId, setDatasetId] = useState<string | null>(null);
  const [datasetName, setDatasetName] = useState<string>("");
  const [planningNow, setPlanningNow] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const [validation, setValidation] = useState<WorkbookValidation | null>(null);
  // The mapping plan from the FIRST (pre-manual-override) pass. `validation.mapping`
  // moves on once a manual mapping is applied — the columns it named unresolved
  // now resolve as "aliased" — so the Mapping step must keep referring to this
  // stable snapshot, not the live validation, or navigating back to it would
  // render an empty step.
  const [rawMapping, setRawMapping] = useState<MappingPlan | null>(null);
  const [manualMapping, setManualMapping] = useState<Map<SheetName, Map<string, string>>>(new Map());
  const [mappingShown, setMappingShown] = useState(false);
  const [saving, setSaving] = useState(false);
  // Whether this browser keeps a write, tested rather than assumed from the
  // API existing. Optimistic until the probe answers, so nothing flashes.
  const [persistOk, setPersistOk] = useState(true);
  // A save that failed although the probe passed (quota, most often). Shown
  // before leaving this page rather than discovered after a refresh.
  const [saveFailed, setSaveFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void probePersistence().then((ok) => {
      if (!cancelled) setPersistOk(ok);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const resetAll = useCallback(() => {
    setStep(1);
    setSaveFailed(false);
    setFile(null);
    setFileBuffer(null);
    setDatasetId(null);
    setDatasetName("");
    setPlanningNow(null);
    setValidating(false);
    setValidation(null);
    setRawMapping(null);
    setManualMapping(new Map());
    setMappingShown(false);
    setSaving(false);
  }, []);

  const handleFileSelected = useCallback(async (picked: File) => {
    setFile(picked);
    setValidation(null);
    setRawMapping(null);
    setManualMapping(new Map());
    setMappingShown(false);
    setValidating(true);

    const buffer = await picked.arrayBuffer();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const name = baseName(picked.name);

    setFileBuffer(buffer);
    setDatasetId(id);
    setPlanningNow(now);
    setDatasetName(name);

    const result = validateWorkbook(buffer, {
      fileName: picked.name,
      planningNow: now,
      datasetId: id,
      datasetName: name,
    });
    setValidation(result);
    setRawMapping(result.mapping);
    setValidating(false);
  }, []);

  const handleClearFile = useCallback(() => {
    setFile(null);
    setFileBuffer(null);
    setValidation(null);
    setRawMapping(null);
    setManualMapping(new Map());
    setMappingShown(false);
  }, []);

  const handleContinueFromUpload = useCallback(() => {
    if (!rawMapping) return;
    const unresolved = unresolvedRequiredColumns(rawMapping);
    if (unresolved.length > 0) {
      setMappingShown(true);
      setStep(3);
    } else {
      setMappingShown(false);
      setStep(4);
    }
  }, [rawMapping]);

  const handleMappingSubmit = useCallback(
    (mapping: Map<SheetName, Map<string, string>>) => {
      if (!fileBuffer || !file || !datasetId || !planningNow) return;
      setManualMapping(mapping);
      const result = validateWorkbook(fileBuffer, {
        fileName: file.name,
        planningNow,
        datasetId,
        datasetName,
        manualMapping: mapping,
      });
      setValidation(result);
      setStep(4);
    },
    [fileBuffer, file, datasetId, datasetName, planningNow]
  );

  const handleRunPlanning = useCallback(async () => {
    if (!validation?.dataset || !file) return;
    setSaving(true);
    const saved = await saveUploadedDataset(validation.dataset);
    // The dataset is held for this tab either way, so continuing is safe — but
    // an unexpected failure is said out loud first, and the next click goes on.
    if (!saved && persistOk && !saveFailed) {
      setSaveFailed(true);
      setSaving(false);
      return;
    }
    chooseUpload({
      fileName: file.name,
      uploadedAt: new Date().toISOString(),
      datasetName,
      stored: saved,
    });
    router.push("/overview");
  }, [validation, file, datasetName, chooseUpload, router, persistOk, saveFailed]);

  const unreadableMessage =
    validation && !validation.dataset
      ? (validation.issues.find((i) => i.code === "unreadable_workbook")?.message ?? "This file could not be read.")
      : null;

  return (
    <div className="min-h-screen bg-[var(--background)] px-8 py-12">
      <div className="mx-auto w-full max-w-[960px]">
        <div className="mb-9 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <BrandMark />
          </div>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={resetAll}
              className="text-[12.5px] text-[var(--text-muted)] underline underline-offset-4 hover:text-[var(--text-primary)]"
            >
              Start over
            </button>
            <Link
              href="/start"
              className="text-[12.5px] text-[var(--text-muted)] underline underline-offset-4 hover:text-[var(--text-primary)]"
            >
              Back to start
            </Link>
          </div>
        </div>

        <h1 className="text-[24px] font-semibold leading-tight tracking-[-0.02em] text-[var(--text-primary)]">
          Use your own data
        </h1>
        <p className="mt-1.5 text-[13px] text-[var(--text-secondary)]">
          Five short steps from your JDA exports to a transition plan. Everything happens in this browser — nothing is uploaded anywhere.
        </p>

        <div className="mt-8">
          <UploadStepper steps={STEPS} current={step} />
        </div>

        <div className="mt-8 border-t border-[var(--border)] pt-8">
          {step === 1 ? <StepTemplate onContinue={() => setStep(2)} /> : null}

          {step === 2 ? (
            <StepUpload
              file={file}
              validating={validating}
              unreadableMessage={unreadableMessage}
              onFileSelected={handleFileSelected}
              onClearFile={handleClearFile}
              onBack={() => setStep(1)}
              onContinue={handleContinueFromUpload}
              canContinue={Boolean(validation?.dataset)}
            />
          ) : null}

          {step === 3 && rawMapping ? (
            <StepMapping
              resolutions={unresolvedRequiredColumns(rawMapping)}
              initialMapping={manualMapping}
              onBack={() => setStep(2)}
              onSubmit={handleMappingSubmit}
            />
          ) : null}

          {step === 4 && validation ? (
            <StepIssues
              summary={validation.summary}
              onBack={() => setStep(mappingShown ? 3 : 2)}
              onContinue={() => setStep(5)}
            />
          ) : null}

          {step === 5 && validation?.scope ? (
            <StepScope
              scope={validation.scope}
              persistenceAvailable={persistOk && !saveFailed}
              saving={saving}
              onBack={() => setStep(4)}
              onRunPlanning={handleRunPlanning}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
