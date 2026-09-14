/**
 * What a planner has to decide, and by when (V2 §49-50).
 *
 * Decisions used to open on "Runway remaining: 10 weeks" with nothing
 * saying whose runway that was. A date with no subject is not a decision — it
 * is a number a planner has to go and reconstruct the meaning of.
 *
 * Every row here names three things: the thing being decided, the date it
 * stops being reversible, and the products that put it there. All of it is
 * read from the contributor lists the engine already recorded, so a decision
 * and the item pages behind it cannot disagree.
 *
 * Pure: no React.
 */

import type {
  MaterialRelease,
  PlanningSituation,
  SituationOverrides,
  VolumeCommitment,
} from "@/types/situation";
import { isUndecided, skuCounts } from "./horizon";

export type DecisionKind = "material_order" | "line_capacity" | "production_start" | "representation";

export type DecisionUrgency = "overdue" | "urgent" | "soon" | "later";

export interface PendingDecision {
  id: string;
  kind: DecisionKind;
  /** Set for decisions the planner can settle here rather than elsewhere. */
  materialId?: string;
  /** The component's own name, for a material decision. */
  materialName?: string;
  /** Quantity and unit, for a decision that is an order. */
  quantity?: number;
  uom?: string;
  /** True once the planner has released it. */
  released?: boolean;
  releasedAt?: string;
  /** The supplier it was awarded to, when the planner chose one. */
  releasedTo?: string;
  /** What is being decided, in the planner's words. */
  title: string;
  /** The date it stops being reversible. Absent for undated work. */
  date?: string;
  /**
   * What that date is — "Order by", "Resolve by", "Starts". A bare date on a
   * list of mixed decisions left the planner guessing which kind it was.
   */
  dateLabel: string;
  weeksAway?: number;
  urgency: DecisionUrgency;
  /** One line saying what happens at that date. */
  consequence: string;
  /** The products that put this decision on the calendar. */
  drivenBy: string[];
  /** Where the planner goes to act on it. */
  href: string;
  cta: string;
}

/** Inside this many weeks a decision is effectively being made now. */
const URGENT_WEEKS = 4;
const SOON_WEEKS = 12;

export function urgencyOf(weeksAway: number | undefined): DecisionUrgency {
  if (weeksAway === undefined) return "later";
  if (weeksAway <= 0) return "overdue";
  if (weeksAway <= URGENT_WEEKS) return "urgent";
  if (weeksAway <= SOON_WEEKS) return "soon";
  return "later";
}

/**
 * Every dated commitment this situation implies, soonest first.
 *
 * Components a planner cannot act on yet are deliberately included, marked by
 * what is blocking them — an undecided item is itself a decision, and hiding
 * the dates it is holding up is how a deadline arrives unannounced.
 */
