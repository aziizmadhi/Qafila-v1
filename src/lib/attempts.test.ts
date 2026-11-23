import { describe, expect, it } from "vitest";
import { AttemptGate } from "./attempts";
import { ANSWER_WINDOW_MS, MIN_ATTEMPT_GAP_MS, QUESTION_MS, TRANSITION_MS, nextQuestionStart } from "./timing";

describe("retries on the client (AttemptGate)", () => {
  it("ignores empty answers", () => {
    const g = new AttemptGate();
    expect(g.check(1, "", 0)).toEqual({ kind: "empty" });
    expect(g.check(1, "   \n ", 0)).toEqual({ kind: "empty" });
  });

  it("lets a player retry with a different answer after a wrong one", () => {
    const g = new AttemptGate();
    const first = g.check(1, "طوكيو", 0);
    expect(first).toMatchObject({ kind: "send", raw: "طوكيو", waitMs: 0 });
    g.sent(0);
    g.wrong(1, first.kind === "send" ? first.norm : "");
    expect(g.check(1, "سيول", 1000)).toMatchObject({ kind: "send", raw: "سيول", waitMs: 0 });
  });

  it("treats the same wrong answer again, in any spelling, as a duplicate (no request)", () => {
    const g = new AttemptGate();
    const c = g.check(3, "القاهرة", 0);
    if (c.kind !== "send") throw new Error("expected send");
    g.sent(0);
    g.wrong(3, c.norm);
    for (const again of ["القاهرة", "  القاهره ", "القاهِرة", "قاهرة", "القاهرة!"]) {
      expect(g.check(3, again, 5000)).toMatchObject({ kind: "duplicate" });
    }
    // Only on that question.
    expect(g.check(4, "القاهرة", 5000)).toMatchObject({ kind: "send" });
  });

  it("doesn't remember answers that weren't wrong", () => {
    const g = new AttemptGate();
    const c = g.check(1, "الرياض", 0);
    g.sent(0);
    expect(c.kind).toBe("send");
    // No g.wrong(): it was correct (or the request failed), so it can be sent again.
    expect(g.check(1, "الرياض", 1000)).toMatchObject({ kind: "send" });
  });

  it("spaces attempts MIN_ATTEMPT_GAP_MS apart instead of dropping them", () => {
    const g = new AttemptGate();
    g.sent(10_000);
    expect(g.check(1, "أ ب", 10_000)).toMatchObject({ kind: "send", waitMs: MIN_ATTEMPT_GAP_MS });
    expect(g.check(1, "أ ب", 10_150)).toMatchObject({ kind: "send", waitMs: MIN_ATTEMPT_GAP_MS - 150 });
    expect(g.check(1, "أ ب", 10_000 + MIN_ATTEMPT_GAP_MS)).toMatchObject({ kind: "send", waitMs: 0 });
  });
});

describe("chained clock", () => {
  it("uses the server's numbers", () => {
    expect([QUESTION_MS, ANSWER_WINDOW_MS, TRANSITION_MS, MIN_ATTEMPT_GAP_MS]).toEqual([30_000, 32_000, 3_000, 400]);
  });

  it("starts the next question 3 s after a correct answer", () => {
    expect(nextQuestionStart(1_000, 9_000)).toBe(12_000);
  });

  it("starts the next question 3 s after the displayed deadline on a timeout", () => {
    expect(nextQuestionStart(1_000, null)).toBe(1_000 + 30_000 + 3_000);
  });

  it("counts an answer in the grace period from the displayed deadline", () => {
    expect(nextQuestionStart(0, 31_500)).toBe(33_000);
  });
});
