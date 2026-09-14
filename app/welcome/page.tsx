/**
 * The front door.
 *
 * Sign-in is a demo account for now. When Google comes back, this page reads
 * `googleConfigured` from `@/auth` again — that value must come from the
 * server, because `AUTH_GOOGLE_ID` is not, and should not be, readable in the
 * browser.
 */

// import { googleConfigured } from "@/auth";
import { WelcomeScreen } from "@/components/layout/welcome-screen";

export default function WelcomePage() {
  return <WelcomeScreen />;
}
