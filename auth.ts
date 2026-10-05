/**
 * Sign-in (Auth.js v5).
 *
 * For now the product signs in with a demo account only. Google sign-in is
 * kept below, commented out, so it can be switched back on without
 * re-deriving the wiring: restore the provider, restore the button in
 * `components/layout/welcome-screen.tsx`, and set the credentials below.
 *
 * Identity still comes from one place — the Auth.js session — so storage
 * scoping (`lib/utils/storage-scope.ts`) and the account menu work exactly as
 * they did with Google. Planning data, including every uploaded workbook,
 * still parses and stays in the planner's own browser.
 *
 * Environment:
 *   AUTH_SECRET         — signs the session cookie (`npx auth secret`).
 *                         Required in production; development falls back to a
 *                         local-only value so the demo runs without setup.
 *   AUTH_GOOGLE_ID      — OAuth client id      (Google, currently disabled)
 *   AUTH_GOOGLE_SECRET  — OAuth client secret  (Google, currently disabled)
 */

import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
// import Google from "next-auth/providers/google";

/**
 * The one identity the demo signs in as: the planner persona of the Scouting
 * America walkthrough. A shared demo account — it authenticates nothing.
 */
export const DEMO_ACCOUNT = {
  id: "demo-planner",
  name: "James",
  email: "demo.planner@heizen.demo",
} as const;

// /** True only when the deployment is actually configured for Google. */
// export const googleConfigured =
//   Boolean(process.env.AUTH_GOOGLE_ID) && Boolean(process.env.AUTH_GOOGLE_SECRET);

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    // googleConfigured ? Google : undefined,
    Credentials({
      id: "demo",
      name: "Demo account",
      credentials: {},
      // No password: the demo account is a shared, synthetic persona, and
      // nothing on a server is gated by it.
      authorize: async () => ({ ...DEMO_ACCOUNT }),
    }),
  ],
  secret:
    process.env.AUTH_SECRET ??
    (process.env.NODE_ENV === "production" ? undefined : "heizen-local-demo-secret-not-for-production"),
  // A JWT session keeps this stateless: there is no database in this product
  // and adding one to hold sessions would be the first thing that made a
  // planner's work live somewhere other than their own machine.
  session: { strategy: "jwt" },
  pages: { signIn: "/welcome" },
  callbacks: {
    // A session issued before the persona was renamed still carries the old
    // name in its token; the demo account always reads as the current persona.
    async session({ session, token }) {
      if (token.sub === DEMO_ACCOUNT.id && session.user) session.user.name = DEMO_ACCOUNT.name;
      return session;
    },
    // Trust only our own paths, so a crafted `callbackUrl` cannot bounce a
    // planner off to somewhere else after signing in.
    async redirect({ url, baseUrl }) {
      if (url.startsWith("/")) return `${baseUrl}${url}`;
      try {
        if (new URL(url).origin === baseUrl) return url;
      } catch {
        /* not a URL — fall through to the safe default */
      }
      return `${baseUrl}/start`;
    },
  },
});
