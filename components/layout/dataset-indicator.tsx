"use client";

import Link from "next/link";
import { Database, ChevronDown } from "lucide-react";
import { useDatasetStore } from "@/stores/dataset-store";
import { useDataset } from "@/components/dataset/dataset-provider";
import { cn } from "@/lib/utils/cn";

/**
 * Which data the planner is looking at. Deliberately quiet (V2 §34) — it
 * matters constantly but should never compete with the numbers.
 */
export function DatasetIndicator() {
  const mode = useDatasetStore((s) => s.mode);
  const fileName = useDatasetStore((s) => s.uploadedFileName);
  const { dataset } = useDataset();

  if (!mode) return null;

  const isDemo = mode === "DEMO";
  const label = isDemo ? "Demo data" : "Your data";
  const detail = isDemo
    ? "Synthetic Scouting America network — not real data"
    : (fileName ?? dataset?.metadata.sourceFileName ?? "Uploaded workbook");

  return (
    <Link
      href="/start"
      title={detail}
      className={cn(
        "group flex items-center gap-2 rounded-[var(--radius-sm)] border px-2.5 py-1.5 text-[12px] transition-colors",
        isDemo
          ? "border-[var(--border)] bg-[var(--surface-sunken)] text-[var(--text-secondary)]"
          : "border-[var(--state-validated)]/30 bg-[var(--state-validated-soft)] text-[var(--state-validated)]"
      )}
    >
      <Database className="size-3.5" />
      <span className="font-medium">{label}</span>
      <span className="max-w-[160px] truncate text-[var(--text-muted)]">{detail}</span>
      <ChevronDown className="size-3 opacity-50 transition-transform group-hover:translate-y-px" />
    </Link>
  );
}
