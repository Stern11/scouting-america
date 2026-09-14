/**
 * Step 3 — Column mapping (V2 §12, §29).
 *
 * Shown only when at least one required column didn't auto-resolve. Basic
 * header mapping, not an ETL builder: one row per unresolved column, one
 * choice each.
 *
 * `lib/excel/column-mapping.ts`'s manual-mapping map is keyed the opposite
 * way round from how it reads at first glance: `Map<sheet, Map<templateColumn,
 * workbookHeaderChosen>>`. We build it that way here so it can be handed
 * straight to `validateWorkbook({ manualMapping })`.
 */

"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { SheetName } from "@/lib/dataset/issues";
import type { ColumnResolution } from "@/lib/excel/column-mapping";

const NOT_IN_FILE = "__not_in_file__";

function keyOf(res: ColumnResolution): string {
  return `${res.sheet}::${res.expected}`;
}

export function StepMapping({
  resolutions,
  initialMapping,
  onBack,
  onSubmit,
}: {
  resolutions: ColumnResolution[];
  initialMapping: Map<SheetName, Map<string, string>>;
  onBack: () => void;
  onSubmit: (mapping: Map<SheetName, Map<string, string>>) => void;
}) {
  const [selections, setSelections] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const res of resolutions) {
      initial[keyOf(res)] = initialMapping.get(res.sheet)?.get(res.expected) ?? NOT_IN_FILE;
    }
    return initial;
  });

  const bySheet = new Map<SheetName, ColumnResolution[]>();
  for (const res of resolutions) {
    const list = bySheet.get(res.sheet) ?? [];
    list.push(res);
    bySheet.set(res.sheet, list);
  }

  const handleSubmit = () => {
    const mapping = new Map<SheetName, Map<string, string>>();
    for (const res of resolutions) {
      const chosen = selections[keyOf(res)];
      if (!chosen || chosen === NOT_IN_FILE) continue;
      const sheetMap = mapping.get(res.sheet) ?? new Map<string, string>();
      sheetMap.set(res.expected, chosen);
      mapping.set(res.sheet, sheetMap);
    }
    onSubmit(mapping);
  };

  return (
    <div>
      <p className="max-w-[560px] text-[13px] leading-relaxed text-[var(--text-secondary)]">
        A few required columns didn&apos;t match by name. Tell us which of your columns they are.
      </p>

      <div className="mt-6 space-y-6">
        {[...bySheet.entries()].map(([sheet, rows]) => (
          <div key={sheet}>
            <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--text-muted)]">
              {sheet}
            </div>
            <div className="divide-y divide-[var(--border)] rounded-[var(--radius-md)] border border-[var(--border)]">
              {rows.map((res) => (
                <div
                  key={keyOf(res)}
                  className="flex flex-col items-stretch gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                >
                  <div className="min-w-0">
                    <p className="text-[13px] text-[var(--text-primary)]">
                      We expected <code className="rounded-[3px] bg-[var(--surface-sunken)] px-1 py-0.5 text-[12px]">{res.expected}</code>
                    </p>
                    <p className="mt-0.5 text-[12px] text-[var(--text-muted)]">Found in your file:</p>
                  </div>
                  <Select
                    value={selections[keyOf(res)] ?? NOT_IN_FILE}
                    onValueChange={(value) => setSelections((s) => ({ ...s, [keyOf(res)]: value }))}
                  >
                    <SelectTrigger className="w-full flex-none sm:w-[220px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NOT_IN_FILE}>Not in my file</SelectItem>
                      {res.candidates.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 flex items-center gap-3">
        <Button variant="secondary" onClick={onBack}>
          Back
        </Button>
        <Button onClick={handleSubmit}>Continue</Button>
      </div>
    </div>
  );
}
