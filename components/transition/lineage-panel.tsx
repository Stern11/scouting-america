"use client";

/**
 * Product lineage: why Heizen believes these SKUs are one product, and the
 * planner's say over it.
 *
 * The match explains itself attribute by attribute — family matches, brand
 * changed — never as a bare similarity percentage. Confidence is shown only
 * beside the reasons it rests on.
 */

import { useState } from "react";
import { Check, CircleDashed, Minus, X } from "lucide-react";
import type { PlanningDataset } from "@/types/dataset";
import type { AttributeVerdict, RelationshipDecision, TransitionView } from "@/types/transition";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfidenceText } from "@/components/shared/state-badge";
import { LineageChain } from "@/components/shared/transition-bar";
import { TYPE_LABEL } from "@/lib/transitions/filters";
import { cn } from "@/lib/utils/cn";
import { useDecisions } from "./use-decisions";

const VERDICT: Record<AttributeVerdict, { label: string; className: string; icon: typeof Check }> = {
  match: { label: "Match", className: "text-[var(--risk-positive)]", icon: Check },
  strong: { label: "Strong match", className: "text-[var(--risk-positive)]", icon: Check },
  partial: { label: "Partial match", className: "text-[var(--risk-warning)]", icon: Minus },
  changed: { label: "Changed", className: "text-[var(--text-secondary)]", icon: X },
  unknown: { label: "Not recorded", className: "text-[var(--text-muted)]", icon: CircleDashed },
};

const SOURCE_LABEL = {
  PLANNER: "Defined in SKU_Transitions",
  SYSTEM: "Recorded in JDA as the replacement",
  SUGGESTED: "Matched automatically — JDA records no replacement",
} as const;

const DECISION_LABEL: Record<RelationshipDecision, string> = {
  CONFIRMED: "Confirmed",
  PARTIAL_REPLACEMENT: "Partial replacement",
  DISCONTINUED: "Discontinued — no replacement",
  NEW_PRODUCT: "New product — no legacy",
  INVESTIGATE: "Needs investigation",
};