export function pendingDecisions(
  situation: PlanningSituation,
  releases: Readonly<Record<string, { releasedAt: string; supplierName?: string }>> = {}
): PendingDecision[] {
  const out: PendingDecision[] = [];
  const { materialExposure, capacityExposure, runway, bridge, candidateItems } = situation;

  /* ---- materials: the usual first thing to become irreversible ---- */
  if (materialExposure.available) {
    for (const row of materialExposure.rows) {
      if (row.status === "WAIT") continue;
      const drivers = [...row.contributors]
        .sort((a, b) => b.requirement - a.requirement)
        .slice(0, 3)
        .map((c) => c.itemName);

      const release = releases[row.materialId];
      out.push({
        id: `material:${row.materialId}`,
        kind: "material_order",
        materialId: row.materialId,
        materialName: row.materialName,
        quantity: row.netRequirement ?? row.requirementBase,
        uom: row.uom,
        released: release !== undefined,
        releasedAt: release?.releasedAt,
        releasedTo: release?.supplierName,
        title: `Order ${row.materialName}`,
        date: row.decisionDate,
        dateLabel: "Order by",
        weeksAway: row.weeksToDecision,
        urgency: release ? "later" : urgencyOf(row.weeksToDecision),
        consequence:
          row.leadTimeDays > 0
            ? `Arrives ${row.leadTimeDays} days after ordering`
            : "Needed before the build starts",
        drivenBy: drivers,
        href: `/workspace/${situation.id}/reconcile`,
        cta: "See the items",
      });
    }
  }

  /* ---- capacity: the month a line stops fitting ---- */
  if (capacityExposure.available) {
    const breaching = capacityExposure.cells
      .filter((c) => c.effectiveUtilization > c.targetUtilizationPct && c.unresolvedHours > 0)
      .sort((a, b) => a.period.localeCompare(b.period));

    const first = breaching[0];
    if (first) {
      const drivers = [...first.contributors]
        .sort((a, b) => b.hours - a.hours)
        .slice(0, 3)
        .map((c) => c.itemName);
      const monthStart = `${first.period}-01`;
      const marker = runway.markers.find((m) => m.kind === "capacity_decision");

      out.push({
        id: `capacity:${first.lineId}:${first.period}`,
        kind: "line_capacity",
        title: `Resolve load on ${first.lineName}`,
        date: monthStart,
        dateLabel: "Resolve by",
        weeksAway: marker?.weeksAway,
        urgency: urgencyOf(marker?.weeksAway),
        consequence: `Runs at ${Math.round(first.effectiveUtilization * 100)}% against a ${Math.round(
          first.targetUtilizationPct * 100
        )}% target. Move it, build it earlier, or accept the overtime.`,
        drivenBy: drivers,
        href: `/scenario-lab?mode=capacity&situation=${situation.id}`,
        cta: "Test it in Scenario Lab",
      });
    }
  }

  /* ---- representation: undecided items hold everything else up ---- */
  // The same "to decide" every page counts (`skuCounts`), so this title and
  // the Overview headline name the same number.
  const undecided = candidateItems.filter((c) => isUndecided(c.disposition));
  if (undecided.length > 0) {
    const productionStart = situation.productionWindow?.start;
    const marker = runway.markers.find((m) => m.kind === "production_start");
    out.push({
      id: "representation:undecided",
      kind: "representation",
      title: `Decide on ${undecided.length} product${undecided.length === 1 ? "" : "s"}`,
      date: productionStart,
      dateLabel: "Decide by",
      weeksAway: marker?.weeksAway,
      urgency: urgencyOf(marker?.weeksAway),
      consequence:
        "Until these are decided they carry no load, so the hours and components they would need are missing from every figure above.",
      drivenBy: undecided.slice(0, 3).map((c) => c.itemName),
      href: `/workspace/${situation.id}/reconcile`,
      cta: "Decide them",
    });
  }

  /* ---- production: the build itself ---- */
  if (situation.productionWindow && bridge.validatedUnits > 0) {
    const marker = runway.markers.find((m) => m.kind === "production_start");
    out.push({
      id: "production:start",
      kind: "production_start",
      title: "Production starts",
      date: situation.productionWindow.start,
      dateLabel: "Starts",
      weeksAway: marker?.weeksAway,
      urgency: urgencyOf(marker?.weeksAway),
      consequence: "Everything above has to be settled before the first build day.",
      drivenBy: [],
      href: `/workspace/${situation.id}/reconcile`,
      cta: "Review the plan",
    });
  }

  return out.sort(soonestFirst);
}

export interface BlockedMaterial {
  materialName: string;
  reason: string;
  blockedBy?: string;
}

/** Products still to decide across these programmes — the Decisions page's count. */
export function undecidedProductCount(situations: readonly PlanningSituation[]): number {
  return situations.reduce((n, s) => n + skuCounts(s).toDecide, 0);
}

/** Components that cannot be committed yet, and the item each is waiting on. */
export function blockedMaterials(situation: PlanningSituation): BlockedMaterial[] {
  if (!situation.materialExposure.available) return [];
  return situation.materialExposure.rows
    .filter((r) => r.status === "WAIT")
    .map((r) => ({
      materialName: r.materialName,
      reason: r.reason,
      blockedBy: r.blockedByItemName,
    }));
}

/**
 * The one decision a page should lead with: the soonest that still needs the
 * planner. A released order has been taken, and a component stock already
 * covers has no order to place, so neither can be it. Anything dated inside
 * the next twelve weeks beats something further out or undated.
 */
export function nextDecision<T extends PendingDecision>(decisions: readonly T[]): T | undefined {
  const open = (d: T) => !d.released && !(d.materialId && d.quantity !== undefined && d.quantity < 0.5);
  return decisions.find((d) => open(d) && d.urgency !== "later") ?? decisions.find(open);
}

