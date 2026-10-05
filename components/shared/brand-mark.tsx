/**
 * The product's mark: a compass in a stitched patch, and its name. Built for
 * Scouting America's supply group — it carries their program's look, not a
 * vendor's logo. (Deliberately not the official emblem.)
 */

import { Compass } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export const PRODUCT_NAME = "Scout Shop Planner";
export const PRODUCT_OWNER = "for Scouting America";

export function BrandIcon({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <span
      className={cn("relative grid flex-none place-items-center rounded-full bg-[var(--accent)]", className)}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <span className="absolute inset-[2px] rounded-full border border-dashed border-[var(--text-on-accent)]/40" />
      <Compass className="relative text-[var(--text-on-accent)]" style={{ width: size * 0.56, height: size * 0.56 }} strokeWidth={2} />
    </span>
  );
}

export function BrandMark({ showOwner = true, size = 28 }: { showOwner?: boolean; size?: number }) {
  return (
    <span className="flex items-center gap-2.5">
      <BrandIcon size={size} />
      <span className="min-w-0 leading-tight">
        <span className="block truncate text-[14px] font-semibold tracking-tight text-[var(--text-primary)]">{PRODUCT_NAME}</span>
        {showOwner ? <span className="block truncate text-[10.5px] text-[var(--text-muted)]">{PRODUCT_OWNER}</span> : null}
      </span>
    </span>
  );
}
