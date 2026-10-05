"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { CornerDownLeft, Search, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import { VoiceButton } from "./voice-button";
import { useDataset } from "@/components/dataset/dataset-provider";
import { useDatasetStore } from "@/stores/dataset-store";
import { useScenarioStore } from "@/stores/scenario-store";
import { respond, SUGGESTED_QUESTIONS, type CopilotAction, type CopilotContext, type CopilotReply } from "@/lib/copilot";

/**
 * "Ask Heizen", live on every route.
 *
 * Answers come from `lib/copilot/respond.ts`, grounded only in the
 * `TransitionView`s `useDataset()` already built for the page on screen — a
 * reply here can never disagree with what the page shows.
 *
 * A returned action is executed here, and only here: `navigate` pushes a
 * route; `set_lever` writes the Planning Simulator's draft for one transition
 * (scenario state — the baseline and the dataset are never touched) and opens
 * the simulator on it.
 */
export function AiCommandBar({
  className,
  placeholder = 'Ask Heizen — try "which stores run out before the shipment?"',
}: {
  className?: string;
  placeholder?: string;
}) {
  const { dataset, transitions } = useDataset();
  const overridesByTransition = useDatasetStore((s) => s.overridesByTransition);
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

  function applyAction(action: CopilotAction) {
    switch (action.kind) {
      case "navigate":
        router.push(action.href);
        return;
      case "set_lever":
        useScenarioStore.getState().setLever(action.transitionId, action.key, action.value);
        router.push(`/simulator?transition=${encodeURIComponent(action.transitionId)}`);
        return;
      case "none":
        return;
    }
  }

  function submit(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;

    // Read at submit time rather than via useSearchParams, which would force
    // a Suspense boundary around the whole top bar.
    const query = typeof window === "undefined" ? "" : window.location.search.replace(/^\?/, "");
    const ctx: CopilotContext = {
      transitions,
      dataset,
      overridesByTransition,
      pathname: query ? `${pathname}?${query}` : pathname,
      storeCount: dataset?.stores.length ?? 0,
    };
    const reply = respond(trimmed, ctx);
    applyAction(reply.action);

    counter.current += 1;
    setExchanges((prev) => [...prev.slice(-9), { id: `ex_${counter.current}`, question: trimmed, reply }]);
    setOpen(true);
  }

  const showSuggestions = open && exchanges.length === 0;

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
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          aria-label="Ask Heizen"
          className="min-w-0 flex-1 bg-transparent text-[13px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
        />
        <VoiceButton onTranscript={(text) => submit(text)} />
        <Button type="submit" size="icon" variant="ghost" aria-label="Send" disabled={value.trim().length === 0}>
          <CornerDownLeft className="size-3.5" />
        </Button>
      </form>

      {showSuggestions ? (
        <div className="absolute left-0 right-0 top-full z-40 mt-1 overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-strong)] bg-[var(--surface-elevated)] shadow-lg">
          <div className="border-b border-[var(--border)] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            Try asking
          </div>
          <ul className="py-1">
            {SUGGESTED_QUESTIONS.map((q) => (
              <li key={q}>
                <button
                  type="button"
                  onClick={() => submit(q)}
                  className="w-full px-3 py-1.5 text-left text-[12.5px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--interaction-hover)] hover:text-[var(--text-primary)]"
                  style={{ transitionDuration: "var(--duration-fast)" }}
                >
                  {q}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

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
