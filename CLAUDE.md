@Heizen_Planning_Gap_Intelligence_PRD.md

# Heizen — engineering guide (Scouting America · SKU Transition Intelligence)

The PRD above is the original (Hershey) product context. It is still useful
for the house principles — explainability, planner control, honest
degradation — but **its information architecture, domain model and demo story
are superseded by this file.** Don't reintroduce planning gaps, BOMs,
materials, line capacity or the V1/V2 navigation because the PRD describes
them.

See `docs/architecture.md` for the layer-by-layer map.

## What this product is

Heizen plans **continuity across SKU transitions** for a merchandise planner
on JDA MMS. When a legacy SKU is replaced (Scouting America's rebrand is the
driver), JDA sees two unrelated records; the business sees one product.

> Plan across product transitions, not just individual SKUs.

Heizen connects legacy and successor SKUs, carries legacy demand forward,
reconciles usable inventory across the DC and ~120 stores, and recommends
what to order, hold or transfer. It is not a forecasting replacement, not
MRP, not a JDA replacement. Primary persona: one supply / merchandise
planner (demo persona "James").

## Information architecture

Four destinations, nothing more: **Overview · SKU Transitions · Planning
Simulator · Actions**, plus Ask Heizen in the top bar.

Inside one transition the chain is fixed:
**Lineage → Demand continuity → Network inventory → Store coverage →
Replenishment → Rebalancing → Planner action.**

## Two data modes

`DEMO` (seeded synthetic Scouting America network) and `UPLOADED` (a
planner's `.xlsx` of JDA exports). Both normalize into the same
`PlanningDataset`; `lib/dataset/adapter-parity.test.ts` proves it. Never build
a demo-only or upload-only screen. Demo data uses the customer's program
vocabulary but every number is synthetic — label it so, never present it as
Scouting America's real data.

## Non-negotiable principles

- **Item identity is not business continuity.** A transition, not a SKU, is
  the unit every page plans.
- **Never double count.** Continuity baseline = legacy units × transferred
  share + successor units, each sale counted once. Never carry legacy history
  *and* add a successor forecast on top. One-to-many splits demand by shares
  that sum to one; many-to-one sums predecessors.
- **Never blindly sum inventory.** Usable legacy = legacy available ×
  substitutability (0 if blocked). Supply = usable legacy + successor
  available + inbound inside the horizon.
- **Replenishment shows its math** and is never negative. The "ignoring
  legacy" figure is the comparison; the difference is *deferred or avoided*
  purchasing — never "savings". Extrapolation across the portfolio is always
  labelled illustrative.
- **Actions are derived, never registered**, and carry reasons + calculation.
  Priority is rules (Critical/High/Medium/Monitor), not a mystery score.
- **The system recommends; the planner controls.** Overrides (successor,
  substitutability, transferred demand, demand, safety stock, order) live in
  `stores/dataset-store.ts` with an audit entry each.
- **Scenarios never touch the baseline.** Simulator levers are drafts in
  `stores/scenario-store.ts`; results are rebuilt, never stored. Adopting a
  scenario writes planner overrides — but a supplier delay is never adopted.
- **Honest degradation.** Missing store sales, store inventory, inbound,
  Current_Plan or costs degrade one analysis and say so ("Not available"),
  never a zero.
- **Dates come from `dataset.metadata.planningNow`**, never the machine clock
  in planning math. Uploaded data stays in the browser.

## Visual rules

Every screen understandable in 5–10 seconds; don't fix confusion with
paragraphs. Five planner-facing states only: **Action needed · Monitor ·
Transitioning · Healthy · Complete.** Colour from CSS custom properties only;
risk tokens, **lineage tokens (legacy tan / successor navy / inbound teal)**
and planning-state tokens are structurally separate — see `app/globals.css`.
Signature visuals: the continuity layer, transition bar, store coverage +
transfers, replenishment waterfall, baseline-vs-scenario table.

## What NOT to do

- No planning calculations in React components — derived numbers come from
  `lib/transitions/*` (pure). Display arithmetic only.
- No `Math.random()` / `Date.now()` in data generation or planning math.
- Don't import `lib/excel/template.ts` (ExcelJS, Node-only) into the client.
- No manufacturing, BOM, capacity or material language in the product.
- No ERP/JDA writeback, real auth, RBAC UI or live integrations.

## Stack

Next.js (App Router) + TypeScript (strict, `noUncheckedIndexedAccess`) +
Tailwind v4 + hand-written shadcn-style components + Zustand + Vitest.
ExcelJS (server, template) + SheetJS (browser, parsing).
