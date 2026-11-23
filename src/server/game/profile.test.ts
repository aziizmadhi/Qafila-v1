import { describe, expect, it } from "vitest";
import { computeStreaks } from "./profile";

describe("computeStreaks", () => {
  it("counts consecutive days ending today or yesterday", () => {
    expect(computeStreaks(["2026-11-18", "2026-11-19", "2026-11-20"], "2026-11-20")).toEqual({ current: 3, best: 3 });
    expect(computeStreaks(["2026-11-18", "2026-11-19"], "2026-11-20")).toEqual({ current: 2, best: 2 });
    expect(computeStreaks(["2026-11-17", "2026-11-18"], "2026-11-20")).toEqual({ current: 0, best: 2 });
    expect(computeStreaks(["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-20"], "2026-11-20")).toEqual({
      current: 1,
      best: 3,
    });
    expect(computeStreaks([], "2026-11-20")).toEqual({ current: 0, best: 0 });
  });
});
