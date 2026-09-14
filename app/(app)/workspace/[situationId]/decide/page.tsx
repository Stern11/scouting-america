import { redirect } from "next/navigation";

/**
 * A programme no longer has its own Decide step. Everything a reconcile
 * action creates is handled on Decisions, so an old link lands there, scoped
 * to the programme it came from.
 */
export default async function DecideRedirect({ params }: { params: Promise<{ situationId: string }> }) {
  const { situationId } = await params;
  redirect(`/decisions?programme=${encodeURIComponent(situationId)}`);
}
