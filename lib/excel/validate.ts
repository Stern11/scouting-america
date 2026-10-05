/**
 * Workbook -> `PlanningDataset`, in one call.
 *
 * This is the surface the upload screen calls. It never duplicates the
 * row-level checks `normalizePlanningInput()` already performs — it only adds
 * the checks that only make sense before normalization runs: is this even a
 * readable workbook, are the required sheets present, did every required
 * column resolve to a header.
 */

import { IssueCollector, summarizeIssues, type DataIssue, type IssueSummary, type SheetName } from "@/lib/dataset/issues";
import { normalizePlanningInput } from "@/lib/dataset/normalize";
import { parseWorkbook } from "@/lib/excel/parse";
import { applyMapping, planColumnMapping, type MappingPlan } from "@/lib/excel/column-mapping";
import { REQUIRED_SHEETS, sheetSpec } from "@/lib/excel/schema";
import { collectTransitions } from "@/lib/transitions/lineage";
import type { DatasetCapabilities, PlanningDataset, RawPlanningInput } from "@/types/dataset";

/** The compact review shown before "Run planning". */
export interface PlanningScopePreview {
  storeCount: number;
  skuCount: number;
  /** Rows on SKU_Transitions. */
  explicitTransitionCount: number;
  /** Everything Heizen will plan: explicit rows, JDA replacements and its own suggestions. */
  plannedTransitionCount: number;
  /** Of those, the relationships Heizen matched itself and you will be asked to confirm. */
  suggestedTransitionCount: number;
  /** Earliest and latest day covered by Sales_History, or null when there is none. */
  salesFrom: string | null;
  salesTo: string | null;
  capabilities: DatasetCapabilities;
  /** Short planner-facing lines about what is unavailable. */
  unavailable: string[];
}

export interface WorkbookValidation {
  dataset: PlanningDataset | null; // null only when structurally unusable
  issues: DataIssue[];
  summary: IssueSummary;
  mapping: MappingPlan;
  scope: PlanningScopePreview | null;
}

export function validateWorkbook(
  data: ArrayBuffer,
  opts: {
    fileName: string;
    planningNow: string;
    datasetId: string;
    datasetName: string;
    manualMapping?: Map<SheetName, Map<string, string>>;
  }
): WorkbookValidation {
  const collector = new IssueCollector();

  let parsed;
  try {
    parsed = parseWorkbook(data);
  } catch {
    collector.error(
      "Workbook",
      "unreadable_workbook",
      "This file could not be read as an Excel workbook. Upload the .xlsx file you downloaded and filled in."
    );
    const issues = collector.all();
    return {
      dataset: null,
      issues,
      summary: summarizeIssues(issues),
      mapping: { resolutions: [], overrides: new Map(), complete: false },
      scope: null,
    };
  }

  // Missing required sheets — one clear error each, naming what is lost.
  for (const sheetName of REQUIRED_SHEETS) {
    if (!parsed.sheets.has(sheetName)) {
      const spec = sheetSpec(sheetName);
      collector.error(
        "Workbook",
        `missing_sheet_${sheetName}`,
        `The "${sheetName}" sheet is missing. ${spec.purpose} ${spec.absentConsequence}`
      );
    }
  }

  const plan = planColumnMapping(parsed, opts.manualMapping);

  // Missing required columns on sheets that ARE present. A close alias
  // resolves ("aliased"), not an error — only a genuinely unresolved
  // required column is.
  for (const res of plan.resolutions) {
    if (res.status !== "unresolved") continue;
    const spec = sheetSpec(res.sheet);
    const col = spec.columns.find((c) => c.name === res.expected);
    if (col?.required) {
      collector.error(
        res.sheet,
        `missing_column_${res.expected}`,
        `The required column "${res.expected}" was not found in ${res.sheet}. ${col.purpose}`,
        { column: res.expected }
      );
    }
  }

  const mapped = applyMapping(parsed, plan);

  const input: RawPlanningInput = {
    metadata: {
      id: opts.datasetId,
      name: opts.datasetName,
      mode: "UPLOADED",
      sourceFileName: opts.fileName,
      createdAt: opts.planningNow,
      planningNow: opts.planningNow,
      // The workbook carries no currency; JDA MMS figures are USD.
      currency: "USD",
    },
    stores: mapped.get("Stores"),
    skus: mapped.get("SKU_Master"),
    transitions: mapped.get("SKU_Transitions"),
    sales: mapped.get("Sales_History"),
    inventory: mapped.get("Inventory"),
    inbound: mapped.get("Inbound_Supply"),
    currentPlan: mapped.get("Current_Plan"),
    sellingProfiles: mapped.get("Selling_Profiles"),
    history: mapped.get("Transition_History"),
  };

  // normalizePlanningInput raises all row-level issues itself into the same
  // collector — we never duplicate its checks here.
  const { dataset } = normalizePlanningInput(input, collector);

  for (const gap of capabilityGaps(dataset)) {
    collector.info(gap.sheet, gap.code, gap.message);
  }

  const scope = buildScopePreview(dataset);
  const issues = collector.all();

  return { dataset, issues, summary: summarizeIssues(issues), mapping: plan, scope };
}

