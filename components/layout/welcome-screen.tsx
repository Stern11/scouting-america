"use client";

/**
 * Welcome and sign-in (PRD §10.1).
 *
 * Intent: a supply planner opening this for the first time, probably from a
 * link someone sent them. What must they do — understand in one breath what
 * this is for, and get in. It should feel like the quiet front door of a
 * working tool, not a marketing page.
 *
 * Hierarchy: the promise leads at 36px; the three things the product does are
 * demoted to a supporting row; the sign-in card is the only element with a
 * surface and a border, so the eye lands on it last and knows what to click.
 *
 * The sign-in is deliberately a *demo* session. The house rules rule out real
 * auth, and nothing here gates data — an uploaded workbook never leaves the
 * browser, so there is nothing on a server to protect. Wiring a real identity
 * provider later means populating the same store from a callback.
 */

import { BrandMark } from "@/components/shared/brand-mark";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRightLeft, LogIn, ShieldCheck, Store } from "lucide-react";
import { signIn as oauthSignIn } from "next-auth/react";
import { useCurrentUser } from "@/components/layout/use-current-user";
import { cn } from "@/lib/utils/cn";

function Welcome() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Where they were headed before the front door intercepted them.
  const next = searchParams.get("next");
  const { user, loading } = useCurrentUser();
  const [busy, setBusy] = useState(false);

  // Already signed in: this screen has nothing to ask.
  useEffect(() => {
    if (!loading && user) router.replace(next ?? "/start");
  }, [loading, user, next, router]);

  const continueWithDemo = () => {
    setBusy(true);
    void oauthSignIn("demo", { callbackUrl: next ?? "/start" });
  };

  // Google sign-in is switched off for now. To restore it, re-enable the
  // provider in `auth.ts`, pass `googleEnabled` back in from the page, and
  // bring back the button and notice commented out below.
  // const continueWithGoogle = () => {
  //   setBusy(true);
  //   void oauthSignIn("google", { callbackUrl: next ?? "/start" });
  // };

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--background)] px-5 py-10 sm:px-8 sm:py-16">
      <div className="grid w-full max-w-[980px] gap-10 lg:grid-cols-[1.15fr_auto] lg:items-center lg:gap-14">
        {/* ---------------- the promise ---------------- */}
        <div>
          <div className="mb-7 flex items-center gap-2.5">
            <BrandMark size={32} />
          </div>

          <h1 className="max-w-[520px] text-[28px] font-semibold leading-[1.15] tracking-[-0.025em] text-[var(--text-primary)] sm:text-[36px]">
            Plan across product transitions, not just individual SKUs.
          </h1>
          <p className="mt-4 max-w-[520px] text-[15px] leading-relaxed text-[var(--text-secondary)]">
            JDA sees an old SKU and a new one. Your business sees the same shirt. This planner treats them as
            one continuous product — demand, inventory and replenishment.
          </p>

          <ul className="mt-9 flex flex-col gap-4">
            <Point icon={ArrowRightLeft} title="Carry demand across the SKU change">
              Years of legacy history become the successor&rsquo;s baseline — counted once, never twice.
            </Point>
            <Point icon={Store} title="See usable stock across every store">
              Legacy units that can still sell, where they sit, and which stores run out first.
            </Point>
            <Point icon={ShieldCheck} title="Order, hold or transfer — with the math shown">
              Every recommendation shows its calculation. Your data is never rewritten.
            </Point>
          </ul>
        </div>

        {/* ---------------- the door ---------------- */}
        <div className="w-full lg:w-[352px]">
          <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-6">
            <h2 className="text-[16px] font-semibold tracking-tight text-[var(--text-primary)]">
              Sign in
            </h2>
            <p className="mt-1 text-[12.5px] leading-snug text-[var(--text-muted)]">
              You will land on a full planning dataset. Nothing you load leaves your browser.
            </p>

            <button
              type="button"
              onClick={continueWithDemo}
              disabled={busy}
              className={cn(
                "mt-5 flex h-11 w-full items-center justify-center gap-2.5 rounded-[var(--radius-sm)] bg-[var(--accent)] text-[14px] font-medium text-[var(--text-on-accent)] transition-opacity",
                "hover:opacity-90 active:scale-[0.99]",
                "disabled:cursor-not-allowed disabled:opacity-60"
              )}
              style={{ transitionDuration: "var(--duration-fast)" }}
            >
              <LogIn className="size-4" />
              {busy ? "Signing in…" : "Continue with demo account"}
            </button>

            {/* Google sign-in — disabled for now.
            <button
              type="button"
              onClick={continueWithGoogle}
              disabled={busy || !googleEnabled}
              className={cn(
                "mt-5 flex h-11 w-full items-center justify-center gap-3 rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--surface-elevated)] text-[14px] font-medium text-[var(--text-primary)] transition-colors",
                "hover:bg-[var(--interaction-hover)] active:scale-[0.99]",
                "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-[var(--surface-elevated)]"
              )}
              style={{ transitionDuration: "var(--duration-fast)" }}
            >
              <GoogleMark />
              {busy ? "Redirecting to Google…" : "Continue with Google"}
            </button>
            */}

            <p className="mt-5 border-t border-[var(--border)] pt-4 text-[11.5px] leading-relaxed text-[var(--text-muted)]">
              A shared demo account on synthetic data. Anything you upload is read in this browser
              and never sent anywhere.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}

function Point({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Store;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-3.5">
      <Icon className="mt-0.5 size-4 flex-none text-[var(--text-muted)]" />
      <div className="min-w-0">
        <div className="text-[13.5px] font-medium text-[var(--text-primary)]">{title}</div>
        <div className="mt-0.5 text-[12.5px] leading-snug text-[var(--text-muted)]">{children}</div>
      </div>
    </li>
  );
}

/** Google's mark, drawn rather than imported so nothing is hotlinked. Unused while Google sign-in is off. */
export function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="size-4" aria-hidden focusable="false">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

export function WelcomeScreen() {
  // `useSearchParams` needs a Suspense boundary around whatever reads it.
  return (
    <Suspense fallback={<main className="min-h-screen bg-[var(--background)]" />}>
      <Welcome />
    </Suspense>
  );
}
