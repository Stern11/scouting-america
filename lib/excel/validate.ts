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
import type { DatasetCapabilities, PlanningDataset, RawPlanningInput, RawRow } from "@/types/dataset";
import { ambiguousIdentityRows } from "@/lib/situations/volume";

/** The compact review shown before "Run planning" (V2 §30). */
export interface PlanningScopePreview {
  periods: string[];
  brands: string[];
  historicalPeriods: string[];
  currentItemCount: number;
  historicalItemCount: number;
  lineCount: number;
  bomComponentCount: number;
  eventsOrPrograms: string[];
  capabilities: PlanningDataset["metadata"]["capabilities"];
  /** Short planner-facing lines about what is unavailable, e.g. "Add BOM data to calculate material exposure." */
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

  const mappedSheets = applyMapping(parsed, plan);
  const currencies = detectCurrencies(mappedSheets);
  const currency = currencies[0] ?? "USD";
  if (currencies.length > 1) {
    collector.warn(
      "Workbook",
      "mixed_currency",
      `Values are in ${currencies.join(", ")}. Heizen doesn't convert currency, so keep each programme in one currency.`
    );
  }

  const input: RawPlanningInput = {
    metadata: {
      id: opts.datasetId,
      name: opts.datasetName,
      mode: "UPLOADED",
      sourceFileName: opts.fileName,
      createdAt: opts.planningNow,
      planningNow: opts.planningNow,
      currency,
    },
    businessPlans: mappedSheets.get("Business_Plan"),
    currentPlanItems: mappedSheets.get("Current_Plan"),
    historicalItems: mappedSheets.get("Historical_Items"),
    boms: mappedSheets.get("BOM"),
    lineCapacity: mappedSheets.get("Line_Capacity"),
    itemLineMappings: mappedSheets.get("Item_Line_Mapping"),
    leadTimeHistory: mappedSheets.get("Lead_Time_History"),
    inventorySupply: mappedSheets.get("Inventory_Supply"),
    readinessHistory: mappedSheets.get("Readiness_History"),
    lineHistory: mappedSheets.get("Line_History"),
  };

  // normalizePlanningInput raises all row-level issues itself into the same
  // collector — we never duplicate its checks here.
  const { dataset } = normalizePlanningInput(input, collector);

  // Warned rather than merged: rows the attributes cannot tell apart are kept
  // as separate products, but a planner should know why.
  ambiguousIdentityRows(dataset.historicalItems).forEach(() =>
    collector.warn(
      "Historical_Items",
      "ambiguous_identity",
      "These prior items share every identifying attribute with another item in the same season, so they are told apart by item name. Check they aren't duplicates."
    )
  );

  for (const gap of capabilityGaps(dataset)) {
    collector.info(gap.sheet, gap.code, gap.message);
  }

  const scope = buildScopePreview(dataset);
  const issues = collector.all();

  return { dataset, issues, summary: summarizeIssues(issues), mapping: plan, scope };
}

/* ------------------------------------------------------------------ */

/** Every currency named in the value-bearing sheets, most used first. */
function detectCurrencies(mappedSheets: Map<SheetName, RawRow[]>): string[] {
  const counts = new Map<string, number>();
  const sheetsToScan: SheetName[] = ["Business_Plan", "Current_Plan", "Historical_Items"];

  for (const sheetName of sheetsToScan) {
    for (const row of mappedSheets.get(sheetName) ?? []) {
      const raw = row["currency"];
      if (typeof raw === "string" && raw.trim() !== "") {
        const value = raw.trim().toUpperCase();
        counts.set(value, (counts.get(value) ?? 0) + 1);
      }
    }
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([value]) => value);
}

interface CapabilityGap {
  key: keyof DatasetCapabilities;
  sheet: SheetName | "Workbook";
  code: string;
  message: string;
}

const CAPABILITY_MESSAGES: readonly CapabilityGap[] = [
  {
    key: "materials",
    sheet: "BOM",
    code: "capability_materials_unavailable",
    message: "Add BOM data to calculate material exposure.",
  },
  {
    key: "capacity",
    sheet: "Workbook",
    code: "capability_capacity_unavailable",
    message: "Capacity data not provided. Add Line_Capacity and Item_Line_Mapping to calculate line utilization.",
  },
  {
    key: "leadTimeAnalysis",
    sheet: "Lead_Time_History",
    code: "capability_leadtime_unavailable",
    message: "Lead times fall back to your system assumption with no historical comparison.",
  },
  {
    key: "netRequirements",
    sheet: "Inventory_Supply",
    code: "capability_netrequirements_unavailable",
    message: "Material figures are shown as gross exposure only, never as a net procurement requirement.",
  },
  {
    key: "readinessHistory",
    sheet: "Readiness_History",
    code: "capability_readinesshistory_unavailable",
    message: "Add weekly readiness history to see this season's pace against last year's.",
  },
  {
    key: "lineHistory",
    sheet: "Line_History",
    code: "capability_linehistory_unavailable",
    message: "Add Line_History to see each line's past downtime, overtime and late material arrivals.",
  },
];

function capabilityGaps(dataset: PlanningDataset): CapabilityGap[] {
  return CAPABILITY_MESSAGES.filter((gap) => !dataset.metadata.capabilities[gap.key]);
}

function buildScopePreview(dataset: PlanningDataset): PlanningScopePreview {
  const periods = [...new Set(dataset.currentPlanItems.map((r) => r.planningPeriod))].sort();
  const historicalPeriods = [...new Set(dataset.historicalItems.map((r) => r.historicalPeriod))].sort();
  const brands = [
    ...new Set([
      ...dataset.businessPlans.map((r) => r.brand),
      ...dataset.currentPlanItems.map((r) => r.brand),
      ...dataset.historicalItems.map((r) => r.brand),
    ]),
  ].sort();
  const eventsOrPrograms = [
    ...new Set(
      [
        ...dataset.businessPlans.map((r) => r.eventOrProgram),
        ...dataset.currentPlanItems.map((r) => r.eventOrProgram),
        ...dataset.historicalItems.map((r) => r.eventOrProgram),
      ].filter((v): v is string => Boolean(v))
    ),
  ].sort();

  return {
    periods,
    brands,
    historicalPeriods,
    currentItemCount: dataset.currentPlanItems.length,
    historicalItemCount: dataset.historicalItems.length,
    lineCount: new Set(dataset.lineCapacity.map((r) => r.lineId)).size,
    bomComponentCount: new Set(dataset.boms.map((r) => r.componentId)).size,
    eventsOrPrograms,
    capabilities: dataset.metadata.capabilities,
    unavailable: capabilityGaps(dataset).map((gap) => gap.message),
  };
}
