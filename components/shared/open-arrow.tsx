/**
 * The one way into a card: a small round arrow. The card itself is not a
 * link, so reading it — or selecting its text — never navigates by accident.
 */

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export function OpenArrow({ href, label, className }: { href: string; label: string; className?: string }) {
  return (
    <Link
      href={href}
      aria-label={label}
      title={label}
      className={cn(
        "grid size-8 flex-none place-items-center rounded-full border border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)] hover:bg-[var(--accent)] hover:text-[var(--text-on-accent)]",
        className
      )}
      style={{ transitionDuration: "var(--duration-fast)" }}
    >
      <ArrowRight className="size-3.5" />
    </Link>
  );
}