export function LineagePanel({ view, dataset }: { view: TransitionView; dataset: PlanningDataset }) {
  const { lineage } = view;
  const decisions = useDecisions(view.id);
  const [changing, setChanging] = useState(false);
  const legacyIds = lineage.predecessors.map((s) => s.skuId).join(" + ");
  const successorIds = lineage.successors.map((s) => s.skuId).join(" + ");
  const reason = lineage.reason ? lineage.reason.charAt(0) + lineage.reason.slice(1).toLowerCase() : null;

  const decide = (decision: RelationshipDecision, text: string) =>
    decisions.override({ relationshipDecision: decision }, text);

  // Candidates for "change successor": new or active SKUs in the same category.
  const category = lineage.predecessors[0]?.category ?? lineage.successors[0]?.category;
  const candidates = dataset.skus
    .filter((s) => (s.status === "NEW" || s.status === "ACTIVE") && s.category === category)
    .filter((s) => !lineage.successors.some((x) => x.skuId === s.skuId))
    .slice(0, 60);

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <LineageChain predecessors={lineage.predecessors} successors={lineage.successors} size="md" />
          <span className="text-[12px] text-[var(--text-muted)]">
            {TYPE_LABEL[lineage.type]}
            {reason ? ` · ${reason}` : ""}
          </span>
        </div>

        {lineage.evidence.length > 0 ? (
          <table className="mt-4 w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-[var(--border-strong)] text-left text-[11px] uppercase tracking-[0.06em] text-[var(--text-muted)]">
                <th className="pb-2 font-medium">Attribute</th>
                <th className="pb-2 font-medium text-[var(--lineage-legacy)]">{lineage.predecessors[0]?.skuId ?? "Legacy"}</th>
                <th className="pb-2 font-medium text-[var(--lineage-successor)]">{lineage.successors[0]?.skuId ?? "Successor"}</th>
                <th className="pb-2 text-right font-medium">Verdict</th>
              </tr>
            </thead>
            <tbody>
              {lineage.evidence.map((e) => {
                const v = VERDICT[e.verdict];
                const Icon = v.icon;
                return (
                  <tr key={e.attribute} className="border-b border-[var(--border)] last:border-b-0">
                    <td className="py-1.5 pr-4 text-[var(--text-secondary)]">{e.attribute}</td>
                    <td className="max-w-[220px] truncate py-1.5 pr-4 text-[var(--text-primary)]" title={e.legacyValue}>
                      {e.legacyValue ?? "—"}
                    </td>
                    <td className="max-w-[220px] truncate py-1.5 pr-4 text-[var(--text-primary)]" title={e.successorValue}>
                      {e.successorValue ?? "—"}
                    </td>
                    <td className={cn("whitespace-nowrap py-1.5 text-right font-medium", v.className)}>
                      <span className="inline-flex items-center gap-1">
                        <Icon className="size-3.5" />
                        {v.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className="mt-4 text-[13px] text-[var(--text-muted)]">
            {lineage.type === "NEW_PRODUCT"
              ? "A new product has no legacy SKU to compare against — its demand comes from its own sales."
              : "This product is being discontinued with no successor, so there is nothing to compare."}
          </p>
        )}
      </div>

      <aside className="space-y-4 border-t border-[var(--border)] pt-5 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-muted)]">Relationship</div>
          <div className="mt-1.5 text-[14px] text-[var(--text-primary)]">
            {lineage.decision ? (
              DECISION_LABEL[lineage.decision]
            ) : lineage.confirmed ? (
              <span className="text-[var(--risk-positive)]">Confirmed</span>
            ) : (
              <span className="text-[var(--risk-warning)]">Awaiting your confirmation</span>
            )}
          </div>
          <div className="mt-0.5 text-[12px] text-[var(--text-muted)]">{SOURCE_LABEL[lineage.source]}</div>
          {lineage.evidence.length > 0 ? (
            <div className="mt-2 text-[12.5px] text-[var(--text-secondary)]">
              Confidence <ConfidenceText confidence={lineage.confidence} /> · {lineage.matchedCount} matching,{" "}
              {lineage.changedCount} changed
            </div>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5">
          {!lineage.confirmed && lineage.predecessors.length > 0 && lineage.successors.length > 0 ? (
            <Button onClick={() => decide("CONFIRMED", `Confirmed ${legacyIds} → ${successorIds}`)}>
              <Check /> Confirm successor
            </Button>
          ) : null}
          {changing ? (
            <Select
              onValueChange={(skuId) => {
                decisions.override({ successorSkuIds: [skuId], relationshipDecision: "CONFIRMED" }, `Changed successor of ${legacyIds} to ${skuId}`);
                setChanging(false);
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Choose the successor SKU" />
              </SelectTrigger>
              <SelectContent>
                {candidates.map((s) => (
                  <SelectItem key={s.skuId} value={s.skuId}>
                    {s.skuId} · {s.skuName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : lineage.predecessors.length > 0 ? (
            <Button variant="outline" onClick={() => setChanging(true)}>
              Change successor
            </Button>
          ) : null}
          <div className="grid grid-cols-2 gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              className="justify-start"
              disabled={lineage.decision === "PARTIAL_REPLACEMENT" || lineage.successors.length === 0}
              onClick={() => decide("PARTIAL_REPLACEMENT", `Marked ${legacyIds} → ${successorIds} a partial replacement`)}
            >
              Partial replacement
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="justify-start"
              disabled={lineage.decision === "INVESTIGATE"}
              onClick={() => decide("INVESTIGATE", `Flagged ${legacyIds} → ${successorIds} for investigation`)}
            >
              Needs investigation
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="justify-start"
              disabled={lineage.type === "NO_SUCCESSOR"}
              onClick={() => decide("DISCONTINUED", `Marked ${legacyIds || view.name} discontinued — no replacement`)}
            >
              Discontinued
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="justify-start"
              disabled={lineage.type === "NEW_PRODUCT"}
              onClick={() => decide("NEW_PRODUCT", `Marked ${successorIds || view.name} a new product — no legacy demand`)}
            >
              New product
            </Button>
          </div>
          {lineage.decision ? (
            <button
              type="button"
              onClick={() => decisions.clear(["relationshipDecision", "successorSkuIds"], "Reset the relationship to what the data says")}
              className="self-start text-[12px] text-[var(--text-muted)] underline underline-offset-4 hover:text-[var(--text-primary)]"
            >
              Reset to data
            </button>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
