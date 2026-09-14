"use client";

/**
 * Release an order — to whom (PRD §20, V2 §15).
 *
 * "Release" used to record a quantity with no supplier while the material
 * drawer listed several. Procurement awards on a supplier's record, so the
 * choice is made here, against that record, with one recommended pick and the
 * one-line reason for it. The planner can pick anyone.
 *
 * It records a decision. It does not place a purchase order.
 */

import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SupplierTable } from "@/components/workspace/supplier-table";
import type { PendingDecision } from "@/lib/situations/decisions";
import { supplierComparison } from "@/lib/situations/suppliers";
import { fmtDateShort, fmtNum } from "@/lib/utils/format";
import type { PlanningDataset } from "@/types/dataset";
import type { PlanningSituation } from "@/types/situation";

export type ChosenSupplier = { supplierId: string; supplierName: string } | undefined;

export function ReleaseDialog({
  decision,
  situation,
  dataset,
  onClose,
  onConfirm,
}: {
  /** The order being released; null keeps the dialog closed. */
  decision: PendingDecision | null;
  situation: PlanningSituation | undefined;
  dataset: PlanningDataset | null;
  onClose: () => void;
  onConfirm: (decision: PendingDecision, supplier: ChosenSupplier) => void;
}) {
  const open = decision !== null && situation !== undefined;
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      {open && decision.materialId ? (
        <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] max-w-3xl overflow-y-auto">
          {/* Keyed so a different order never inherits the last one's pick. */}
          <Body
            key={decision.id}
            decision={decision}
            situation={situation}
            dataset={dataset}
            onClose={onClose}
            onConfirm={onConfirm}
          />
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

function Body({
  decision,
  situation,
  dataset,
  onClose,
  onConfirm,
}: {
  decision: PendingDecision;
  situation: PlanningSituation;
  dataset: PlanningDataset | null;
  onClose: () => void;
  onConfirm: (decision: PendingDecision, supplier: ChosenSupplier) => void;
}) {
  const comparison = useMemo(
    () => (dataset && decision.materialId ? supplierComparison(dataset, situation, decision.materialId) : undefined),
    [dataset, situation, decision.materialId]
  );
  const [selectedId, setSelectedId] = useState(comparison?.recommended?.supplierId);
  const selected = comparison?.suppliers.find((s) => s.supplierId === selectedId);

  const qty =
    decision.quantity && decision.quantity > 0
      ? `${fmtNum(Math.round(decision.quantity))} ${decision.uom ?? ""}`.trim()
      : undefined;
  const recommended = comparison?.recommended;
  const hasSuppliers = (comparison?.suppliers.length ?? 0) > 0;

  const confirmLabel = hasSuppliers
    ? selected
      ? `Release ${qty ? `${qty} ` : ""}to ${selected.supplierName}`
      : "Choose a supplier"
    : `Release ${qty ?? ""} without a supplier`.replace(/\s+/g, " ");

  return (
    <>
      <DialogHeader className="pr-6">
        <DialogTitle>Award {decision.materialName ?? decision.title}</DialogTitle>
        <DialogDescription>
          {qty ? `${qty} · ` : ""}
          {decision.date ? `order by ${fmtDateShort(decision.date)}` : "undated"}
          {decision.drivenBy.length > 0
            ? ` · for ${decision.drivenBy[0]}${decision.drivenBy.length > 1 ? ` +${decision.drivenBy.length - 1}` : ""}`
            : ""}
        </DialogDescription>
      </DialogHeader>

      {recommended ? (
        <p className="text-[12.5px] text-[var(--text-secondary)]">
          <span className="font-medium text-[var(--text-primary)]">{recommended.supplierName}</span>
          {" — "}
          {recommended.reason}
        </p>
      ) : null}

      {comparison ? (
        <SupplierTable
          comparison={comparison}
          selectedId={selectedId}
          onSelect={(s) => setSelectedId(s.supplierId)}
        />
      ) : (
        <p className="py-4 text-[12.5px] text-[var(--text-muted)]">
          No dataset is loaded, so there is no supplier history to choose from.
        </p>
      )}

      <div className="mt-1 flex flex-col-reverse gap-3 border-t border-[var(--border)] pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[11.5px] text-[var(--text-muted)]">
          Records your decision. No purchase order is placed.
        </p>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <button
            type="button"
            onClick={onClose}
            className="rounded-[var(--radius-sm)] border border-[var(--border-strong)] px-3.5 py-2 text-[13px] font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--interaction-hover)]"
            style={{ transitionDuration: "var(--duration-fast)" }}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={hasSuppliers && !selected}
            onClick={() =>
              onConfirm(
                decision,
                selected ? { supplierId: selected.supplierId, supplierName: selected.supplierName } : undefined
              )
            }
            className="rounded-[var(--radius-sm)] bg-[var(--accent)] px-3.5 py-2 text-[13px] font-medium text-[var(--text-on-accent)] transition-opacity hover:opacity-90 disabled:opacity-[var(--interaction-disabled-opacity)]"
            style={{ transitionDuration: "var(--duration-fast)" }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </>
  );
}
