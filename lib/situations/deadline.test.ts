import { describe, it, expect } from "vitest";
import type { CandidateItem } from "@/types/situation";
import {
  componentTag,
  deadlineSortValue,
  deadlineTone,
  leadTimeLabel,
  noDeadlineReason,
  weeksLeftLabel,
} from "./deadline";

function row(partial: Partial<CandidateItem>): CandidateItem {
  return { disposition: "carry_forward", derivation: "own_bom", ...partial } as CandidateItem;
}

const deadline = (weeksAway: number) => ({
  date: "2027-02-25",
  weeksAway,
  componentId: "MAT-FILM",
  componentName: "Printed film",
  componentType: "PACKAGING",
  leadTimeDays: 112,
});

describe("deadlineTone", () => {
  it("is critical when overdue or within 8 weeks, warning for 9–20, positive beyond 20", () => {
    expect(deadlineTone(-3)).toBe("critical");
    expect(deadlineTone(0)).toBe("critical");
    expect(deadlineTone(8)).toBe("critical");
    expect(deadlineTone(9)).toBe("warning");
    expect(deadlineTone(20)).toBe("warning");
    expect(deadlineTone(21)).toBe("positive");
    expect(deadlineTone(52)).toBe("positive");
  });
});

describe("labels", () => {
  it("says overdue rather than printing a negative number", () => {
    expect(weeksLeftLabel(7)).toBe("7 wks left");
    expect(weeksLeftLabel(1)).toBe("1 wk left");
    expect(weeksLeftLabel(0)).toBe("this week");
    expect(weeksLeftLabel(-2)).toBe("2 wks overdue");
  });

  it("states lead time in weeks, and in days when under a week", () => {
    expect(leadTimeLabel(112)).toBe("16 wks");
    expect(leadTimeLabel(7)).toBe("1 wk");
    expect(leadTimeLabel(5)).toBe("5d");
  });

  it("abbreviates component classes, falling back to OTH", () => {
    expect(componentTag("PACKAGING").abbr).toBe("PM");
    expect(componentTag("RAW_MATERIAL").abbr).toBe("RM");
    expect(componentTag("ARTWORK").abbr).toBe("ART");
    expect(componentTag("SEMI_FINISHED").abbr).toBe("SF");
    expect(componentTag("SOMETHING_NEW")).toEqual({ abbr: "OTH", label: "Other component" });
  });
});

describe("noDeadlineReason", () => {
  it("names the missing input", () => {
    expect(noDeadlineReason(row({}), false)).toMatch(/production window/);
    expect(noDeadlineReason(row({ derivation: "none" }), true)).toMatch(/bill of materials/);
    expect(noDeadlineReason(row({}), true)).toMatch(/lead time/);
  });
});

describe("deadlineSortValue", () => {
  it("orders live dated rows soonest first, then exits, then undated", () => {
    const rows = [
      row({ deadline: deadline(20) }),
      row({}),
      row({ disposition: "intentional_exit", deadline: deadline(-5) }),
      row({ deadline: deadline(-1) }),
    ];
    const order = [...rows].sort((a, b) => deadlineSortValue(a) - deadlineSortValue(b));
    expect(order).toEqual([rows[3], rows[0], rows[2], rows[1]]);
  });
});