/* ------------------------------------------------------------------ */

interface CapabilityGap {
  key: keyof DatasetCapabilities;
  sheet: SheetName | "Workbook";
  code: string;
  message: string;
}

const CAPABILITY_MESSAGES: readonly CapabilityGap[] = [
  {
    key: "salesHistory",
    sheet: "Sales_History",
    code: "capability_sales_unavailable",
    message: "No sales history — there is no legacy demand to carry into the successor.",
  },
  {
    key: "storeLevelDemand",
    sheet: "Sales_History",
    code: "capability_store_demand_unavailable",
    message: "Add store-level sales to see where stock will run out.",
  },
  {
    key: "storeInventory",
    sheet: "Inventory",
    code: "capability_store_inventory_unavailable",
    message: "Add store inventory to see coverage by store and transfer recommendations.",
  },
  {
    key: "dcInventory",
    sheet: "Inventory",
    code: "capability_dc_inventory_unavailable",
    message: "No DC inventory — only store stock counts as supply.",
  },
  {
    key: "inboundSupply",
    sheet: "Inbound_Supply",
    code: "capability_inbound_unavailable",
    message: "Inbound supply not included — recommendations count only stock on hand.",
  },
  {
    key: "currentPlan",
    sheet: "Current_Plan",
    code: "capability_current_plan_unavailable",
    message: "Add Current_Plan to compare JDA's plan with Heizen's view.",
  },
  {
    key: "sellingProfiles",
    sheet: "Selling_Profiles",
    code: "capability_profiles_unavailable",
    message: "Add Selling_Profiles to see which at-risk stores JDA will not replenish automatically.",
  },
  {
    key: "unitCosts",
    sheet: "SKU_Master",
    code: "capability_unit_costs_unavailable",
    message: "Add unit_cost to every transitioning SKU to see inventory and purchasing value.",
  },
];

function capabilityGaps(dataset: PlanningDataset): CapabilityGap[] {
  return CAPABILITY_MESSAGES.filter((gap) => !dataset.metadata.capabilities[gap.key]);
}

function buildScopePreview(dataset: PlanningDataset): PlanningScopePreview {
  const planned = collectTransitions(dataset);
  let salesFrom: string | null = null;
  let salesTo: string | null = null;
  for (const row of dataset.sales) {
    if (salesFrom === null || row.periodStart < salesFrom) salesFrom = row.periodStart;
    if (salesTo === null || row.periodEnd > salesTo) salesTo = row.periodEnd;
  }
  return {
    storeCount: dataset.stores.length,
    skuCount: dataset.skus.length,
    explicitTransitionCount: dataset.transitions.length,
    plannedTransitionCount: planned.length,
    suggestedTransitionCount: planned.filter((t) => t.source === "SUGGESTED").length,
    salesFrom,
    salesTo,
    capabilities: dataset.metadata.capabilities,
    unavailable: capabilityGaps(dataset).map((gap) => gap.message),
  };
}
