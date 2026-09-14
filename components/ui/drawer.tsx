/**
 * A side drawer over the page.
 *
 * Built on the same Radix Dialog as the modal so focus trapping, escape and
 * scroll locking come for free — it only differs in where it sits and which
 * edge it arrives from. Used where the list behind it is still the planner's
 * context and should stay visible.
 */

"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils/cn";

function Drawer(props: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="drawer" {...props} />;
}

function DrawerContent({
  className,
  children,
  title,
  description,
  eyebrow,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** A short status word above the name, when there is one worth leading with. */
  eyebrow?: React.ReactNode;
}) {
  return (
    <DialogPrimitive.Portal>
      {/* Deliberately light: the table behind stays readable, because
          comparing the open item against the list is the point. */}
      <DialogPrimitive.Overlay
        className="fixed inset-0 z-50 bg-black/25 backdrop-blur-[1px] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0"
        style={{ animationDuration: "var(--duration-fast)" }}
      />
      <DialogPrimitive.Content
        data-slot="drawer-content"
        className={cn(
          "fixed right-0 top-0 z-50 flex h-full w-full max-w-[620px] flex-col border-l border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--text-primary)] shadow-2xl",
          "data-[state=open]:animate-in data-[state=open]:slide-in-from-right data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right",
          className
        )}
        style={{
          animationDuration: "var(--duration-medium)",
          animationTimingFunction: "var(--ease-out)",
        }}
        {...props}
      >
        <div className="flex flex-none items-start justify-between gap-3 border-b border-[var(--border)] px-4 py-3.5 sm:gap-4 sm:px-6 sm:py-4">
          <div className="min-w-0">
            {eyebrow ? (
              <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.09em] text-[var(--state-inferred)]">
                {eyebrow}
              </div>
            ) : null}
            {/* The product name is what a planner is looking for first, so it
                is sized to be found rather than merely present. */}
            <DialogPrimitive.Title className="truncate text-[19px] font-semibold tracking-[-0.01em]">
              {title}
            </DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="mt-0.5 truncate text-[12.5px] text-[var(--text-muted)]">
                {description}
              </DialogPrimitive.Description>
            ) : null}
          </div>
          <DialogPrimitive.Close className="-mr-2 -mt-1 grid size-8 flex-none place-items-center rounded-[var(--radius-sm)] text-[var(--text-muted)] transition-colors hover:bg-[var(--interaction-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none">
            <X className="size-4" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export { Drawer, DrawerContent };
