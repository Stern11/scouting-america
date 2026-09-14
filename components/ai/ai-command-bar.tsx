"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { CornerDownLeft, Search, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import { VoiceButton } from "./voice-button";
import { useDataset } from "@/components/dataset/dataset-provider";
import { useDatasetStore } from "@/stores/dataset-store";
import { useSituationScenarioStore } from "@/stores/situation-scenario-store";
import { useCapacityScenarioStore } from "@/stores/capacity-scenario-store";
import { respond, type CopilotAction, type CopilotContext, type CopilotReply } from "@/lib/copilot";
import type { ContributorDisposition } from "@/types/situation";

/**
 * The "Ask Heizen" entry point, live on every route — the V2 build.
 *
 * The product moved to the V2 `PlanningSituation` model, but this bar kept
 * answering from `lib/ai-copilot/*`, the V1 engine grounded in
 * `calculateScenario()` over `data/synthetic/*` — a different generation of
 * data. The planner could be looking at a V2 Capacity page and ask the top
 * bar "why is line 03 red" and get back a number from a different dataset
 * entirely. This bar now submits into `lib/copilot/respond.ts`, which is
 * grounded only in the `PlanningSituation` objects `useDataset()` already
 * built for the page on screen — a reply here can never disagree with what
 * the page already shows.
 *
 * A returned action is executed here, and only here: `navigate` pushes a
 * route; `set_disposition` writes to `useDatasetStore` (the planner's
 * reconciliation decisions, never the dataset itself); `set_available_hours`
 * / `set_lead_time` write to `useSituationScenarioStore` — SCENARIO state,
 * never the baseline (V2 §54). Nothing here mutates `useDataset()`'s
 * dataset.
 *
 * It keeps its own short local transcript, shown in the panel below.
 */
export function AiCommandBar({
  className,
  placeholder = 'Ask Heizen — try "how big is the Halloween gap"',
}: {
  className?: string;
  placeholder?: string;
}) {
  const { situations } = useDataset();
  const activeSituationId = useDatasetStore((s) => s.activeSituationId);
  const pathname = usePathname();
  const router = useRouter();

  const [value, setValue] = useState("");
  const [open, setOpen] = useState(false);
  const [exchanges, setExchanges] = useState<{ id: string; question: string; reply: CopilotReply }[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const counter = useRef(0);

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  function resolveScenarioId(situationId: string): string {
    const state = useSituationScenarioStore.getState();
    const active = state.activeScenarioId ? state.scenarios[state.activeScenarioId] : undefined;
    if (active && active.situationId === situationId) return active.id;
    return state.createScenario(situationId, "AI scenario", new Date().toISOString());
  }

  function applyAction(action: CopilotAction) {
    switch (action.kind) {
      case "navigate":
        router.push(action.href);
        return;
      case "set_disposition": {
        const dispositions: Record<string, ContributorDisposition> = {};
        for (const id of action.candidateIds) dispositions[id] = action.disposition;
        useDatasetStore.getState().setDispositions(action.situationId, dispositions);
        return;
      }
      case "set_available_hours": {
        // Line hours are plant capacity, not one programme's: they go to the
        // capacity scenario that Scenario Lab's Capacity planning tab reads.
        const capacity = useCapacityScenarioStore.getState();
        const scenarioId =
          capacity.activeScenarioId && capacity.scenarios[capacity.activeScenarioId]
            ? capacity.activeScenarioId
            : capacity.createScenario("AI capacity scenario", new Date().toISOString());
        useCapacityScenarioStore.getState().setAvailableHours(scenarioId, action.lineId, action.period, action.hours);
        return;
      }
      case "set_lead_time": {
        const scenarioId = resolveScenarioId(action.situationId);
        useSituationScenarioStore.getState().setLeadTime(scenarioId, action.materialId, action.days);
        return;
      }
      case "none":
        return;
    }
  }

  function submit(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;

    const ctx: CopilotContext = { situations, activeSituationId, pathname };
    const reply = respond(trimmed, ctx);
    applyAction(reply.action);

    counter.current += 1;
    setExchanges((prev) => [...prev.slice(-9), { id: `ex_${Date.now()}_${counter.current}`, question: trimmed, reply }]);
    setOpen(true);
  }

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const text = value;
          setValue("");
          submit(text);
        }}
        className="flex w-full items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5"
      >
        <Search className="size-3.5 flex-none text-[var(--text-muted)]" />
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onFocus={() => {
            if (exchanges.length > 0) setOpen(true);
          }}
          placeholder={placeholder}
          aria-label="Ask Heizen"
          className="min-w-0 flex-1 bg-transparent text-[13px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
        />
        <VoiceButton onTranscript={(text) => submit(text)} />
        <Button type="submit" size="icon" variant="ghost" aria-label="Send" disabled={value.trim().length === 0}>
          <CornerDownLeft className="size-3.5" />
        </Button>
      </form>

      {open && exchanges.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-40 mt-1 max-h-[min(60vh,480px)] overflow-y-auto rounded-[var(--radius-md)] border border-[var(--border-strong)] bg-[var(--surface-elevated)] shadow-lg">
          <div className="sticky top-0 flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Ask Heizen</span>
            <div className="flex items-center gap-0.5">
              <Button variant="ghost" size="icon" aria-label="Clear conversation" title="Clear" onClick={() => setExchanges([])}>
                <span className="text-[10px]">Clear</span>
              </Button>
              <Button variant="ghost" size="icon" aria-label="Close" onClick={() => setOpen(false)}>
                <X className="size-3.5" />
              </Button>
            </div>
          </div>
          <ol className="flex flex-col gap-3 px-3 py-2.5">
            {exchanges.map((ex) => (
              <li key={ex.id} className="flex flex-col gap-1">
                <div className="text-[12px] font-medium text-[var(--text-secondary)]">{ex.question}</div>
                <div className="text-[12.5px] leading-snug text-[var(--text-primary)]">{ex.reply.text}</div>
                {ex.reply.visualsUpdated.length > 0 ? (
                  <div className="text-[11px] text-[var(--state-scenario)]">
                    Updated: {ex.reply.visualsUpdated.join(", ")}
                  </div>
                ) : ex.reply.unavailable ? (
                  <div className="text-[11px] text-[var(--risk-warning)]">Not available: {ex.reply.unavailable}</div>
                ) : null}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
