/**
 * Deterministic intent engine for the V2 "Ask Heizen" bar (V2 §54).
 *
 * Regex/keyword matching only — no network call, no LLM, no randomness. Every
 * reply is built from fields already present on the `PlanningSituation`
 * objects passed in through `CopilotContext`, so a reply can never disagree
 * with a number already on screen.
 *
 * If a `PlanningSituation` does not carry a number (no capacity data
 * uploaded, no BOM, no runway marker), the reply says so via `unavailable`
 * rather than inventing one — the same rule `lib/situations/build.ts`
 * follows when it leaves a `CapacityExposure`/`MaterialExposure` marked
 * `available: false`.
 */

import type {
  CandidateItem,
  CapacityCell,
  CapacityExposure,
  ContributorDisposition,
  MaterialExposureRow,
  PlanningSituation,
} from "@/types/situation";
import type { CopilotContext, CopilotReply } from "./types";
import { formatMonthLabel } from "@/lib/dataset/periods";
import { fmtHours, fmtMoney, fmtPct, fmtWeeks, fmtDateShort } from "@/lib/utils/format";

/* ------------------------------------------------------------------ */
/* Resolution helpers                                                  */
/* ------------------------------------------------------------------ */

function words(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

/** A situation named in the question, by a distinctive word from its title or event. */
function resolveNamedSituation(question: string, situations: readonly PlanningSituation[]): PlanningSituation | undefined {
  const q = question.toLowerCase();
  let best: { situation: PlanningSituation; score: number } | undefined;
  for (const situation of situations) {
    const candidates = new Set([...words(situation.title), ...words(situation.eventOrProgram)]);
    let score = 0;
    for (const w of candidates) {
      if (w.length > 3 && q.includes(w)) score += 1;
    }
    if (score > 0 && (best === undefined || score > best.score)) best = { situation, score };
  }
  return best?.situation;
}

function situationIdFromPathname(pathname: string): string | undefined {
  return /^\/workspace\/([^/]+)/.exec(pathname)?.[1];
}

/**
 * The situation a question is about. A name mentioned in the question wins
 * over everything else; failing that, the workspace page the planner is
 * currently on; failing that, the store's active situation; failing that, the
 * only situation there is, if there is exactly one.
 */
function resolveSituation(question: string, ctx: CopilotContext): PlanningSituation | undefined {
  const named = resolveNamedSituation(question, ctx.situations);
  if (named) return named;

  const fromPath = situationIdFromPathname(ctx.pathname);
  if (fromPath) {
    const match = ctx.situations.find((s) => s.id === fromPath);
    if (match) return match;
  }

  if (ctx.activeSituationId) {
    const active = ctx.situations.find((s) => s.id === ctx.activeSituationId);
    if (active) return active;
  }

  return ctx.situations.length === 1 ? ctx.situations[0] : undefined;
}

function needSituationReply(ctx: CopilotContext): CopilotReply {
  const example = ctx.situations[0]?.title;
  return {
    text: example
      ? `I need to know which situation you mean — try naming one, like "${example}".`
      : "No planning situations are loaded yet.",
    action: { kind: "none" },
    visualsUpdated: [],
    unavailable: example ? "Situation not specified." : "No planning situations loaded.",
  };
}

interface LineRef {
  lineId: string;
  lineName: string;
}

/** Resolves a line by id ("line 03", "l03", "line-03"), full name, or a distinctive word of it. */
function resolveLine(query: string, lines: readonly LineRef[]): LineRef | undefined {
  const q = query.toLowerCase();
  const numMatch = /\bline[\s_-]?0?(\d+)\b|\bl0?(\d)\b/.exec(q);
  const num = numMatch?.[1] ?? numMatch?.[2];
  if (num) {
    const padded = num.padStart(2, "0");
    const byNum = lines.find((l) => l.lineId.toLowerCase().endsWith(padded));
    if (byNum) return byNum;
  }
  const byName = lines.find((l) => q.includes(l.lineName.toLowerCase()));
  if (byName) return byName;
  const byId = lines.find((l) => q.includes(l.lineId.toLowerCase()));
  if (byId) return byId;
  return lines.find((l) => words(l.lineName).some((w) => w.length > 4 && q.includes(w)));
}

function defaultLine(capacity: CapacityExposure): LineRef | undefined {
  if (capacity.lines.length === 1) return capacity.lines[0];
  if (capacity.exposedLineIds.length === 1) {
    const found = capacity.lines.find((l) => l.lineId === capacity.exposedLineIds[0]);
    if (found) return found;
  }
  if (capacity.peak) {
    const found = capacity.lines.find((l) => l.lineId === capacity.peak?.lineId);
    if (found) return found;
  }
  return undefined;
}

interface MaterialRef {
  materialId: string;
  materialName: string;
}

/** Resolves a material by id, full name, or a distinctive word from its name. */
function resolveMaterial(query: string, rows: readonly MaterialRef[]): MaterialRef | undefined {
  const q = query.trim().toLowerCase();
  if (!q) return undefined;
  const byId = rows.find((r) => r.materialId.toLowerCase() === q);
  if (byId) return byId;
  const byName = rows.find((r) => r.materialName.toLowerCase() === q || r.materialName.toLowerCase().includes(q));
  if (byName) return byName;
  const qWords = q.split(/\s+/).filter((w) => w.length > 3);
  return rows.find((r) => qWords.some((w) => r.materialName.toLowerCase().includes(w)));
}

/** Resolves one or more candidate items by item id, full name, or a distinctive word. */
function resolveCandidates(query: string, candidates: readonly CandidateItem[]): CandidateItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const byId = candidates.filter((c) => c.itemId.toLowerCase() === q || c.id.toLowerCase() === q);
  if (byId.length > 0) return byId;
  const byName = candidates.filter((c) => {
    const name = c.itemName.toLowerCase();
    return name === q || name.includes(q) || q.includes(name);
  });
  if (byName.length > 0) return byName;
  const qWords = q.split(/\s+/).filter((w) => w.length > 3);
  return candidates.filter((c) => qWords.some((w) => c.itemName.toLowerCase().includes(w)));
}