/** Dated before undated; dated in calendar order. */
function soonestFirst(a: { date?: string }, b: { date?: string }): number {
  if (a.date && b.date) return a.date.localeCompare(b.date);
  if (a.date) return -1;
  if (b.date) return 1;
  return 0;
}

/* ------------------------------------------------------------------ */
/* Across every programme (the Decisions page)                         */
/* ------------------------------------------------------------------ */

type OverridesBySituation = Readonly<Record<string, SituationOverrides | undefined>>;

/** A pending decision, placed in the programme it belongs to. */
export interface ProgrammeDecision extends PendingDecision {
  /** Unique across programmes — a decision id is only unique within one. */
  key: string;
  situationId: string;
  situationTitle: string;
}

/**
 * Everything still open, across every programme, soonest first.
 *
 * A released order has been decided, so it leaves this list for the
 * committed log. Production start is a milestone rather than a choice; it
 * shows on a single programme's production and sales timing instead.
 *
 * Nothing registers a decision: they derive from each situation, so carrying
 * an item forward on Reconcile puts its components on this list by itself.
 */
export function upcomingDecisions(
  situations: readonly PlanningSituation[],
  overridesBySituation: OverridesBySituation
): ProgrammeDecision[] {
  const out: ProgrammeDecision[] = [];
  for (const situation of situations) {
    const releases = overridesBySituation[situation.id]?.releases ?? {};
    for (const decision of pendingDecisions(situation, releases)) {
      if (decision.released || decision.kind === "production_start") continue;
      out.push({
        ...decision,
        key: `${situation.id}:${decision.id}`,
        situationId: situation.id,
        situationTitle: situation.title,
      });
    }
  }
  return out.sort(soonestFirst);
}

/** A component held by a decision, placed in the programme it belongs to. */
export interface ProgrammeBlockedMaterial extends BlockedMaterial {
  key: string;
  situationId: string;
  situationTitle: string;
}

/** Every programme's components that cannot be committed yet. */
export function blockedAcrossProgrammes(situations: readonly PlanningSituation[]): ProgrammeBlockedMaterial[] {
  return situations.flatMap((situation) =>
    blockedMaterials(situation).map((row, i) => ({
      ...row,
      key: `${situation.id}:blocked:${i}:${row.materialName}`,
      situationId: situation.id,
      situationTitle: situation.title,
    }))
  );
}

/**
 * The record a planner's "Release" creates — undefined for anything but a
 * dated order. The supplier is whoever the planner awarded it to; absent when
 * there was no supplier history to choose from.
 */
export function releaseFor(
  decision: PendingDecision,
  releasedAt: string,
  supplier?: { supplierId: string; supplierName: string }
): MaterialRelease | undefined {
  if (!decision.materialId || !decision.date) return undefined;
  return {
    materialId: decision.materialId,
    materialName: decision.materialName ?? decision.title,
    quantity: decision.quantity ?? 0,
    uom: decision.uom ?? "",
    decisionDate: decision.date,
    releasedAt,
    ...(supplier ? { supplierId: supplier.supplierId, supplierName: supplier.supplierName } : {}),
  };
}

/** Something the planner has put their name to. */
export type CommittedEntry = {
  key: string;
  situationId: string;
  situationTitle: string;
  /** When it was recorded — dataset time, never wall-clock. */
  at: string;
} & ({ kind: "release"; release: MaterialRelease } | { kind: "volume"; commitment: VolumeCommitment });

/**
 * Every release and volume commitment, newest first. Overrides left over for
 * a programme that is not in the current dataset (a different upload) are
 * skipped rather than shown against a programme the planner cannot open.
 */
export function committedLog(
  situations: readonly PlanningSituation[],
  overridesBySituation: OverridesBySituation
): CommittedEntry[] {
  const out: CommittedEntry[] = [];
  for (const situation of situations) {
    const overrides = overridesBySituation[situation.id];
    const base = { situationId: situation.id, situationTitle: situation.title };
    for (const release of Object.values(overrides?.releases ?? {})) {
      out.push({ ...base, key: `${situation.id}:release:${release.materialId}`, at: release.releasedAt, kind: "release", release });
    }
    for (const commitment of Object.values(overrides?.commitments ?? {})) {
      out.push({
        ...base,
        key: `${situation.id}:volume:${commitment.candidateId}`,
        at: commitment.committedAt,
        kind: "volume",
        commitment,
      });
    }
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}
