/**
 * Step 5 — Scope preview.
 *
 * The compact review before committing: what Heizen found in the workbook,
 * and — honestly, not alarmingly — what it can't yet answer because a sheet
 * was left out.
 */

"use client";

import { Info, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MetricRow } from "@/components/shared/page";
import type { PlanningScopePreview } from "@/lib/excel/validate";
import { fmtDateShort } from "@/lib/utils/format";

export function StepScope({
  scope,
  persistenceAvailable,
  saving,
  onBack,
  onRunPlanning,
}: {
  scope: PlanningScopePreview;
  persistenceAvailable: boolean;
  saving: boolean;
  onBack: () => void;
  onRunPlanning: () => void;
}) {
  return (
    <div>
      <p className="max-w-[560px] text-[13px] leading-relaxed text-[var(--text-secondary)]">
        Here&apos;s what we found in your workbook before it starts planning your transitions.
      </p>

      <div className="mt-6">
        <MetricRow
          items={[
            {
              label: "Transitions to plan",
              value: scope.plannedTransitionCount.toLocaleString(),
              sub:
                scope.suggestedTransitionCount > 0
                  ? `${scope.suggestedTransitionCount} matched automatically — you confirm them`
                  : `${scope.explicitTransitionCount.toLocaleString()} from SKU_Transitions`,
            },
            { label: "SKUs", value: scope.skuCount.toLocaleString() },
            { label: "Stores", value: scope.storeCount.toLocaleString() },
            {
              label: "Sales history",
              value: scope.salesFrom && scope.salesTo ? `${fmtDateShort(scope.salesFrom)} – ${fmtDateShort(scope.salesTo)}` : "None",
            },
          ]}
        />
      </div>

      {scope.plannedTransitionCount === 0 ? (
        <p className="mt-6 max-w-[560px] text-[12.5px] text-[var(--text-secondary)]">
          No transitions found. Add a SKU_Transitions sheet, fill replacement_sku_id on the SKU master, or mark
          legacy SKUs DISCONTINUED so they can be matched to their successors.
        </p>
      ) : null}

      {scope.unavailable.length > 0 ? (
        <div className="mt-7 space-y-2 border-t border-[var(--border)] pt-5">
          {scope.unavailable.map((line) => (
            <div key={line} className="flex items-start gap-2 text-[12.5px] text-[var(--text-secondary)]">
              <Info className="mt-0.5 size-3.5 flex-none text-[var(--text-muted)]" />
              {line}
            </div>
          ))}
        </div>
      ) : null}

      {!persistenceAvailable ? (
        <p className="mt-6 text-[12px] text-[var(--text-muted)]">
          This browser can&apos;t save your data locally — it will be lost if you refresh.
        </p>
      ) : null}

      <div className="mt-6 flex items-center gap-3">
        <Button variant="secondary" onClick={onBack} disabled={saving}>
          Back
        </Button>
        <Button size="lg" onClick={onRunPlanning} disabled={saving}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : null}
          Plan transitions
        </Button>
      </div>
    </div>
  );
}