const MONTH_NAMES: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

/* ------------------------------------------------------------------ */
/* Reconciliation actions                                              */
/* ------------------------------------------------------------------ */

const DISPOSITION_PHRASES: { re: RegExp; value: ContributorDisposition }[] = [
  { re: /intentional exit/i, value: "intentional_exit" },
  { re: /already represented/i, value: "already_represented" },
  { re: /carry[\s-]?forward/i, value: "carry_forward" },
  { re: /under review/i, value: "under_review" },
  { re: /new or changed/i, value: "new_or_changed" },
  { re: /unreviewed/i, value: "unreviewed" },
];

const DISPOSITION_LABEL: Record<ContributorDisposition, string> = {
  unreviewed: "unreviewed",
  carry_forward: "carry forward",
  already_represented: "already represented",
  intentional_exit: "intentional exit",
  under_review: "under review",
  new_or_changed: "new or changed",
};

function matchDispositionPhrase(text: string): ContributorDisposition | null {
  for (const { re, value } of DISPOSITION_PHRASES) if (re.test(text)) return value;
  return null;
}

function tryDisposition(question: string, ctx: CopilotContext): CopilotReply | null {
  const q = question.trim();

  // Bulk: "carry forward everything unmatched" / "carry forward all that are unmatched"
  if (/^carry[\s-]?forward\s+(everything|all)\b.*unmatched/i.test(q)) {
    const situation = resolveSituation(question, ctx);
    if (!situation) return needSituationReply(ctx);
    const targets = situation.candidateItems.filter((c) => !c.match.matchedItemId);
    if (targets.length === 0) {
      return {
        text: `Every prior item for ${situation.title} already has a match, so there is nothing unmatched to carry forward.`,
        action: { kind: "none" },
        visualsUpdated: [],
      };
    }
    return {
      text: `Setting ${targets.length} unmatched item${targets.length === 1 ? "" : "s"} to carry forward for ${situation.title}.`,
      action: {
        kind: "set_disposition",
        situationId: situation.id,
        candidateIds: targets.map((c) => c.id),
        disposition: "carry_forward",
      },
      visualsUpdated: ["Reconcile"],
    };
  }

  // "treat X as Y" / "mark X as Y"
  const m = /^(?:treat|mark)\s+(.+?)\s+as\s+(?:an?\s+)?(.+?)[.?!]?$/i.exec(q);
  if (!m) return null;
  const itemQuery = m[1]?.trim() ?? "";
  const dispositionPhrase = m[2]?.trim() ?? "";
  const disposition = matchDispositionPhrase(dispositionPhrase);
  if (!disposition) return null;

  const situation = resolveSituation(question, ctx);
  if (!situation) return needSituationReply(ctx);
  const targets = resolveCandidates(itemQuery, situation.candidateItems);
  if (targets.length === 0) {
    return {
      text: `I could not find "${itemQuery}" among the prior items for ${situation.title}.`,
      action: { kind: "none" },
      visualsUpdated: [],
      unavailable: `No candidate item matches "${itemQuery}".`,
    };
  }
  return {
    text: `Set ${targets.length} item${targets.length === 1 ? "" : "s"} to ${DISPOSITION_LABEL[disposition]} for ${situation.title}.`,
    action: {
      kind: "set_disposition",
      situationId: situation.id,
      candidateIds: targets.map((c) => c.id),
      disposition,
    },
    visualsUpdated: ["Reconcile"],
  };
}

