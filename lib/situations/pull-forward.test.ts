import { describe, it, expect } from "vitest";
import { levelLoad, monthsFor, type LevelMonthInput } from "./pull-forward";

/** A month with fixed (formal) load and one movable lot per key. */
const m = (
  period: string,
  fixedHours: number,
  lots: Record<string, number> = {},
  availableHours = 1000
): LevelMonthInput => ({
  period,
  fixedHours,
  lots: Object.entries(lots).map(([key, hours]) => ({ key, hours })),
  availableHours,
});

const loadOf = (x: LevelMonthInput) => x.fixedHours + x.lots.reduce((s, l) => s + l.hours, 0);

/** The screenshot: April has room, May and June are exactly full, July is 130h over. */
const screenshot = () => [
  m("2027-04", 300, { apr: 200 }),
  m("2027-05", 600, { may: 400 }),
  m("2027-06", 700, { jun: 300 }),
  m("2027-07", 800, { jul: 330 }),
];

describe("levelLoad — cascading pull forward", () => {
  it("resolves July through a chain when May and June are full and April has room", () => {
    const result = levelLoad(screenshot(), 8);
    const [apr, may, jun, jul] = result.months;
    expect(jul!.overflowBeforeHours).toBe(130);
    expect(jul!.overflowAfterHours).toBeCloseTo(0, 9);
    expect(jul!.movedOutHours).toBeCloseTo(130, 9);
    // May and June stay exactly full; April absorbs the 130h.
    expect(may!.loadAfterHours).toBeCloseTo(1000, 9);
    expect(jun!.loadAfterHours).toBeCloseTo(1000, 9);
    expect(apr!.loadAfterHours).toBeCloseTo(630, 9);
    expect(result.totalOverflowAfterHours).toBeCloseTo(0, 9);
  });

  it("records the chain as one-month moves per SKU", () => {
    const moves = levelLoad(screenshot(), 4).moves;
    expect(moves).toEqual([
      { key: "jul", from: "2027-07", to: "2027-06", hours: 130 },
      { key: "jun", from: "2027-06", to: "2027-05", hours: 130 },
      { key: "may", from: "2027-05", to: "2027-04", hours: 130 },
    ]);
  });

  it("at zero weeks nothing moves", () => {
    const result = levelLoad(screenshot(), 0);
    expect(result.direction).toBe("none");
    expect(result.moves).toEqual([]);
    result.months.forEach((mo, i) => expect(mo.loadAfterHours).toBe(loadOf(screenshot()[i]!)));
    expect(result.months[3]!.overflowAfterHours).toBe(130);
  });

  it("never moves formal (fixed) load", () => {
    // July is over only because of formal load and has nothing movable.
    const result = levelLoad([m("2027-06", 0), m("2027-07", 1200)], 8);
    expect(result.totalMovedHours).toBe(0);
    expect(result.months[1]!.overflowAfterHours).toBe(200);

    // Only the 50h lot can move, even though 200h are over.
    const partial = levelLoad([m("2027-06", 0), m("2027-07", 1150, { a: 50 })], 8);
    expect(partial.totalMovedHours).toBe(50);
    expect(partial.months[1]!.overflowAfterHours).toBe(150);
  });

  it("conserves hours", () => {
    const input = [
      m("2027-03", 100, { a: 50 }),
      m("2027-04", 500, { b: 300, c: 100 }),
      m("2027-05", 900, { d: 400 }),
      m("2027-06", 700, { e: 600 }),
      m("2027-07", 800, { f: 500, g: 200 }),
    ];
    const before = input.reduce((s, x) => s + loadOf(x), 0);
    for (const weeks of [2, 4, 8, 12]) {
      const result = levelLoad(input, weeks);
      expect(result.months.reduce((s, x) => s + x.loadAfterHours, 0)).toBeCloseTo(before, 6);
      expect(result.moves.reduce((s, x) => s + x.hours, 0)).toBeCloseTo(result.totalMovedHours, 6);
      expect(result.months.reduce((s, x) => s + x.movedInHours, 0)).toBeCloseTo(result.totalMovedHours, 6);
      // Fixed load stays put: no month runs below its formal hours.
      result.months.forEach((mo, i) => expect(mo.loadAfterHours).toBeGreaterThanOrEqual(input[i]!.fixedHours - 1e-6));
    }
  });

  it("never moves a build further than the window", () => {
    // One month of reach: July's lot may go to June but not to May.
    const result = levelLoad([m("2027-05", 0), m("2027-06", 1000), m("2027-07", 900, { jul: 200 })], 4);
    expect(result.moves).toEqual([]);
    const wider = levelLoad([m("2027-05", 0), m("2027-06", 1000), m("2027-07", 900, { jul: 200 })], 8);
    expect(wider.moves).toEqual([{ key: "jul", from: "2027-07", to: "2027-05", hours: 100 }]);
    for (const move of levelLoad(screenshot(), 8).moves) {
      const gap = (Number(move.from.slice(0, 4)) * 12 + Number(move.from.slice(5))) -
        (Number(move.to.slice(0, 4)) * 12 + Number(move.to.slice(5)));
      expect(gap).toBeGreaterThan(0);
      expect(gap).toBeLessThanOrEqual(monthsFor(8));
    }
  });

  it("never moves before the first month shown or before today's month", () => {
    expect(levelLoad([m("2027-08", 900, { a: 300 })], 8).totalMovedHours).toBe(0);
    const result = levelLoad([m("2027-05", 0), m("2027-06", 900, { a: 300 })], 8, { earliestPeriod: "2027-06" });
    expect(result.totalMovedHours).toBe(0);
    expect(result.months[1]!.overflowAfterHours).toBe(200);
  });

  it("stops when no earlier headroom exists within reach", () => {
    const result = levelLoad([m("2027-05", 1000), m("2027-06", 800, { jun: 200 }), m("2027-07", 900, { jul: 300 })], 8);
    expect(result.totalMovedHours).toBe(0);
    expect(result.months[2]!.overflowAfterHours).toBe(200);
  });

  it("processes latest months first", () => {
    // June and July both over; April has 100h. July's chain claims it first.
    const result = levelLoad([m("2027-05", 900), m("2027-06", 900, { jun: 200 }), m("2027-07", 900, { jul: 200 })], 4);
    const [may, jun, jul] = result.months;
    expect(may!.loadAfterHours).toBeCloseTo(1000, 9);
    expect(jul!.overflowAfterHours).toBeCloseTo(0, 9);
    expect(jun!.overflowAfterHours).toBeCloseTo(100, 9);
  });
});

describe("weeks", () => {
  it("converts weeks to whole months, keeping zero at zero and ignoring negatives", () => {
    expect(monthsFor(0)).toBe(0);
    expect(monthsFor(-4)).toBe(0);
    expect(monthsFor(2)).toBe(1);
    expect(monthsFor(8)).toBe(2);
  });
});
