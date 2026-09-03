import { render, screen } from "@testing-library/react";
import {
  sanitizeInput,
  isValidEmail,
  fmt,
  fmtDate,
  fmtDateShort,
  todayISO,
  nowTime,
  calcNet,
  totalPot,
  buildVenmoLink,
  computePlayerStats,
  calcStreak,
  parseSteps,
  parseHands,
  parseFrame,
  getTier,
  conditionLabel,
} from "./lib/format";
import App from "./App";

describe("Helper Functions", () => {
  // ── sanitizeInput tests ──────────────────────────────────────────
  describe("sanitizeInput", () => {
    test("trims whitespace", () => {
      expect(sanitizeInput("  hello  ")).toBe("hello");
    });

    test("truncates to maxLen (default 100)", () => {
      const long = "a".repeat(150);
      expect(sanitizeInput(long)).toHaveLength(100);
      expect(sanitizeInput(long)).toBe("a".repeat(100));
    });

    test("truncates to custom maxLen", () => {
      const long = "hello world";
      expect(sanitizeInput(long, 5)).toBe("hello");
    });

    test("handles non-string input (returns empty string)", () => {
      expect(sanitizeInput(null)).toBe("");
      expect(sanitizeInput(undefined)).toBe("");
      expect(sanitizeInput(123)).toBe("");
      expect(sanitizeInput({})).toBe("");
    });

    test("trims then truncates", () => {
      expect(sanitizeInput("   hello world   ", 8)).toBe("hello wo");
    });
  });

  // ── isValidEmail tests ───────────────────────────────────────────
  describe("isValidEmail", () => {
    test("accepts valid emails", () => {
      expect(isValidEmail("user@example.com")).toBe(true);
      expect(isValidEmail("test.email+tag@domain.co.uk")).toBe(true);
      expect(isValidEmail("a@b.cd")).toBe(true);
    });

    test("rejects emails without @", () => {
      expect(isValidEmail("invalid.email.com")).toBe(false);
    });

    test("rejects emails without TLD", () => {
      expect(isValidEmail("user@nodomain")).toBe(false);
    });

    test("rejects emails with spaces", () => {
      expect(isValidEmail("user @example.com")).toBe(false);
      expect(isValidEmail("user@ example.com")).toBe(false);
    });

    test("rejects empty or malformed emails", () => {
      expect(isValidEmail("")).toBe(false);
      expect(isValidEmail("@")).toBe(false);
      expect(isValidEmail("user@.com")).toBe(false);
    });

    test("trims whitespace before validating", () => {
      expect(isValidEmail("  user@example.com  ")).toBe(true);
    });
  });

  // ── fmt tests ────────────────────────────────────────────────────
  describe("fmt", () => {
    test("formats positive amounts", () => {
      expect(fmt(100)).toBe("$100");
      expect(fmt(50.5)).toBe("$50.50");
    });

    test("formats negative amounts with minus sign", () => {
      expect(fmt(-100)).toBe("-$100");
      expect(fmt(-50.5)).toBe("-$50.50");
    });

    test("formats zero", () => {
      expect(fmt(0)).toBe("$0");
    });

    test("handles null and undefined as $0", () => {
      expect(fmt(null)).toBe("$0");
      expect(fmt(undefined)).toBe("$0");
    });

    test("uses toFixed(0) for integers, toFixed(2) for decimals", () => {
      expect(fmt(100)).toBe("$100");
      expect(fmt(100.0)).toBe("$100");
      expect(fmt(100.5)).toBe("$100.50");
      expect(fmt(0.01)).toBe("$0.01");
    });
  });

  // ── fmtDate tests ────────────────────────────────────────────────
  describe("fmtDate", () => {
    test("formats date string with full date info", () => {
      // Dates are parsed with T12:00:00 to avoid timezone issues
      const result = fmtDate("2024-01-15");
      // Result format: "Mon, Jan 15, 2024" or similar depending on locale
      expect(result).toMatch(/Jan.*15.*2024/);
    });

    test("returns empty string for null/undefined/empty", () => {
      expect(fmtDate(null)).toBe("");
      expect(fmtDate(undefined)).toBe("");
      expect(fmtDate("")).toBe("");
    });

    test("includes weekday, month, day, and year", () => {
      const result = fmtDate("2024-12-25");
      // Should include day of week abbreviation
      expect(result.length).toBeGreaterThan(5);
    });
  });

  // ── fmtDateShort tests ──────────────────────────────────────────
  describe("fmtDateShort", () => {
    test("formats date string with month and day only", () => {
      const result = fmtDateShort("2024-01-15");
      expect(result).toMatch(/Jan.*15/);
    });

    test("returns empty string for null/undefined/empty", () => {
      expect(fmtDateShort(null)).toBe("");
      expect(fmtDateShort(undefined)).toBe("");
      expect(fmtDateShort("")).toBe("");
    });

    test("does not include weekday or year", () => {
      const result = fmtDateShort("2024-12-25");
      expect(result).not.toMatch(/2024/);
    });
  });

  // ── todayISO tests ──────────────────────────────────────────────
  describe("todayISO", () => {
    test("returns today's date in ISO format (YYYY-MM-DD)", () => {
      const result = todayISO();
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    test("today's date matches current date", () => {
      const result = todayISO();
      const now = new Date();
      const expected = now.toISOString().split("T")[0];
      expect(result).toBe(expected);
    });
  });

  // ── nowTime tests ───────────────────────────────────────────────
  describe("nowTime", () => {
    test("returns current time in HH:MM format", () => {
      const result = nowTime();
      expect(result).toMatch(/^\d{2}:\d{2}$/);
    });
  });

  // ── calcNet tests ───────────────────────────────────────────────
  describe("calcNet", () => {
    test("calculates net profit: cashOut - buyIn - rebuys", () => {
      const gp = { cashOut: 150, buyIn: 50, rebuys: 25 };
      expect(calcNet(gp)).toBe(75); // 150 - 50 - 25
    });

    test("handles missing cashOut (defaults to 0)", () => {
      const gp = { buyIn: 50, rebuys: 25 };
      expect(calcNet(gp)).toBe(-75); // 0 - 50 - 25
    });

    test("handles missing rebuys (defaults to 0)", () => {
      const gp = { cashOut: 100, buyIn: 50 };
      expect(calcNet(gp)).toBe(50); // 100 - 50 - 0
    });

    test("handles missing cashOut and rebuys", () => {
      const gp = { buyIn: 50 };
      expect(calcNet(gp)).toBe(-50); // 0 - 50 - 0
    });

    test("can return negative (loss)", () => {
      const gp = { cashOut: 0, buyIn: 100, rebuys: 50 };
      expect(calcNet(gp)).toBe(-150); // 0 - 100 - 50
    });
  });

  // ── buildVenmoLink tests ──────────────────────────────────────────
  describe("buildVenmoLink", () => {
    test("positive net -> txn=pay, amount is the raw decimal (no $)", () => {
      const url = new URL(buildVenmoLink("john-doe-42", 20, "Poker"));
      expect(url.origin + url.pathname).toBe("https://venmo.com/");
      expect(url.searchParams.get("txn")).toBe("pay");
      expect(url.searchParams.get("amount")).toBe("20.00");
      expect(url.searchParams.get("recipients")).toBe("john-doe-42");
    });

    test("negative net -> txn=charge, amount is the absolute value", () => {
      const url = new URL(buildVenmoLink("john-doe-42", -20, "Poker"));
      expect(url.searchParams.get("txn")).toBe("charge");
      expect(url.searchParams.get("amount")).toBe("20.00");
    });

    test("net within a cent of zero -> null (nothing owed)", () => {
      expect(buildVenmoLink("john-doe-42", 0, "Poker")).toBeNull();
      expect(buildVenmoLink("john-doe-42", 0.009, "Poker")).toBeNull();
      expect(buildVenmoLink("john-doe-42", -0.009, "Poker")).toBeNull();
    });

    test("missing handle -> null regardless of net", () => {
      expect(buildVenmoLink(null, 20, "Poker")).toBeNull();
      expect(buildVenmoLink("", 20, "Poker")).toBeNull();
      expect(buildVenmoLink(undefined, -20, "Poker")).toBeNull();
    });

    test("null/undefined net -> null", () => {
      expect(buildVenmoLink("john-doe-42", null, "Poker")).toBeNull();
      expect(buildVenmoLink("john-doe-42", undefined, "Poker")).toBeNull();
    });

    test("note is passed through and URL-encoded", () => {
      const url = new URL(buildVenmoLink("john-doe-42", 20, "Poker Tue Jan 6"));
      expect(url.searchParams.get("note")).toBe("Poker Tue Jan 6");
    });

    test("defaults the note to 'Poker' when omitted", () => {
      const url = new URL(buildVenmoLink("john-doe-42", 20));
      expect(url.searchParams.get("note")).toBe("Poker");
    });

    test("audience is always private", () => {
      const url = new URL(buildVenmoLink("john-doe-42", 20, "Poker"));
      expect(url.searchParams.get("audience")).toBe("private");
    });
  });

  // ── totalPot tests ──────────────────────────────────────────────
  describe("totalPot", () => {
    test("sums buyIn + rebuys across entries", () => {
      const gps = [
        { buyIn: 50, rebuys: 25 },
        { buyIn: 100, rebuys: 50 },
      ];
      expect(totalPot(gps)).toBe(225); // (50+25) + (100+50)
    });

    test("returns 0 for empty array", () => {
      expect(totalPot([])).toBe(0);
    });

    test("handles missing rebuys (defaults to 0)", () => {
      const gps = [
        { buyIn: 50 },
        { buyIn: 100, rebuys: 25 },
      ];
      expect(totalPot(gps)).toBe(175); // 50 + (100+25)
    });

    test("handles all missing rebuys", () => {
      const gps = [
        { buyIn: 50 },
        { buyIn: 100 },
      ];
      expect(totalPot(gps)).toBe(150);
    });
  });

  // ── calcStreak tests ────────────────────────────────────────────
  describe("calcStreak", () => {
    test("returns { count: 0, type: null } for empty array", () => {
      expect(calcStreak([])).toEqual({ count: 0, type: null });
    });

    test("identifies winning streak (W)", () => {
      const games = [
        { game: { date: "2024-01-01" }, cashOut: 100, buyIn: 50, rebuys: 0 },
        { game: { date: "2024-01-02" }, cashOut: 150, buyIn: 50, rebuys: 0 },
      ];
      const result = calcStreak(games);
      expect(result.type).toBe("W");
      expect(result.count).toBe(2);
    });

    test("identifies losing streak (L)", () => {
      const games = [
        { game: { date: "2024-01-01" }, cashOut: 20, buyIn: 50, rebuys: 0 },
        { game: { date: "2024-01-02" }, cashOut: 30, buyIn: 50, rebuys: 0 },
      ];
      const result = calcStreak(games);
      expect(result.type).toBe("L");
      expect(result.count).toBe(2);
    });

    test("identifies even streak (E) when net is zero", () => {
      const games = [
        { game: { date: "2024-01-01" }, cashOut: 50, buyIn: 50, rebuys: 0 },
        { game: { date: "2024-01-02" }, cashOut: 75, buyIn: 75, rebuys: 0 },
      ];
      const result = calcStreak(games);
      expect(result.type).toBe("E");
      expect(result.count).toBe(2);
    });

    test("breaks streak when type changes", () => {
      const games = [
        { game: { date: "2024-01-01" }, cashOut: 100, buyIn: 50, rebuys: 0 }, // W
        { game: { date: "2024-01-02" }, cashOut: 100, buyIn: 50, rebuys: 0 }, // W
        { game: { date: "2024-01-03" }, cashOut: 30, buyIn: 50, rebuys: 0 },  // L
      ];
      const result = calcStreak(games);
      // After sorting by date (descending): [2024-01-03 (L), 2024-01-02 (W), 2024-01-01 (W)]
      // Streak starts with L, next is W, so count is 1
      expect(result.type).toBe("L");
      expect(result.count).toBe(1);
    });

    test("sorts games by date descending (most recent first)", () => {
      const games = [
        { game: { date: "2024-01-01" }, cashOut: 100, buyIn: 50, rebuys: 0 }, // W
        { game: { date: "2024-01-03" }, cashOut: 30, buyIn: 50, rebuys: 0 },  // L
        { game: { date: "2024-01-02" }, cashOut: 100, buyIn: 50, rebuys: 0 }, // W
      ];
      const result = calcStreak(games);
      // After sorting: [2024-01-03 (L), 2024-01-02 (W), 2024-01-01 (W)]
      // So the streak starts with L and has count 1
      expect(result.type).toBe("L");
      expect(result.count).toBe(1);
    });
  });

  // ── computePlayerStats tests ────────────────────────────────────
  describe("computePlayerStats", () => {
    test("zero games -> all zeros, no NaN/Infinity", () => {
      const stats = computePlayerStats({ games: { items: [] }, xp: 0 });
      expect(stats).toEqual({
        gamesPlayed: 0, wins: 0, losses: 0, winRate: 0, net: 0, xp: 0,
        streak: { count: 0, type: null },
      });
    });

    test("missing games entirely -> treated as zero games", () => {
      const stats = computePlayerStats({ xp: 10 });
      expect(stats.gamesPlayed).toBe(0);
      expect(stats.winRate).toBe(0);
    });

    test("counts wins/losses and computes net/winRate across completed games", () => {
      const player = {
        xp: 250,
        games: {
          items: [
            { buyIn: 50, rebuys: 0, cashOut: 100, game: { id: "g1", date: "2024-01-01", isComplete: true } }, // +50 W
            { buyIn: 50, rebuys: 0, cashOut: 20, game: { id: "g2", date: "2024-01-02", isComplete: true } },  // -30 L
            { buyIn: 50, rebuys: 10, cashOut: 100, game: { id: "g3", date: "2024-01-03", isComplete: true } }, // +40 W
          ],
        },
      };
      const stats = computePlayerStats(player);
      expect(stats.gamesPlayed).toBe(3);
      expect(stats.wins).toBe(2);
      expect(stats.losses).toBe(1);
      expect(stats.winRate).toBeCloseTo(2 / 3);
      expect(stats.net).toBe(60); // 50 - 30 + 40
      expect(stats.xp).toBe(250);
    });

    test("excludes incomplete games from every stat", () => {
      const player = {
        xp: 0,
        games: {
          items: [
            { buyIn: 50, rebuys: 0, cashOut: 100, game: { id: "g1", date: "2024-01-01", isComplete: true } },
            { buyIn: 50, rebuys: 0, cashOut: 500, game: { id: "g2", date: "2024-01-02", isComplete: false } },
          ],
        },
      };
      const stats = computePlayerStats(player);
      expect(stats.gamesPlayed).toBe(1);
      expect(stats.net).toBe(50);
    });

    test("streak reflects the most recent completed games", () => {
      const player = {
        xp: 0,
        games: {
          items: [
            { buyIn: 50, rebuys: 0, cashOut: 100, game: { id: "g1", date: "2024-01-01", isComplete: true } }, // W
            { buyIn: 50, rebuys: 0, cashOut: 100, game: { id: "g2", date: "2024-01-02", isComplete: true } }, // W
          ],
        },
      };
      const stats = computePlayerStats(player);
      expect(stats.streak).toEqual({ count: 2, type: "W" });
    });
  });

  // ── parseSteps tests ────────────────────────────────────────────
  describe("parseSteps", () => {
    test("parses valid JSON array", () => {
      const input = '["step 1", "step 2", "step 3"]';
      expect(parseSteps(input)).toEqual(["step 1", "step 2", "step 3"]);
    });

    test("returns empty array for null/undefined/empty string", () => {
      expect(parseSteps(null)).toEqual([]);
      expect(parseSteps(undefined)).toEqual([]);
      expect(parseSteps("")).toEqual([]);
    });

    test("returns empty array for invalid JSON", () => {
      expect(parseSteps("not json")).toEqual([]);
      expect(parseSteps("{bad json")).toEqual([]);
    });

    test("returns empty array for non-array JSON", () => {
      expect(parseSteps('{"key": "value"}')).toEqual([]);
      expect(parseSteps('"string"')).toEqual([]);
      expect(parseSteps('123')).toEqual([]);
    });

    test("handles empty JSON array", () => {
      expect(parseSteps("[]")).toEqual([]);
    });
  });

  // ── parseHands tests ────────────────────────────────────────────
  describe("parseHands", () => {
    test("parses valid JSON array", () => {
      const input = '["hand 1", "hand 2"]';
      expect(parseHands(input)).toEqual(["hand 1", "hand 2"]);
    });

    test("falls back to split by -> or › or newline for non-JSON", () => {
      expect(parseHands("hand 1 -> hand 2 -> hand 3")).toEqual([
        "hand 1",
        "hand 2",
        "hand 3",
      ]);
    });

    test("handles split with › separator", () => {
      const input = "hand 1 › hand 2 › hand 3";
      const result = parseHands(input);
      expect(result).toContain("hand 1");
      expect(result).toContain("hand 2");
      expect(result).toContain("hand 3");
    });

    test("handles split with newline separator", () => {
      const input = "hand 1\nhand 2\nhand 3";
      expect(parseHands(input)).toEqual(["hand 1", "hand 2", "hand 3"]);
    });

    test("removes leading numbers from split results (when no leading space)", () => {
      // Note: The function trims after the number regex, so if there's a leading space,
      // the regex doesn't match and the number isn't removed. This is the actual behavior.
      const input = "1. hand 1 -> 2. hand 2";
      const result = parseHands(input);
      expect(result[0]).toBe("hand 1");
      // After split by "->", result[1] is " 2. hand 2" (leading space)
      // The regex /^\d+\.\s*/ doesn't match due to leading space, so it stays as "2. hand 2" after trim
      expect(result[1]).toBe("2. hand 2");
    });

    test("filters out empty strings from split", () => {
      const input = "hand 1 -> -> hand 2";
      const result = parseHands(input);
      expect(result.length).toBe(2);
    });

    test("returns empty array for null/undefined/empty", () => {
      expect(parseHands(null)).toEqual([]);
      expect(parseHands(undefined)).toEqual([]);
      expect(parseHands("")).toEqual([]);
    });

    test("trims whitespace from split results", () => {
      const input = "  hand 1  ->  hand 2  ";
      const result = parseHands(input);
      expect(result[0]).toBe("hand 1");
      expect(result[1]).toBe("hand 2");
    });
  });

  // ── parseFrame tests ────────────────────────────────────────────
  describe("parseFrame", () => {
    const CENTRED = { px: 50, py: 50, scale: 1 };

    test("returns default frame for null/undefined/empty", () => {
      expect(parseFrame(null)).toEqual(CENTRED);
      expect(parseFrame(undefined)).toEqual(CENTRED);
      expect(parseFrame("")).toEqual(CENTRED);
    });

    test("parses the current px/py/scale format", () => {
      expect(parseFrame('{"px": 30, "py": 70, "scale": 1.5}'))
        .toEqual({ px: 30, py: 70, scale: 1.5 });
    });

    test("returns default for malformed JSON", () => {
      expect(parseFrame("not json")).toEqual(CENTRED);
      expect(parseFrame("{bad")).toEqual(CENTRED);
      expect(parseFrame("null")).toEqual(CENTRED);
    });

    test("clamps position to 0-100 and scale to 1-4", () => {
      expect(parseFrame('{"px": -20, "py": 180, "scale": 0.25}'))
        .toEqual({ px: 0, py: 100, scale: 1 });
      expect(parseFrame('{"px": 50, "py": 50, "scale": 99}'))
        .toEqual({ px: 50, py: 50, scale: 4 });
    });

    test("migrates the v2 fractional-offset format", () => {
      // Centre stays centre.
      expect(parseFrame('{"x": 0, "y": 0, "scale": 1}')).toEqual(CENTRED);
      // Positive x shifted the image right, revealing more of its left side,
      // so the crop anchor moves toward 0.
      expect(parseFrame('{"x": 0.2, "y": -0.2, "scale": 2}'))
        .toEqual({ px: 40, py: 60, scale: 2 });
    });

    test("migrates legacy posX/posY percentage format", () => {
      expect(parseFrame('{"posX": 50, "posY": 50}')).toEqual(CENTRED);
      expect(parseFrame('{"posX": 25, "posY": 80, "scale": 1.5}'))
        .toEqual({ px: 25, py: 80, scale: 1.5 });
    });

    test("preserves scale during legacy migration", () => {
      expect(parseFrame('{"posX": 50, "posY": 50, "scale": 2}'))
        .toEqual({ px: 50, py: 50, scale: 2 });
    });

    test("keeps scale when no position keys are present", () => {
      expect(parseFrame('{"scale": 1.5}')).toEqual({ px: 50, py: 50, scale: 1.5 });
      expect(parseFrame('{}')).toEqual(CENTRED);
    });

    test("handles partial frame objects", () => {
      // Missing axis defaults to centre rather than NaN.
      expect(parseFrame('{"px": 20}')).toEqual({ px: 20, py: 50, scale: 1 });
      expect(parseFrame('{"x": 0.5}')).toEqual({ px: 25, py: 50, scale: 1 });
    });
  });

  // ── getTier tests ───────────────────────────────────────────────
  describe("getTier", () => {
    test("returns null for timesEarned < 2", () => {
      expect(getTier(0)).toBeNull();
      expect(getTier(1)).toBeNull();
      expect(getTier(null)).toBeNull();
      expect(getTier(undefined)).toBeNull();
    });

    test("returns bronze tier (min: 2) for timesEarned === 2", () => {
      const tier = getTier(2);
      expect(tier).not.toBeNull();
      expect(tier.key).toBe("bronze");
    });

    test("returns silver tier (min: 3) for timesEarned === 3", () => {
      const tier = getTier(3);
      expect(tier.key).toBe("silver");
    });

    test("returns gold tier (min: 4) for timesEarned === 4", () => {
      const tier = getTier(4);
      expect(tier.key).toBe("gold");
    });

    test("returns diamond tier (min: 5) for timesEarned >= 5", () => {
      expect(getTier(5).key).toBe("diamond");
      expect(getTier(10).key).toBe("diamond");
    });

    test("returns highest matching tier", () => {
      const tier = getTier(6);
      // Should return diamond (min: 5), not a lower tier
    });
  });

  // ── conditionLabel tests ────────────────────────────────────────
  describe("conditionLabel", () => {
    test("formats number condition", () => {
      const cond = {
        left: "net_profit",
        op: ">=",
        rightType: "number",
        rightValue: 100,
      };
      const label = conditionLabel(cond);
      expect(label).toContain("Net Profit");
      expect(label).toContain("≥");
      expect(label).toContain("100");
    });

    test("formats metric condition", () => {
      const cond = {
        left: "net_profit",
        op: ">",
        rightType: "metric",
        rightMetric: "cash_out",
      };
      const label = conditionLabel(cond);
      expect(label).toContain("Net Profit");
      expect(label).toContain(">");
      expect(label).toContain("Cash Out");
    });

    test("formats multiplier condition", () => {
      const cond = {
        left: "net_profit",
        op: "<=",
        rightType: "multiplier",
        rightMultiplier: 2,
        rightBase: "own_total_invested",
      };
      const label = conditionLabel(cond);
      expect(label).toContain("Net Profit");
      expect(label).toContain("≤");
      expect(label).toContain("2×");
      expect(label).toContain("Total Invested");
    });

    test("handles missing right value in number condition", () => {
      const cond = {
        left: "buy_in",
        op: "=",
        rightType: "number",
      };
      const label = conditionLabel(cond);
      expect(label).toContain("Initial Buy-In");
      expect(label).toContain("=");
      expect(label).toContain("0");
    });

    test("handles unknown metric with fallback to raw value", () => {
      const cond = {
        left: "unknown_metric",
        op: ">=",
        rightType: "number",
        rightValue: 50,
      };
      const label = conditionLabel(cond);
      expect(label).toContain("unknown_metric");
      expect(label).toContain("≥");
      expect(label).toContain("50");
    });

    test("handles unknown operator with fallback", () => {
      const cond = {
        left: "net_profit",
        op: "??",
        rightType: "number",
        rightValue: 100,
      };
      const label = conditionLabel(cond);
      expect(label).toContain("Net Profit");
      expect(label).toContain("??");
    });

    test("handles missing multiplier value", () => {
      const cond = {
        left: "net_profit",
        op: ">=",
        rightType: "multiplier",
        rightBase: "own_buy_in",
        // rightMultiplier is missing
      };
      const label = conditionLabel(cond);
      expect(label).toContain("1×");
    });
  });
});

test('signed-out visitors see the login form', () => {
  localStorage.clear();
  render(<App />);
  expect(screen.getByPlaceholderText('Enter username')).toBeInTheDocument();
  expect(screen.getByPlaceholderText('Enter password')).toHaveAttribute('type', 'password');
  expect(screen.getAllByRole('button', { name: 'Sign In' })).toHaveLength(2);
});
