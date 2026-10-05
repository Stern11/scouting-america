"use client";

/**
 * First run (V2 §9).
 *
 * Two choices, no wizard. A planner should be inside the product in one click,
 * and every configuration decision that can be deferred is deferred.
 */

import { useRouter } from "next/navigation";
import { ArrowRight, FileSpreadsheet, RefreshCw, Sparkles } from "lucide-react";
import { useDatasetStore } from "@/stores/dataset-store";
import { cn } from "@/lib/utils/cn";

export default function StartPage() {
  const router = useRouter();
  const chooseDemo = useDatasetStore((s) => s.chooseDemo);
  const regenerateDemo = useDatasetStore((s) => s.regenerateDemo);
  const mode = useDatasetStore((s) => s.mode);
  const seed = useDatasetStore((s) => s.seed);
  const hasHydrated = useDatasetStore((s) => s.hasHydrated);

  const startDemo = () => {
    chooseDemo();
    router.push("/overview");
  };

  // A fresh seed produces a different but equally coherent dataset (V2 §11).
  // The timestamp is only a seed *source* — the generator itself stays fully
  // deterministic, so the new dataset is reproducible from the stored seed.
  const regenerate = () => {
    regenerateDemo(`demo-${Date.now().toString(36)}`);
    router.push("/overview");
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--background)] px-5 py-12 sm:px-8 sm:py-16">
      <div className="w-full max-w-[860px]">
        <div className="mb-10">
          <div className="mb-5 flex items-center gap-2.5">
            <span className="grid size-6 place-items-center rounded-[5px] bg-[var(--accent)] text-[12px] font-bold text-[var(--text-on-accent)]">
              H
            </span>
            <span className="text-[14px] font-semibold tracking-tight text-[var(--text-primary)]">Heizen</span>
          </div>
          <h1 className="max-w-[640px] text-[30px] font-semibold leading-tight tracking-[-0.02em] text-[var(--text-primary)]">
            Plan across product transitions, not just individual SKUs.
          </h1>
          <p className="mt-2 max-w-[600px] text-[14px] leading-relaxed text-[var(--text-secondary)]">
            Connect legacy and replacement products, carry demand history forward, reconcile inventory across your
            network, and know what to replenish before stockouts or excess inventory appear.
          </p>
          <p className="mt-3 text-[12.5px] text-[var(--text-muted)]">
            Built for product transitions across JDA and your store network.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Choice
            icon={<Sparkles className="size-4" />}
            title="Explore Scouting America demo"
            body="A synthetic 120-store network mid-rebrand: legacy and Scouting America SKUs selling side by side."
            cta="Start exploring"
            onClick={startDemo}
            primary
          />
          <Choice
            icon={<FileSpreadsheet className="size-4" />}
            title="Use your own data"
            body="Download the template, paste in your JDA exports — SKUs, stores, sales, inventory — and upload it."
            cta="Set up your data"
            onClick={() => router.push("/start/upload")}
          />
        </div>

        {hasHydrated && mode !== null ? (
          <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px]">
            <button
              type="button"
              onClick={() => router.push("/overview")}
              className="text-[var(--text-muted)] underline underline-offset-4 hover:text-[var(--text-primary)]"
            >
              Keep working with the current dataset
            </button>
            {mode === "DEMO" ? (
              <button
                type="button"
                onClick={regenerate}
                title={`Current seed: ${seed}`}
                className="flex items-center gap-1.5 text-[var(--text-muted)] underline underline-offset-4 hover:text-[var(--text-primary)]"
              >
                <RefreshCw className="size-3" />
                Generate a different demo dataset
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Choice({
  icon,
  title,
  body,
  cta,
  onClick,
  primary,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  cta: string;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex h-full flex-col items-start rounded-[var(--radius-lg)] border bg-[var(--surface)] p-5 text-left transition-all sm:p-6",
        primary
          ? "border-[var(--accent)]/35 hover:border-[var(--accent)] hover:shadow-[0_1px_16px_-6px_var(--accent)]"
          : "border-[var(--border)] hover:border-[var(--border-strong)]"
      )}
    >
      <span
        className={cn(
          "mb-4 grid size-8 place-items-center rounded-[var(--radius-sm)]",
          primary
            ? "bg-[var(--accent-soft)] text-[var(--accent)]"
            : "bg-[var(--surface-sunken)] text-[var(--text-secondary)]"
        )}
      >
        {icon}
      </span>
      <span className="text-[16px] font-semibold tracking-tight text-[var(--text-primary)]">{title}</span>
      <span className="mt-1.5 flex-1 text-[13px] leading-relaxed text-[var(--text-secondary)]">{body}</span>
      <span
        className={cn(
          "mt-5 inline-flex items-center gap-1.5 text-[13px] font-medium",
          primary ? "text-[var(--accent)]" : "text-[var(--text-primary)]"
        )}
      >
        {cta}
        <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
      </span>
    </button>
  );
}
