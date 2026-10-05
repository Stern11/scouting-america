# Architecture — SKU Transition Intelligence

> Plan across product transitions, not just individual SKUs.

JDA models items. The business plans demand. When a legacy SKU is replaced,
those stop being the same thing — this product is the continuity layer that
puts them back together.

## The two input adapters

Everything the product shows is derived from one normalized model. There is
one planning engine, and it does not know where its data came from.

```
generateDemoRawInput(seed, planningNow)     parseWorkbook(.xlsx)
              │                                     │
              │                         planColumnMapping / applyMapping
              └──────────► normalizePlanningInput() ◄┘
                                   │
                            PlanningDataset             (types/dataset.ts)
                                   │
          buildTransitions(dataset, { overrides, scenario })
                                   │
                            TransitionView[]            (types/transition.ts)
                                   │
                              components/*
```

`lib/dataset/adapter-parity.test.ts` writes the demo out as a real `.xlsx`,
reads it back through the upload path, and asserts the derived transitions
are identical. A future JDA extract adapter only has to produce the same raw
rows.

## Workbook sheets (`lib/excel/schema.ts`)

Required: `Stores`, `SKU_Master`, `Sales_History`, `Inventory`.
Optional: `SKU_Transitions`, `Inbound_Supply`, `Current_Plan` (JDA forecast +
planned order), `Selling_Profiles`, `Transition_History`. Each absent sheet
turns off one capability (`DatasetCapabilities`) and the UI says so.

## The calculation chain (`lib/transitions/*`, pure)

| Module | Answers |
| --- | --- |
| `lineage.ts` | Which SKUs are one product (explicit rows → JDA replacement field → Heizen suggestion), attribute-by-attribute evidence, confidence, the planner's relationship decision. |
| `sales.ts` | Units in any window, prorated by overlap. Network rows are authoritative; store rows only say where. |
| `demand.ts` | Continuity demand: legacy × transferred + successor → trend → seasonality → horizon. Never double counts; splits one-to-many by shares. |
| `inventory.ts` | Network inventory by location; usable legacy = legacy × substitutability; eligible inbound inside the horizon. |
| `coverage.ts` | Store weeks of cover, stockout dates, at-risk vs next resupply, then the plan: transfers (donor floor, recipient cap, legacy first, same region first), DC replenishment, residual. |
| `replenishment.ts` | Requirement − usable supply, never negative; the ignoring-legacy comparison; weekly projection, needed-by and order-by dates. |
| `actions.ts` | Derived planner actions with priority rules, reasons and calculation lines; status and headline. |
| `assumptions.ts` | Layering: default ← dataset ← planner override ← scenario; thresholds. |
| `build.ts` | Assembles `TransitionView`s. |
| `portfolio.ts` | Overview roll-ups and the measured vs illustrative network impact. |
| `scenario.ts` | Simulator: baseline vs scenario metrics; what can be adopted. |
| `explain.ts` / `filters.ts` | "How this was calculated" lines; list filters. |

The horizon is vendor lead time + a 4-week review cycle. "Recent" means the
last 8 weeks. Thresholds: shortage 2 wks, target 4, excess 8, donor floor 4,
DC→store 1 week.

## State

- `stores/dataset-store.ts` — mode, seed/upload, **planner overrides per
  transition, action dispositions, audit log**. No derived numbers.
- `stores/scenario-store.ts` — simulator lever drafts and saved scenarios.
  Adjustments only.
- Both persist per signed-in account (`stores/storage-scope.ts`).

## Pages

| Route | Question |
| --- | --- |
| `/overview` | Where do we have transition risk, and what is it worth? |
| `/transitions` | Which transitions need me, and why? |
| `/transitions/[id]` | Lineage → demand → inventory → stores → replenishment → actions for one product. |
| `/simulator` | What changes if demand, timing or assumptions change? |
| `/actions` | What do I do next? |

Old routes (`/workspace`, `/scenario-lab`, `/decisions`) redirect.

## Ask Heizen

`lib/copilot/respond.ts` is deterministic and grounded only in the
`TransitionView`s on screen. What-if questions write simulator drafts, never
the baseline, and report baseline → scenario deltas.

## Demo dataset (`lib/dataset/demo/*`)

120 stores, ~150 transitions (~44 active). Showcase transitions cover each
planning situation: under-ordering + imbalance (Cub Scout Uniform Shirt,
CS-1048 → CS-2841), over-ordering (Webelos Belt), imbalance (Pinewood Derby
Car Kit, a split for Scouts BSA Uniform Pants), unconfirmed matches (Scouts
BSA Hat and two more), delayed inbound (Wolf Neckerchief), a consolidation, a
discontinuation and a new product. Store stock is designed in weeks of cover
against the demand the engine itself computes, so the story is true by
construction. All dates are offsets from `planningNow`.
