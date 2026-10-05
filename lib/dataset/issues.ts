/**
 * The planner-facing problem model.
 *
 * Raw parser errors never reach the UI (V2 §28). Every problem becomes a
 * `DataIssue` that names a sheet, says what is wrong in planning language, and
 * carries a row count so the upload screen can say "3 rows missing line_id"
 * instead of printing three stack traces.
 */

export type IssueSeverity = "error" | "warning" | "info";

/** Logical sheet names. Also the tab names in the generated workbook. */
export const SHEET_NAMES = [
  "Stores",
  "SKU_Master",
  "SKU_Transitions",
  "Sales_History",
  "Inventory",
  "Inbound_Supply",
  "Current_Plan",
  "Selling_Profiles",
  "Transition_History",
] as const;

export type SheetName = (typeof SHEET_NAMES)[number];

export interface DataIssue {
  /** Stable within one validation run — `${sheet}:${code}:${column ?? ""}`. */
  id: string;
  sheet: SheetName | "Workbook";
  severity: IssueSeverity;
  /** Machine-readable class, e.g. "missing_column", "invalid_number". */
  code: string;
  /** One planner-readable line. No stack traces, no library wording. */
  message: string;
  column?: string;
  /** 1-based worksheet row numbers, capped when rendering. */
  rowNumbers: number[];
  /** How many rows are affected. May exceed `rowNumbers.length`. */
  count: number;
}

export interface IssueSummary {
  errors: number;
  warnings: number;
  infos: number;
  total: number;
  /** True when nothing blocks the workflow. Warnings never block (V2 §28). */
  ready: boolean;
  bySheet: { sheet: DataIssue["sheet"]; issues: DataIssue[]; errors: number; warnings: number }[];
}

/**
 * Accumulates issues and merges repeats of the same problem into one row with
 * a count, which is what makes the issues screen readable.
 */
export class IssueCollector {
  private readonly map = new Map<string, DataIssue>();

  add(input: {
    sheet: DataIssue["sheet"];
    severity: IssueSeverity;
    code: string;
    message: string;
    column?: string;
    row?: number;
  }): void {
    const id = `${input.sheet}:${input.code}:${input.column ?? ""}`;
    const existing = this.map.get(id);
    if (existing) {
      existing.count += 1;
      // Keep a bounded sample of rows — enough to point the planner at the
      // problem without turning the screen into a spreadsheet dump.
      if (input.row !== undefined && existing.rowNumbers.length < 25) {
        existing.rowNumbers.push(input.row);
      }
      return;
    }
    this.map.set(id, {
      id,
      sheet: input.sheet,
      severity: input.severity,
      code: input.code,
      message: input.message,
      column: input.column,
      rowNumbers: input.row !== undefined ? [input.row] : [],
      count: 1,
    });
  }

  error(sheet: DataIssue["sheet"], code: string, message: string, opts?: { column?: string; row?: number }) {
    this.add({ sheet, severity: "error", code, message, ...opts });
  }

  warn(sheet: DataIssue["sheet"], code: string, message: string, opts?: { column?: string; row?: number }) {
    this.add({ sheet, severity: "warning", code, message, ...opts });
  }

  info(sheet: DataIssue["sheet"], code: string, message: string, opts?: { column?: string; row?: number }) {
    this.add({ sheet, severity: "info", code, message, ...opts });
  }

  all(): DataIssue[] {
    const order: Record<IssueSeverity, number> = { error: 0, warning: 1, info: 2 };
    return [...this.map.values()].sort(
      (a, b) => order[a.severity] - order[b.severity] || a.sheet.localeCompare(b.sheet)
    );
  }

  hasErrors(): boolean {
    return [...this.map.values()].some((i) => i.severity === "error");
  }
}

export function summarizeIssues(issues: DataIssue[]): IssueSummary {
  const errors = issues.filter((i) => i.severity === "error").reduce((n, i) => n + i.count, 0);
  const warnings = issues.filter((i) => i.severity === "warning").reduce((n, i) => n + i.count, 0);
  const infos = issues.filter((i) => i.severity === "info").reduce((n, i) => n + i.count, 0);

  const sheets = [...new Set(issues.map((i) => i.sheet))];
  const bySheet = sheets
    .map((sheet) => {
      const sheetIssues = issues.filter((i) => i.sheet === sheet);
      return {
        sheet,
        issues: sheetIssues,
        errors: sheetIssues.filter((i) => i.severity === "error").reduce((n, i) => n + i.count, 0),
        warnings: sheetIssues.filter((i) => i.severity === "warning").reduce((n, i) => n + i.count, 0),
      };
    })
    .sort((a, b) => b.errors - a.errors || b.warnings - a.warnings);

  return {
    errors,
    warnings,
    infos,
    total: errors + warnings + infos,
    ready: errors === 0,
    bySheet,
  };
}
