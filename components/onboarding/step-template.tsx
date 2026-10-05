/**
 * Step 1 — Template (V2 §12, §26).
 *
 * Two lines, one big action, one small table, one escape hatch. Nothing here
 * should require reading a paragraph to understand.
 */

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { WORKBOOK_SCHEMA } from "@/lib/excel/schema";

export function StepTemplate({ onContinue }: { onContinue: () => void }) {
  return (
    <div>
      <p className="max-w-[560px] text-[13px] leading-relaxed text-[var(--text-secondary)]">
        Download the template, paste in your JDA MMS exports — stores, SKU master, sales, inventory, open POs — and list which legacy SKUs became which successors. Then upload it back here.
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Button asChild size="lg">
          <a href="/api/planning-template" download>
            <Download className="size-4" />
            Download transition template
          </a>
        </Button>
        <Button variant="ghost" onClick={onContinue}>
          I already have the file — continue
        </Button>
      </div>

      <div className="mt-8 overflow-x-auto rounded-[var(--radius-md)] border border-[var(--border)]">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-[var(--border)] bg-[var(--surface-sunken)]">
              <th className="px-3 py-2 text-left text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--text-muted)]">
                Sheet
              </th>
              <th className="hidden px-3 py-2 text-left text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--text-muted)] sm:table-cell">
                &nbsp;
              </th>
              <th className="px-3 py-2 text-left text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--text-muted)]">
                Purpose
              </th>
            </tr>
          </thead>
          <tbody>
            {WORKBOOK_SCHEMA.map((sheet) => (
              <tr key={sheet.name} className="border-b border-[var(--border)] last:border-b-0">
                <td className="whitespace-nowrap px-3 py-2 align-top font-medium text-[var(--text-primary)] sm:align-middle">
                  {sheet.name}
                  {/* On a phone the badge sits under the name rather than in
                      its own column, which left Purpose two words wide. */}
                  <div className="mt-1 sm:hidden">
                    <Badge variant={sheet.required ? "formal" : "neutral"}>
                      {sheet.required ? "Required" : "Optional"}
                    </Badge>
                  </div>
                </td>
                <td className="hidden px-3 py-2 sm:table-cell">
                  <Badge variant={sheet.required ? "formal" : "neutral"}>
                    {sheet.required ? "Required" : "Optional"}
                  </Badge>
                </td>
                <td className="px-3 py-2 text-[var(--text-secondary)]">{sheet.purpose}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