/* ------------------------------------------------------------------ */
/* Scenario actions                                                    */
/* ------------------------------------------------------------------ */

function tryScenarioHours(question: string, ctx: CopilotContext): CopilotReply | null {
  const m = /assume\s+([a-zA-Z]+)\s+capacity\s+(?:is|to|=|at)?\s*(\d+(?:\.\d+)?)\s*hours?(?:\s+on\s+(.+?))?[.?!]?$/i.exec(
    question
  );
  if (!m) return null;
  const monthWord = m[1]?.toLowerCase() ?? "";
  const hours = Number(m[2]);
  const lineQuery = m[3];

  const situation = resolveSituation(question, ctx);
  if (!situation) return needSituationReply(ctx);

  const monthNum = MONTH_NAMES[monthWord];
  if (!monthNum) {
    return {
      text: `I do not recognize "${monthWord}" as a month.`,
      action: { kind: "none" },
      visualsUpdated: [],
      unavailable: `Unrecognized month "${monthWord}".`,
    };
  }

  const capacity = situation.capacityExposure;
  if (!capacity.available) {
    return {
      text: capacity.unavailableReason ?? "Capacity data is not available for this situation.",
      action: { kind: "none" },
      visualsUpdated: [],
      unavailable: capacity.unavailableReason ?? "Capacity data not available.",
    };
  }

  const padded = String(monthNum).padStart(2, "0");
  const period = capacity.periods.find((p) => p.slice(5, 7) === padded);
  if (!period) {
    return {
      text: `${situation.title} has no capacity data for ${monthWord}.`,
      action: { kind: "none" },
      visualsUpdated: [],
      unavailable: `No capacity period for "${monthWord}" on ${situation.title}.`,
    };
  }

  const line = lineQuery ? resolveLine(lineQuery, capacity.lines) : defaultLine(capacity);
  if (!line) {
    return {
      text: `I could not tell which line you meant for ${situation.title}.`,
      action: { kind: "none" },
      visualsUpdated: [],
      unavailable: "Line not specified.",
    };
  }

  return {
    text: `Setting ${line.lineName} available hours in ${formatMonthLabel(period)} to ${fmtHours(hours)} in a new scenario for ${situation.title}.`,
    action: { kind: "set_available_hours", situationId: situation.id, lineId: line.lineId, period, hours },
    visualsUpdated: ["Scenario Lab", "Capacity"],
  };
}

