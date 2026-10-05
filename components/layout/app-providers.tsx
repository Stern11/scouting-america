"use client";

import { useEffect } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SessionProvider, useSession } from "next-auth/react";
import { useSessionStore } from "@/stores/session-store";
import { useAppStore, THEME_STORAGE_KEY } from "@/stores/app-store";
import { bindPlanningStorage } from "@/stores/storage-scope";
import { namespaceFor } from "@/lib/utils/storage-scope";
import { DatasetProvider } from "@/components/dataset/dataset-provider";

/**
 * Applied by the browser BEFORE first paint, so a dark-theme planner never
 * sees a light flash on a full document load. It only touches a class React
 * does not manage (`<html>` already carries `suppressHydrationWarning`), so it
 * cannot cause a hydration mismatch. The string is a constant, therefore
 * byte-identical in the server-rendered HTML and on the client.
 */
const THEME_BOOT_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});if(!t){t=window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";}document.documentElement.classList.toggle("dark",t==="dark");}catch(e){}})();`;

export function AppProviders({ children }: { children: React.ReactNode }) {
  const initTheme = useAppStore((s) => s.initTheme);

  useEffect(() => {
    // Rehydrate AFTER React has hydrated. Both stores are configured with
    // `skipHydration: true`, so the first client render used exactly the
    // defaults the server rendered; restored scenario overrides and triage
    // decisions arrive on the next commit rather than diverging mid-hydration.
    //
    // This is what makes simulator work survive navigation: the stores are
    // module singletons, so a client-side route change already kept them, but
    // any full document load started from seed data every time — and Save,
    // which only flipped an in-memory status, was thrown away with it.
    // The dataset store persists to localStorage rather than the session, so
    // the planner's chosen mode survives a refresh instead of sending them
    // back to the first-run screen.
    //
    // The dataset and scenario stores are the exception: their keys belong to
    // the signed-in account, so `PlanningStorageScope` rehydrates them once
    // the session says who that is.
    void useSessionStore.persist.rehydrate();
    // Theme lives in localStorage rather than the session slice (it is a
    // durable preference), so it is restored separately and re-applied to the
    // store so the toggle's icon matches what is actually on screen.
    initTheme();
  }, [initTheme]);

  return (
    // `SessionProvider` outermost: it is the only thing here that can be
    // waiting on the network, and everything below reads identity through it.
    <SessionProvider>
      <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      <PlanningStorageScope />
      <TooltipProvider>
        <DatasetProvider>{children}</DatasetProvider>
      </TooltipProvider>
    </SessionProvider>
  );
}

/**
 * Points planning persistence at the signed-in account. Two accounts on one
 * browser each see only their own dataset, decisions and scenarios.
 */
function PlanningStorageScope() {
  const { data, status } = useSession();
  const email = data?.user?.email ?? null;

  useEffect(() => {
    // Waiting matters: binding to "nobody" while the session is still loading
    // would drop a returning planner onto the first-run screen for a moment.
    if (status === "loading") return;
    void bindPlanningStorage(email ? namespaceFor(email) : null);
  }, [status, email]);

  return null;
}
