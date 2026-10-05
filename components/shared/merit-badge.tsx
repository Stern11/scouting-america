/**
 * Product badges in the shape every Scout knows: a round, stitched patch.
 *
 * The icon says what the product is (shirt, neckerchief, derby car, tent);
 * the embroidered ring says how its transition is going, in the status
 * colours — so a row reads at a glance before any number is read.
 */

import {
  Award,
  Backpack,
  BookOpen,
  Car,
  Compass,
  Flag,
  Flame,
  Footprints,
  Gift,
  Medal,
  Ribbon,
  Sailboat,
  Shirt,
  Tag,
  Tent,
  type LucideIcon,
} from "lucide-react";
import type { TransitionStatus } from "@/types/transition";
import { cn } from "@/lib/utils/cn";

const BY_KEYWORD: [RegExp, LucideIcon][] = [
  [/neckerchief|slide|colors/i, Ribbon],
  [/derby|car kit|wheel|weights/i, Car],
  [/regatta|sea scout/i, Sailboat],
  [/sock/i, Footprints],
  [/handbook|pamphlet|fieldbook/i, BookOpen],
  [/medal|pin|knot/i, Medal],
  [/patch|emblem|strip|numeral|insignia|loop/i, Award],
  [/tent|sleeping|chair/i, Tent],
  [/pack/i, Backpack],
  [/compass|headlamp|knife/i, Compass],
  [/fire|stove|mess/i, Flame],
  [/flag/i, Flag],
  [/blanket|mug|tote|lanyard|keychain|sticker/i, Gift],
  [/shirt|pants|shorts|hat|cap|belt|hoodie|jacket|tee|beanie|uniform/i, Shirt],
];

const BY_CATEGORY: Record<string, LucideIcon> = {
  Uniforms: Shirt,
  "Uniform Accessories": Ribbon,
  Patches: Award,
  Literature: BookOpen,
  "Program Kits": Car,
  Camping: Tent,
  "Non-uniform Apparel": Shirt,
  Gifts: Gift,
  Awards: Medal,
  "Unit Supplies": Flag,
};

export function productIcon(name: string, category?: string): LucideIcon {
  for (const [re, icon] of BY_KEYWORD) if (re.test(name)) return icon;
  return (category && BY_CATEGORY[category]) || Tag;
}

const RING: Record<TransitionStatus, string> = {
  ACTION_NEEDED: "var(--risk-critical)",
  MONITOR: "var(--risk-warning)",
  TRANSITIONING: "var(--accent)",
  HEALTHY: "var(--risk-positive)",
  COMPLETE: "var(--state-unknown)",
};

export function MeritBadge({
  name,
  category,
  status,
  size = 48,
  className,
}: {
  name: string;
  category?: string;
  status: TransitionStatus;
  size?: number;
  className?: string;
}) {
  const Icon = productIcon(name, category);
  const ring = RING[status];
  return (
    <span
      className={cn("relative grid flex-none place-items-center rounded-full", className)}
      style={{
        width: size,
        height: size,
        background: `radial-gradient(circle at 35% 30%, var(--surface) 0%, var(--lineage-legacy-soft) 70%)`,
        boxShadow: `0 0 0 3px ${ring}, 0 1px 3px rgb(0 0 0 / 0.12)`,
      }}
      aria-hidden
    >
      {/* The stitching: a dashed ring just inside the border. */}
      <span
        className="absolute rounded-full"
        style={{ inset: 3, border: `1.5px dashed color-mix(in oklch, ${ring} 55%, transparent)` }}
      />
      <Icon className="relative text-[var(--text-primary)]" style={{ width: size * 0.42, height: size * 0.42 }} strokeWidth={1.75} />
    </span>
  );
}