function tryScenarioLeadTime(question: string, ctx: CopilotContext): CopilotReply | null {
  const m = /(\d+(?:\.\d+)?)\s*-?\s*day(?:s)?\s+lead\s*time(?:\s+(?:for|on)\s+(.+?))?[.?!]?$/i.exec(question);
  if (!m) return null;
  const days = Number(m[1]);
  const materialQuery = (m[2] ?? "").trim();

  const situation = resolveSituation(question, ctx);
  if (!situation) return needSituationReply(ctx);

  const materials = situation.materialExposure;
  if (!materials.available) {
    return {
      text: materials.unavailableReason ?? "Material data is not available for this situation.",
      action: { kind: "none" },
      visualsUpdated: [],
      unavailable: materials.unavailableReason ?? "Material data not available.",
    };
  }

  const material = materialQuery ? resolveMaterial(materialQuery, materials.rows) : undefined;
  if (!material) {
    return {
      text: materialQuery
        ? `I could not find a material matching "${materialQuery}" for ${situation.title}.`
        : `Which material's lead time should I change for ${situation.title}?`,
      action: { kind: "none" },
      visualsUpdated: [],
      unavailable: "Material not specified.",
    };
  }

  return {
    text: `Setting ${material.materialName} lead time to ${days}d in a new scenario for ${situation.title}.`,
    action: { kind: "set_lead_time", situationId: situation.id, materialId: material.materialId, days },
    visualsUpdated: ["Scenario Lab", "Materials"],
  };
}

/* ------------------------------------------------------------------ */
/* Navigation                                                          */
/* ------------------------------------------------------------------ */

const NAV_VERB_RE = /\b(open|show|take me to|go to|navigate to|switch to|pull up|display)\b/i;
const QUESTION_WORD_RE = /\b(why|what|which|how|when|who)\b/i;

