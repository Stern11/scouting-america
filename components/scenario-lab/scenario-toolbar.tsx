/**
 * Scenario bookkeeping for either Scenario Lab mode (V2 §13.3).
 *
 * What the scenario is *about* — a programme picker, a plant picker — is the
 * caller's `context`. Everything else is the same in both modes: switch,
 * rename, duplicate, reset, delete, and save or discard the draft. Demand and
 * capacity scenarios live in separate stores, so the caller passes its own
 * list and handlers.
 *
 * Desktop shows every action in one row. On a phone the row keeps only what
 * the planner needs every time — context, scenario, save state — and folds
 * new / duplicate / reset / delete into an overflow menu.
 */

"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Check, Copy, MoreHorizontal, Plus, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils/cn";

export interface ToolbarScenario {
  id: string;
  name: string;
}

export function ScenarioToolbar({
  context,
  scenarios,
  activeScenario,
  changeCount,
  dirty,
  onSave,
  onDiscard,
  onCreate,
  onSelect,
  onRename,
  onDuplicate,
  onResetAll,
  onDelete,
}: {
  context: ReactNode;
  scenarios: ToolbarScenario[];
  activeScenario: ToolbarScenario | undefined;
  changeCount: number;
  /** The draft differs from the saved snapshot. */
  dirty: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onCreate: () => void;
  onSelect: (scenarioId: string) => void;
  onRename: (name: string) => void;
  onDuplicate: () => void;
  onResetAll: () => void;
  onDelete: () => void;
}) {
  const [nameText, setNameText] = useState(activeScenario?.name ?? "");
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    setNameText(activeScenario?.name ?? "");
  }, [activeScenario?.id, activeScenario?.name]);

  const secondary = [
    { label: "New scenario", icon: Plus, onClick: onCreate },
    { label: "Duplicate", icon: Copy, onClick: onDuplicate },
    { label: "Reset all changes", icon: RotateCcw, onClick: onResetAll, disabled: changeCount === 0 },
    { label: "Delete scenario", icon: Trash2, onClick: onDelete, destructive: true },
  ];

  const status = (
    <span className="inline-flex h-7 flex-none items-center whitespace-nowrap text-[12px] tabular-nums text-[var(--text-muted)]">
      {changeCount} change{changeCount === 1 ? "" : "s"}
    </span>
  );

  return (
    <div className="border-b border-[var(--border)] bg-[var(--surface)]">
      <div className="mx-auto flex w-full max-w-[1360px] flex-col gap-2 px-4 py-2.5 sm:px-8 md:flex-row md:items-center md:justify-between md:gap-4">
        <div className="flex min-w-0 items-center gap-3 md:flex-1">{context}</div>

        {!activeScenario ? (
          <Button size="sm" onClick={onCreate} className="self-start md:self-auto">
            <Plus />
            New scenario
          </Button>
        ) : (
          <div className="flex min-w-0 items-center gap-2">
            {scenarios.length > 1 ? (
              <Select value={activeScenario.id} onValueChange={onSelect}>
                <SelectTrigger className="h-7 w-[116px] flex-none sm:w-[160px]" aria-label="Switch scenario">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {scenarios.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}

            <input
              value={nameText}
              aria-label="Scenario name"
              title={activeScenario.name}
              onChange={(e) => setNameText(e.target.value)}
              onBlur={() => {
                const trimmed = nameText.trim();
                if (trimmed && trimmed !== activeScenario.name) onRename(trimmed);
                else setNameText(activeScenario.name);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              className="h-7 w-0 min-w-0 flex-1 truncate rounded-[var(--radius-sm)] border border-transparent bg-transparent px-1.5 text-[13px] font-medium text-[var(--text-primary)] outline-none transition-colors hover:border-[var(--border)] focus:border-[var(--border-strong)] focus:bg-[var(--surface-sunken)] md:w-[150px] md:flex-none"
            />

            <span className="hidden md:inline">{status}</span>

            {/* Saved is a state, not an action: quiet text rather than a
                greyed-out primary button that looks broken. */}
            {dirty ? (
              <>
                <Button variant="ghost" size="sm" onClick={onDiscard} title="Discard changes" className="flex-none">
                  Discard
                </Button>
                <Button size="sm" onClick={onSave} title="Save scenario" className="flex-none">
                  <Check />
                  Save
                </Button>
              </>
            ) : (
              <span className="inline-flex h-7 flex-none items-center gap-1 px-1 text-[12px] text-[var(--text-secondary)]">
                <Check className="size-3.5 text-[var(--risk-positive)]" aria-hidden />
                Saved
              </span>
            )}

            <span className="mx-1 hidden h-4 w-px flex-none bg-[var(--border)] md:block" aria-hidden />

            <div className="hidden items-center gap-0.5 md:flex">
              {secondary.map((a) => (
                <Button
                  key={a.label}
                  variant="ghost"
                  size="icon"
                  onClick={a.onClick}
                  disabled={a.disabled}
                  title={a.label}
                  aria-label={a.label}
                >
                  <a.icon />
                </Button>
              ))}
            </div>

            <Popover open={menuOpen} onOpenChange={setMenuOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="flex-none md:hidden"
                  aria-label="More scenario actions"
                >
                  <MoreHorizontal />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-52 p-1">
                <div className="px-2 pb-1.5 pt-1 text-[11px] text-[var(--text-muted)]">{status}</div>
                {secondary.map((a) => (
                  <button
                    key={a.label}
                    type="button"
                    disabled={a.disabled}
                    onClick={() => {
                      setMenuOpen(false);
                      a.onClick();
                    }}
                    className={cn(
                      "flex h-9 w-full items-center gap-2.5 rounded-[var(--radius-sm)] px-2 text-left text-[13px] transition-colors hover:bg-[var(--interaction-hover)] disabled:pointer-events-none disabled:opacity-50",
                      a.destructive ? "text-[var(--risk-critical)]" : "text-[var(--text-primary)]"
                    )}
                    style={{ transitionDuration: "var(--duration-fast)" }}
                  >
                    <a.icon className="size-3.5 flex-none" aria-hidden />
                    {a.label}
                  </button>
                ))}
              </PopoverContent>
            </Popover>
          </div>
        )}
      </div>
    </div>
  );
}
