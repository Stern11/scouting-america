# V2 architecture — unresolved planning

V2 narrows the product from "planning gap intelligence across every supply-chain
problem" to one job: **help a planner manage future business that is not yet
represented at item level in the formal planning stack.**

> Plan what your formal plan cannot see yet.

## The two input adapters

Everything the product shows is derived from a single normalized model. There is
exactly one planning engine, and it does not know where its data came from.

```
generateDemoRawInput(seed)          parseWorkbook(.xlsx)
        │                                   │
        │                           planColumnMapping / applyMapping
        │                                   │
        └──────────► normalizePlanningInput() ◄──────┘
                              │
                       PlanningDataset            (types/dataset.ts)
                              │
                    buildSituations(dataset, overrides)
                              │
                      PlanningSituation[]         (types/situation.ts)
                              │
                          components/*
```

`lib/dataset/adapter-parity.test.ts` writes the demo dataset out as a real
`.xlsx`, reads it back through the upload path, and asserts the resulting
`PlanningDataset` and every derived situation are identical. That test is what
keeps the two adapters honest.

## Layers

| Path | Responsibility |
| --- | --- |
| `types/dataset.ts` | The normalized input model. Rows shaped like a planner's export. |
| `lib/excel/schema.ts` | The canonical workbook contract. Drives template generation, the README, parsing, validation and column mapping — one source of truth so what we hand out and what we accept cannot drift. |
| `lib/excel/template.ts` | Builds the `.xlsx` template (ExcelJS, **Node only** — served by `app/api/planning-template`). Never import into a client component. |
| `lib/excel/parse.ts` `validate.ts` `column-mapping.ts` | Reads an uploaded workbook (SheetJS, browser-safe). Parsing happens client-side; workbook contents never leave the browser. |
| `lib/dataset/coerce.ts` | Cell coercion: Excel serials, `Date`s, ISO/US strings, `1,234`, `(1,234)`, `90` / `90%` / `0.9`. |
| `lib/dataset/normalize.ts` | The one funnel. Derives `availableHours` and `actualLeadTimeDays`; drops and reports rows it cannot make valid. |
| `lib/dataset/issues.ts` | Planner-facing problems. Raw parser errors never reach the UI. |
| `lib/dataset/demo/generate.ts` | The seeded demo adapter. Deterministic — same seed, same dataset. |
| `lib/situations/matching.ts` | Configurable attribute matching, one-to-one assignment, and the explanation of *why* something matched. |
| `lib/situations/build.ts` | Assembles situations: bridge, capacity, materials, runway, state. |
| `lib/situations/scenario.ts` | Applies scenario overrides to a **copy** of the dataset. |
| `stores/dataset-store.ts` | Mode, active dataset, planner dispositions. |
| `lib/situations/portfolio.ts` `horizon.ts` `readiness-curve.ts` | Overview: portfolio roll-up (optionally for one production month), the missing-items timeline, and the value-based readiness pace. |
| `lib/situations/demand-plan.ts` | Scenario Lab demand planning: brand-level last year vs target vs formal plan, and how much missing-item revenue explains the gap. |
| `lib/situations/capacity-plan.ts` `pull-forward.ts` | Scenario Lab capacity planning at plant → line → month grain: caps, extra shifts, pull-forward, brand × pack allocation, line history. |
| `lib/situations/decisions.ts` | Decisions: dated orders, line-load and undecided-product decisions, blocked components and the committed log — derived from situations, never registered. |
| `lib/situations/suppliers.ts` `deadline.ts` | Supplier comparison (lead time ± P10–P90 spread, OTIF) for releasing an order; item deadline urgency. |
| `stores/situation-scenario-store.ts` | Demand scenario overrides only — never a derived number. |
| `stores/capacity-scenario-store.ts` | Capacity scenario overrides (plant-wide, not per programme). |

## Optional history sheets

- `Readiness_History` is measured in **value**: the share of a season's
  expected business value in the formal plan at each weekly snapshot. Today's
  point on the readiness curve is `bridge.representedPct`, the same measure, so
  this year's line and last year's pace compare like for like.
- `Lead_Time_History` optionally carries `promised_date` and `received_qty`.
  With them a receipt can be judged on time and in full (OTIF); without them
  those figures are not shown — lead time still is.
- `Line_History` records what each line actually did in past months — run
  hours against scheduled hours, unplanned downtime, overtime and late material
  arrivals. Capacity planning reads it to show demonstrated capacity beside the
  planned hours. Absent, capacity shows planned hours only and says so.

## Sign-in

A shared demo account (Auth.js credentials provider, `auth.ts`) for now. Google
sign-in is commented out in `auth.ts` and `components/layout/welcome-screen.tsx`
and can be restored there. Identity still comes only from the Auth.js session,
so storage scoping is unchanged.

## The workspace flow

**Reconcile → Decisions.** A programme in the Planning Workspace is one view,
Reconcile. There is no per-programme Decide step: carrying an item forward or
exiting it changes the situation, and the decisions that follow (order-by
dates, line load, products still undecided) appear on Decisions by
derivation. Decisions shows every programme, or one via `?programme=`; the
old `/workspace/{id}/decide` route redirects there.

## The coherence rule

Every downstream number derives from one figure: **the units the planner has
validated as carrying forward** (`bridge.validatedUnits`). Capacity hours,
material requirements and decision dates all read from it. Change one
disposition on Reconcile and the capacity matrix, the material list and the
runway all move together — that is what makes the pages reconcile.

Only `carry_forward` bears load. `already_represented` is already in the formal
plan, `intentional_exit` is deliberately gone, and `under_review` has not been
decided — counting any of them would overstate the plan.

## What remains from V1

Nothing. The last module, V1's `reconcileProvisional()`, backed a what-if
panel on Decisions that no planner action fed into, and went with it.
Double-count prevention is structural instead: a prior item matched to a plan
item becomes `already_represented` and bears no load
(`lib/situations/matching.ts`).

The rest of V1 — the `/gaps` routes, the V1 Scenario Lab, the
`data/synthetic/*` input adapter, the rest of `lib/planning-engine/*`, and the
AI tool/copilot layer built on them — was removed once nothing in the running
app could reach it. The "Ask Heizen" bar answers through `lib/copilot/*`,
grounded in the same `PlanningSituation`s the page on screen renders.

## Rules that still hold

- No planning calculation inside a React component.
- No `Math.random()` and no `Date.now()` in data generation — everything derives
  from a seed and from `dataset.metadata.planningNow`.
- A scenario override never mutates the baseline, and a derived result is never
  persisted.
- Planner decisions and scenario values are keyed by situation. A candidate id
  names a product, and a product can run in more than one programme — never
  flatten them into one candidate-keyed map.
- Planning data in the browser is scoped to the signed-in account
  (`lib/utils/storage-scope.ts`); nothing is read or written until one is bound.
- Risk tokens (positive/warning/critical) and planning-state tokens
  (formal/validated/inferred/scenario/historical/unknown) stay structurally
  separate. See the header of `app/globals.css`.
- Never fabricate precision. A missing sheet degrades one analysis and says so;
  it never produces a plausible-looking placeholder.