function tryNavigate(question: string, ctx: CopilotContext): CopilotReply | null {
  const q = question.toLowerCase();
  const hasVerb = NAV_VERB_RE.test(q);
  const looksLikeQuestion = QUESTION_WORD_RE.test(q);
  // A question ("which line is exposed") is never a bare navigation command
  // unless it also carries an explicit navigation verb.
  if (!hasVerb && looksLikeQuestion) return null;

  if (/overview/.test(q)) {
    return { text: "Opening Overview.", action: { kind: "navigate", href: "/overview" }, visualsUpdated: ["Overview"] };
  }
  if (/scenario/.test(q)) {
    const situation = resolveSituation(question, ctx);
    const href = situation ? `/scenario-lab?situation=${situation.id}` : "/scenario-lab";
    return {
      text: situation ? `Opening Scenario Lab for ${situation.title}.` : "Opening Scenario Lab.",
      action: { kind: "navigate", href },
      visualsUpdated: ["Scenario Lab"],
    };
  }
  if (/\bdecision/.test(q)) {
    return { text: "Opening Decisions.", action: { kind: "navigate", href: "/decisions" }, visualsUpdated: ["Decisions"] };
  }
  if (/reconcil/.test(q)) {
    const situation = resolveSituation(question, ctx);
    if (!situation) return needSituationReply(ctx);
    return {
      text: `Opening Reconcile for ${situation.title}.`,
      action: { kind: "navigate", href: `/workspace/${situation.id}/reconcile` },
      visualsUpdated: ["Reconcile"],
    };
  }
  // Materials and capacity are no longer destinations. They are consequences of
  // particular unrepresented items, so the honest answer to "show me materials"
  // is the list of items causing them, not a page of aggregates.
  if (/material|supply|capacity/.test(q)) {
    const situation = resolveSituation(question, ctx);
    if (!situation) return needSituationReply(ctx);
    const subject = /capacity/.test(q) ? "Capacity" : "Materials";
    return {
      text: `${subject} follows from the items that are not represented. Opening Reconcile for ${situation.title} — open an item to see the lines and components it drives.`,
      action: { kind: "navigate", href: `/workspace/${situation.id}/reconcile` },
      visualsUpdated: ["Reconcile"],
    };
  }
  if (/\bdecide\b/.test(q)) {
    const situation = resolveSituation(question, ctx);
    if (!situation) return needSituationReply(ctx);
    return {
      text: `Opening Decisions for ${situation.title}.`,
      action: { kind: "navigate", href: `/decisions?programme=${situation.id}` },
      visualsUpdated: ["Decisions"],
    };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Capacity questions                                                  */
/* ------------------------------------------------------------------ */

const CAPACITY_RE = /\bline\b|\bcapacity\b|\butiliz|\butilis|\bpeak\b|\bexposed\b|\bexposure\b/i;

function tryCapacity(question: string, ctx: CopilotContext): CopilotReply | null {
  if (!CAPACITY_RE.test(question)) return null;
  const situation = resolveSituation(question, ctx);
  if (!situation) return needSituationReply(ctx);

  const capacity = situation.capacityExposure;
  if (!capacity.available) {
    return {
      text: capacity.unavailableReason ?? "Capacity data is not available for this situation.",
      action: { kind: "none" },
      visualsUpdated: [],
      unavailable: capacity.unavailableReason ?? "Capacity data not available.",
    };
  }

  const q = question.toLowerCase();

  if (/which line|exposed|exposure/.test(q)) {
    if (capacity.exposedLineIds.length === 0) {
      return {
        text: `No line exceeds its target utilization for ${situation.title}.`,
        action: { kind: "none" },
        visualsUpdated: ["Capacity"],
      };
    }
    const names = capacity.exposedLineIds.map((id) => capacity.lines.find((l) => l.lineId === id)?.lineName ?? id);
    return {
      text: `${names.join(", ")} exceed${names.length === 1 ? "s" : ""} target utilization for ${situation.title}.`,
      action: { kind: "none" },
      visualsUpdated: ["Capacity"],
    };
  }

  const namedLine = resolveLine(question, capacity.lines);
  const cell: CapacityCell | undefined = namedLine
    ? capacity.cells
        .filter((c) => c.lineId === namedLine.lineId)
        .reduce<CapacityCell | undefined>(
          (worst, c) => (worst === undefined || c.effectiveUtilization > worst.effectiveUtilization ? c : worst),
          undefined
        )
    : capacity.peak;

  if (!cell) {
    return {
      text: `No capacity cells are available for ${situation.title}.`,
      action: { kind: "none" },
      visualsUpdated: [],
      unavailable: "No capacity cells computed.",
    };
  }

  const reasons: string[] = [];
  if (cell.plannedMaintenanceHours > 0) reasons.push(`${fmtHours(cell.plannedMaintenanceHours)} maintenance`);
  if (cell.projectDowntimeHours > 0) reasons.push(`${fmtHours(cell.projectDowntimeHours)} project downtime`);
  if (cell.laborConstraintHours > 0) reasons.push(`${fmtHours(cell.laborConstraintHours)} labor constraint`);
  const reasonSentence = reasons.length > 0 ? ` ${reasons.join(", ")} reduce available hours.` : "";

  return {
    text: `${cell.lineName} in ${formatMonthLabel(cell.period)}: formal ${fmtPct(cell.formalUtilization)}, effective ${fmtPct(cell.effectiveUtilization)} of ${fmtHours(cell.availableHours)} available.${reasonSentence}`,
    action: { kind: "none" },
    visualsUpdated: ["Capacity"],
  };
}

/* ------------------------------------------------------------------ */
/* Material questions                                                  */
/* ------------------------------------------------------------------ */

const MATERIAL_RE = /\bplan now\b|\bshould wait\b|\bwhich material\b|\bmaterial\b.*\bfirst\b|\bcomponent(s)?\b/i;

function tryMaterial(question: string, ctx: CopilotContext): CopilotReply | null {
  if (!MATERIAL_RE.test(question)) return null;
  const situation = resolveSituation(question, ctx);
  if (!situation) return needSituationReply(ctx);

  const materials = situation.materialExposure;
  if (!materials.available) {
    return {
      text: materials.unavailableReason ?? "Material data is not available for this situation.",
      action: { kind: "none" },
      visualsUpdated: [],
      unavailable: materials.unavailableReason ?? "Material data not available.",
    };
  }

  const q = question.toLowerCase();

  if (/should wait/.test(q)) {
    if (materials.waitCount === 0) {
      return { text: `Nothing is waiting for ${situation.title}.`, action: { kind: "none" }, visualsUpdated: ["Materials"] };
    }
    const example: MaterialExposureRow | undefined = materials.rows.find((r) => r.status === "WAIT");
    return {
      text: `${materials.waitCount} component${materials.waitCount === 1 ? "" : "s"} should wait for ${situation.title}.${example ? ` ${example.materialName}: ${example.reason}` : ""}`,
      action: { kind: "none" },
      visualsUpdated: ["Materials"],
    };
  }

  if (/which material|\bfirst\b/.test(q)) {
    if (!materials.earliestDecisionDate) {
      return {
        text: `No material decision date is set for ${situation.title}.`,
        action: { kind: "none" },
        visualsUpdated: [],
        unavailable: "No earliest decision date.",
      };
    }
    const driver = materials.rows.find((r) => r.decisionDate === materials.earliestDecisionDate);
    return {
      text: `${driver?.materialName ?? "A component"} sets the earliest material deadline for ${situation.title}, by ${fmtDateShort(materials.earliestDecisionDate)}.${driver ? ` ${driver.reason}` : ""}`,
      action: { kind: "none" },
      visualsUpdated: ["Materials"],
    };
  }

  // Default: what can be planned now.
  if (materials.planNowCount === 0) {
    return { text: `Nothing can be planned now for ${situation.title}.`, action: { kind: "none" }, visualsUpdated: ["Materials"] };
  }
  const example = materials.rows.find((r) => r.status === "PLAN_NOW");
  return {
    text: `${materials.planNowCount} component${materials.planNowCount === 1 ? "" : "s"} can be planned now for ${situation.title}.${example ? ` ${example.materialName}: ${example.reason}` : ""}`,
    action: { kind: "none" },
    visualsUpdated: ["Materials"],
  };
}

/* ------------------------------------------------------------------ */
/* Runway                                                               */
/* ------------------------------------------------------------------ */

const RUNWAY_RE = /\bhow long\b|\birreversible\b|\brunway\b|\bweeks (remaining|left)\b/i;

function tryRunway(question: string, ctx: CopilotContext): CopilotReply | null {
  if (!RUNWAY_RE.test(question)) return null;
  const situation = resolveSituation(question, ctx);
  if (!situation) return needSituationReply(ctx);

  const runway = situation.runway;
  if (!runway.earliest) {
    return {
      text: `No decision markers are available for ${situation.title}.`,
      action: { kind: "none" },
      visualsUpdated: [],
      unavailable: "No runway markers.",
    };
  }

  const marker = runway.earliest;
  return {
    text: `${marker.label} is the earliest irreversible commitment for ${situation.title}, ${fmtWeeks(marker.weeksAway)}.${marker.detail ? ` ${marker.detail}.` : ""}`,
    action: { kind: "none" },
    visualsUpdated: ["Decision runway"],
  };
}

/* ------------------------------------------------------------------ */
/* Explain the gap                                                     */
/* ------------------------------------------------------------------ */

const EXPLAIN_RE = /\bgap\b|\bunresolved\b|how big|\brepresented\b|\bwhy\b/i;

function tryExplainGap(question: string, ctx: CopilotContext): CopilotReply | null {
  if (!EXPLAIN_RE.test(question)) return null;
  const situation = resolveSituation(question, ctx);
  if (!situation) return needSituationReply(ctx);

  const { bridge } = situation;
  return {
    text: `${situation.title}: expected ${fmtMoney(bridge.expectedValue, bridge.currency)}, formal plan ${fmtMoney(bridge.formalValue, bridge.currency)}. Unresolved ${fmtMoney(bridge.unresolvedValue, bridge.currency)}, ${fmtPct(bridge.representedPct)} represented.`,
    action: { kind: "none" },
    visualsUpdated: ["Reconcile"],
  };
}

/* ------------------------------------------------------------------ */
/* Unknown                                                              */
/* ------------------------------------------------------------------ */

function unknownReply(): CopilotReply {
  return {
    text: 'I can explain a planning gap, open a page like Capacity or Materials, or update a scenario. Try "how big is the Halloween gap" or "open capacity".',
    action: { kind: "none" },
    visualsUpdated: [],
  };
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

export function respond(question: string, ctx: CopilotContext): CopilotReply {
  const trimmed = question.trim();
  if (!trimmed) return unknownReply();

  return (
    tryDisposition(trimmed, ctx) ??
    tryScenarioHours(trimmed, ctx) ??
    tryScenarioLeadTime(trimmed, ctx) ??
    tryNavigate(trimmed, ctx) ??
    tryCapacity(trimmed, ctx) ??
    tryMaterial(trimmed, ctx) ??
    tryRunway(trimmed, ctx) ??
    tryExplainGap(trimmed, ctx) ??
    unknownReply()
  );
}
