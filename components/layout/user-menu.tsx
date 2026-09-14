"use client";

/**
 * Who is signed in, and how to leave.
 *
 * Small on purpose: in a single-persona product the account menu is
 * orientation, not a destination. It says which session you are in — which
 * matters once someone has signed in as themselves and wants to know the
 * numbers on screen are theirs — and gives one way out.
 */

import { useState } from "react";
import { LogOut, Trash2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils/cn";
import { signOut as oauthSignOut } from "next-auth/react";
import { useCurrentUser } from "./use-current-user";
import { removePlanningDataForAccount } from "@/stores/storage-scope";

export function UserMenu({ collapsed = false }: { collapsed?: boolean }) {
  const { user } = useCurrentUser();
  const [removing, setRemoving] = useState(false);

  const signOutAndRemove = async () => {
    setRemoving(true);
    await removePlanningDataForAccount();
    await oauthSignOut({ callbackUrl: "/welcome" });
  };

  if (!user) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        {/* Collapsed, the avatar is the whole control. Expanded, the name and
            email come with it — an account row that shows only initials in a
            208px column is withholding for no reason. */}
        <button
          type="button"
          aria-label={`Signed in as ${user.name}`}
          title={collapsed ? user.name : undefined}
          className={cn(
            "flex items-center rounded-[var(--radius-sm)] text-left transition-colors hover:bg-[var(--interaction-hover)]",
            collapsed ? "size-8 justify-center" : "min-w-0 flex-1 gap-2.5 px-1.5 py-1"
          )}
          style={{ transitionDuration: "var(--duration-fast)" }}
        >
          <span className="grid size-7 flex-none place-items-center rounded-full bg-[var(--accent-soft)] text-[11px] font-semibold text-[var(--accent)]">
            {user.initials}
          </span>
          {!collapsed ? (
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] font-medium leading-tight text-[var(--text-primary)]">
                {user.name}
              </span>
              <span className="block truncate text-[11px] leading-tight text-[var(--text-muted)]">
                {user.email}
              </span>
            </span>
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-[248px] p-0">
        <div className="border-b border-[var(--border)] px-3.5 py-3">
          <div className="truncate text-[13px] font-medium text-[var(--text-primary)]">
            {user.name}
          </div>
          <div className="truncate text-[11.5px] text-[var(--text-muted)]">{user.email}</div>
          {/* Never let a demo session read as a real one. */}
          <div className="mt-1.5 text-[11px] text-[var(--text-muted)]">
            Demo account · your planning data stays in this browser
          </div>
        </div>
        <button
          type="button"
          onClick={() => void oauthSignOut({ callbackUrl: "/welcome" })}
          className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-[12.5px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--interaction-hover)] hover:text-[var(--text-primary)]"
          style={{ transitionDuration: "var(--duration-fast)" }}
        >
          <LogOut className="size-3.5" />
          Sign out
        </button>
        <button
          type="button"
          disabled={removing}
          onClick={() => void signOutAndRemove()}
          className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-[12.5px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--interaction-hover)] hover:text-[var(--text-primary)] disabled:opacity-60"
          style={{ transitionDuration: "var(--duration-fast)" }}
        >
          <Trash2 className="size-3.5" />
          Sign out and remove my data
        </button>
        <p className="border-t border-[var(--border)] px-3.5 py-2.5 text-[11px] leading-snug text-[var(--text-muted)]">
          Your dataset, decisions and scenarios stay in this browser for your account only.
        </p>
      </PopoverContent>
    </Popover>
  );
}
