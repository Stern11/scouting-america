/**
 * Asks to save before a planner leaves a scenario with unsaved edits.
 *
 * One hook for both Scenario Lab modes. While the draft is dirty it:
 * - intercepts in-app links (sidebar, tabs, anything rendered as `<a href>`)
 *   with a capture-phase click listener, before Next's `<Link>` sees the click;
 * - lets the caller wrap its own navigation (a programme picker, a scenario
 *   switch) in `guard(proceed)`;
 * - holds one extra history entry at the same URL, so browser Back lands on
 *   it instead of leaving: the pop is caught and the same dialog shown;
 * - sets `beforeunload` so a reload or tab close gets the browser's prompt.
 *
 * The guard entry is pushed once when the draft turns dirty and taken back off
 * (with `history.back()`) as soon as it is clean again or the planner chooses
 * to leave — so a clean page never needs two Backs to leave.
 *
 * The dialog offers Save and leave, Leave without saving (discards the draft)
 * and Stay. Nothing is saved or discarded unless the planner picks it.
 */

"use client";

import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const GUARD_KEY = "__heizenUnsavedGuard";

const onGuardEntry = () =>
  typeof window !== "undefined" && (window.history.state as Record<string, unknown> | null)?.[GUARD_KEY] === true;

export function useUnsavedChangesGuard({
  dirty,
  scenarioName,
  onSave,
  onDiscard,
}: {
  dirty: boolean;
  scenarioName: string | undefined;
  onSave: () => void;
  onDiscard: () => void;
}): { guard: (proceed: () => void) => void; dialog: ReactElement } {
  const router = useRouter();
  const [pending, setPending] = useState<(() => void) | null>(null);
  const dirtyRef = useRef(dirty);
  /** Our guard entry is in history and is the current entry. */
  const guardActive = useRef(false);
  /** Set while our own `history.back()` removes the guard; run on its popstate. */
  const afterRelease = useRef<(() => void) | null>(null);

  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  const guard = useCallback((proceed: () => void) => {
    if (!dirtyRef.current) proceed();
    else setPending(() => proceed);
  }, []);

  /** Takes the guard entry off history, then continues. */
  const releaseGuard = useCallback((then: () => void) => {
    if (guardActive.current && onGuardEntry()) {
      guardActive.current = false;
      afterRelease.current = then;
      window.history.back();
      return;
    }
    guardActive.current = false;
    then();
  }, []);

  // Push the guard while dirty (and not mid-dialog); drop it once clean.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (dirty && pending === null && !guardActive.current && afterRelease.current === null) {
      // Copy Next's own state so its router still recognises the entry.
      window.history.pushState({ ...(window.history.state ?? {}), [GUARD_KEY]: true }, "", window.location.href);
      guardActive.current = true;
    } else if (!dirty && guardActive.current && afterRelease.current === null) {
      releaseGuard(() => {});
    }
  }, [dirty, pending, releaseGuard]);

  useEffect(() => {
    const onPopState = () => {
      const then = afterRelease.current;
      if (then) {
        afterRelease.current = null;
        then();
        return;
      }
      if (onGuardEntry()) {
        // Forward onto our own entry again (after a caught Back).
        guardActive.current = true;
        setPending(null);
        return;
      }
      if (guardActive.current && dirtyRef.current) {
        // Back popped the guard: we are still on this page. Ask, and leave
        // for real only if the planner says so.
        guardActive.current = false;
        setPending(() => () => window.history.back());
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Older browsers need a return value to show the prompt.
      e.returnValue = "";
    };
    const onClick = (e: MouseEvent) => {
      if (!dirtyRef.current || e.defaultPrevented) return;
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = e.target instanceof Element ? e.target.closest("a[href]") : null;
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      // Another site is a full unload — `beforeunload` covers it.
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      e.preventDefault();
      e.stopPropagation();
      setPending(() => () => router.push(`${url.pathname}${url.search}${url.hash}`));
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty, router]);

  const finish = (before: () => void) => {
    const proceed = pending;
    // Mark the release first so the push effect does not re-add the guard.
    releaseGuard(() => proceed?.());
    setPending(null);
    before();
  };

  const dialog = (
    <Dialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
      <DialogContent className="max-w-[calc(100vw-32px)] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Save changes to {scenarioName ?? "this scenario"}?</DialogTitle>
          <DialogDescription>Your edits are not saved yet.</DialogDescription>
        </DialogHeader>
        <div className="mt-2 flex flex-wrap justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setPending(null)}>
            Stay
          </Button>
          <Button variant="ghost" size="sm" onClick={() => finish(onDiscard)}>
            Leave without saving
          </Button>
          <Button size="sm" onClick={() => finish(onSave)}>
            Save and leave
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );

  return { guard, dialog };
}
