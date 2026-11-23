import { describe, expect, it } from "vitest";
import { blendedShare, liveWeight, rarityScore, scoreAnswer } from "./scoring";
import { answerTier, journeyTier, tierIndex } from "./tiers";
import { addDays, isIsoDate, nextResetAt, riyadhDate } from "./time";
import { buildShareText } from "./share";

describe("scoring", () => {
  it("uses only the seed with no live data", () => {
    expect(blendedShare(0.3, 0, 0)).toBeCloseTo(0.3);
    expect(scoreAnswer({ correct: true, seedFrequency: 0.3, liveCount: 0, liveTotal: 0 })).toBe(70);
  });

  it("blends linearly until 200 responses", () => {
    expect(liveWeight(100)).toBe(0.5);
    // half seed (0.4), half live (10/100 = 0.1) → 0.25
    expect(blendedShare(0.4, 10, 100)).toBeCloseTo(0.25);
    expect(liveWeight(200)).toBe(1);
    expect(liveWeight(5000)).toBe(1);
    expect(blendedShare(0.9, 50, 1000)).toBeCloseTo(0.05);
  });

  it("gives at least 10 for a correct answer and 0 for a wrong one", () => {
    expect(rarityScore(1)).toBe(10);
    expect(rarityScore(0.95)).toBe(10);
    expect(rarityScore(0)).toBe(100);
    expect(scoreAnswer({ correct: false, seedFrequency: 0, liveCount: 0, liveTotal: 0 })).toBe(0);
  });

  it("rounds to the nearest km", () => {
    expect(rarityScore(0.125)).toBe(88);
    expect(rarityScore(0.334)).toBe(67);
  });
});

describe("tiers", () => {
  it("maps answer scores", () => {
    expect(answerTier(0)).toBeNull();
    expect(answerTier(10)?.id).toBe("camp");
    expect(answerTier(79)?.id).toBe("camp");
    expect(answerTier(80)?.id).toBe("dunes");
    expect(answerTier(90)?.id).toBe("mirage");
    expect(answerTier(96)?.id).toBe("oasis");
    expect(answerTier(99)?.id).toBe("star");
    expect(tierIndex(0)).toBe(0);
    expect(tierIndex(100)).toBe(5);
  });

  it("maps journey totals", () => {
    expect(journeyTier(0).id).toBe("camp");
    expect(journeyTier(349).id).toBe("camp");
    expect(journeyTier(479).id).toBe("dunes");
    expect(journeyTier(520).id).toBe("mirage");
    expect(journeyTier(650).id).toBe("star");
  });
});

describe("time", () => {
  it("uses the Riyadh calendar day", () => {
    expect(riyadhDate(new Date("2026-11-23T20:59:59Z"))).toBe("2026-11-23");
    expect(riyadhDate(new Date("2026-11-23T21:00:00Z"))).toBe("2026-11-24");
  });
  it("computes the next reset", () => {
    expect(nextResetAt("2026-11-23").toISOString()).toBe("2026-11-23T21:00:00.000Z");
  });
  it("validates dates", () => {
    expect(isIsoDate("2026-02-29")).toBe(false);
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(isIsoDate("2026-1-1")).toBe(false);
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("share text", () => {
  it("is spoiler-free and RTL-safe", () => {
    const text = buildShareText({
      journeyNumber: 12,
      scores: [0, 30, 85, 92, 97, 99, 81],
      totalKm: 484,
      url: "https://example.com",
    });
    const lines = text.split("\n");
    expect(lines[0]).toBe("‏قافلة #12 · 484 كم");
    expect(lines[1]).toBe("‏⬛⛺🐪🌫️🌴🌟🐪");
    expect(lines[2]).toContain("السراب"); // 484 km → mirage
    expect(lines[3]).toBe("https://example.com");
  });
});
