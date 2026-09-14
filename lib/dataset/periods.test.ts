import { describe, it, expect } from "vitest";
import {
  addDays,
  addMonths,
  daysBetween,
  eventLabel,
  formatMonthLabel,
  isComparablePeriod,
  isMonthKey,
  monthsBetween,
  monthWeights,
  periodYear,
  programLabel,
  shiftYears,
  unionRange,
  weeksBetween,
} from "./periods";

describe("isMonthKey", () => {
  it("recognizes a calendar month key", () => {
    expect(isMonthKey("2027-06")).toBe(true);
  });

  it("rejects a program key", () => {
    expect(isMonthKey("2027-Halloween")).toBe(false);
  });
});

describe("periodYear", () => {
  it("extracts the year from a month key", () => {
    expect(periodYear("2027-06")).toBe(2027);
  });

  it("extracts the year from a program key", () => {
    expect(periodYear("2027-Halloween")).toBe(2027);
  });

  it("returns undefined for a key with no leading year", () => {
    expect(periodYear("not-a-period")).toBeUndefined();
  });
});

describe("programLabel", () => {
  it("returns undefined for a plain month key", () => {
    expect(programLabel("2027-06")).toBeUndefined();
  });

  it("returns the lowercased program name for a program key", () => {
    expect(programLabel("2027-Halloween")).toBe("halloween");
  });

  it("trims whitespace around the program name", () => {
    expect(programLabel("2027- Halloween ")).toBe("halloween");
  });
});

describe("eventLabel", () => {
  it("drops a trailing year and lowercases", () => {
    expect(eventLabel("Halloween 2026")).toBe("halloween");
  });

  it("collapses internal whitespace", () => {
    expect(eventLabel("Fall   Reset 2027")).toBe("fall reset");
  });
});

describe("isComparablePeriod", () => {
  it("treats the same program in different years as comparable", () => {
    expect(isComparablePeriod("2027-Halloween", "2026-Halloween")).toBe(true);
  });

  it("treats different programs as not comparable", () => {
    expect(isComparablePeriod("2027-Halloween", "2027-Holiday")).toBe(false);
  });

  it("treats month keys (no program label) as not comparable", () => {
    expect(isComparablePeriod("2027-06", "2026-06")).toBe(false);
  });
});

describe("addMonths", () => {
  it("carries forward across a year boundary", () => {
    expect(addMonths("2027-11", 3)).toBe("2028-02");
  });

  it("carries backward across a year boundary", () => {
    expect(addMonths("2027-01", -2)).toBe("2026-11");
  });

  it("is a no-op with delta 0", () => {
    expect(addMonths("2027-06", 0)).toBe("2027-06");
  });
});

describe("monthsBetween", () => {
  it("is inclusive of both endpoints", () => {
    expect(monthsBetween({ start: "2027-05-20", end: "2027-07-10" })).toEqual([
      "2027-05",
      "2027-06",
      "2027-07",
    ]);
  });

  it("returns a single month for a range wholly inside it", () => {
    expect(monthsBetween({ start: "2027-06-05", end: "2027-06-20" })).toEqual(["2027-06"]);
  });

  it("spans a year end", () => {
    expect(monthsBetween({ start: "2027-12-15", end: "2028-01-10" })).toEqual(["2027-12", "2028-01"]);
  });
});

describe("monthWeights", () => {
  it("sums to 1 for a multi-month range", () => {
    const weights = monthWeights({ start: "2027-05-20", end: "2027-06-10" });
    const total = [...weights.values()].reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it("assigns weight 1 to a range wholly inside one month", () => {
    const weights = monthWeights({ start: "2027-06-05", end: "2027-06-20" });
    expect(weights.size).toBe(1);
    expect(weights.get("2027-06")).toBe(1);
  });

  it("splits a range across two months proportional to actual day counts", () => {
    // May 20 -> May 31 inclusive = 12 days; June 1 -> June 10 inclusive = 10 days.
    const weights = monthWeights({ start: "2027-05-20", end: "2027-06-10" });
    expect(weights.get("2027-05")).toBeCloseTo(12 / 22, 10);
    expect(weights.get("2027-06")).toBeCloseTo(10 / 22, 10);
  });
});

describe("daysBetween / weeksBetween / addDays", () => {
  it("computes a positive day span", () => {
    expect(daysBetween("2027-06-01", "2027-06-10")).toBe(9);
  });

  it("computes a negative day span when the range runs backward", () => {
    expect(daysBetween("2027-06-10", "2027-06-01")).toBe(-9);
  });

  it("floors weeks for a positive span", () => {
    expect(weeksBetween("2027-06-01", "2027-06-10")).toBe(1);
  });

  it("floors weeks for a negative span (rounds toward negative infinity)", () => {
    expect(weeksBetween("2027-06-10", "2027-06-01")).toBe(-2);
  });

  it("adds positive days", () => {
    expect(addDays("2027-06-01", 5)).toBe("2027-06-06");
  });

  it("adds negative days across a month boundary", () => {
    expect(addDays("2027-06-01", -5)).toBe("2027-05-27");
  });
});

describe("unionRange", () => {
  it("takes the earliest start and latest end across ranges", () => {
    expect(
      unionRange([
        { start: "2027-06-01", end: "2027-06-10" },
        { start: "2027-05-01", end: "2027-05-15" },
      ])
    ).toEqual({ start: "2027-05-01", end: "2027-06-10" });
  });

  it("returns undefined for an empty list", () => {
    expect(unionRange([])).toBeUndefined();
  });

  it("filters out undefined entries", () => {
    expect(unionRange([undefined, { start: "2027-05-01", end: "2027-05-15" }, undefined])).toEqual({
      start: "2027-05-01",
      end: "2027-05-15",
    });
  });
});

describe("shiftYears", () => {
  it("shifts both endpoints forward by whole years", () => {
    expect(shiftYears({ start: "2026-10-01", end: "2026-10-31" }, 1)).toEqual({
      start: "2027-10-01",
      end: "2027-10-31",
    });
  });

  it("shifts backward with a negative delta", () => {
    expect(shiftYears({ start: "2027-10-01", end: "2027-10-31" }, -1)).toEqual({
      start: "2026-10-01",
      end: "2026-10-31",
    });
  });
});

describe("formatMonthLabel", () => {
  it("formats a month key as a short month name and two-digit year", () => {
    expect(formatMonthLabel("2027-06")).toBe("Jun 27");
  });

  it("returns the raw key when it does not parse", () => {
    expect(formatMonthLabel("not-a-month")).toBe("not-a-month");
  });
});

describe("shiftYears — 29 February", () => {
  it("lands on 28 February in a common year instead of an impossible date", () => {
    expect(shiftYears({ start: "2024-02-29", end: "2024-03-31" }, 1)).toEqual({
      start: "2025-02-28",
      end: "2025-03-31",
    });
  });

  it("keeps 29 February when the target year is a leap year", () => {
    expect(shiftYears({ start: "2024-02-29", end: "2024-02-29" }, 4).start).toBe("2028-02-29");
  });

  it("treats century years by the Gregorian rule", () => {
    expect(shiftYears({ start: "2096-02-29", end: "2096-02-29" }, 4).start).toBe("2100-02-28");
    expect(shiftYears({ start: "1996-02-29", end: "1996-02-29" }, 4).start).toBe("2000-02-29");
  });
});
