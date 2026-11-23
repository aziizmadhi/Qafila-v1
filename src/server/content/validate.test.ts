import { describe, expect, it } from "vitest";
import { parseCsv, toCsv } from "./csv";
import { formatIssue } from "./model";
import { hasErrors, parseContentCsv, parseFrequency } from "./validate";

const HEADER = "date,question_number,category,question_text,canonical_answer,variants,seed_frequency";

function day(date: string, overrides: Record<number, string[]> = {}): string[] {
  const lines: string[] = [];
  for (let q = 1; q <= 7; q++) {
    lines.push(
      ...(overrides[q] ?? [
        `${date},${q},geography,سؤال رقم ${q}؟,جواب أ ${q},ا${q}|alpha${q},0.3`,
        `${date},${q},geography,سؤال رقم ${q}؟,جواب ب ${q},b${q},0.2`,
        `${date},${q},geography,سؤال رقم ${q}؟,جواب ج ${q},,0.1`,
      ]),
    );
  }
  return lines;
}

function parse(lines: string[]) {
  return parseContentCsv([HEADER, ...lines].join("\n"));
}

function messages(lines: string[]) {
  return parse(lines).issues.map(formatIssue);
}

describe("parseCsv", () => {
  it("handles quotes, escaped quotes, commas, CRLF and a BOM", () => {
    const recs = parseCsv('﻿a,b\r\n"x, y","he said ""hi"""\r\n"multi\nline",z\r\n');
    expect(recs).toEqual([
      { row: 1, fields: ["a", "b"] },
      { row: 2, fields: ["x, y", 'he said "hi"'] },
      { row: 3, fields: ["multi\nline", "z"] },
    ]);
  });

  it("round-trips through toCsv", () => {
    const rows = [["مصر", 'a "b"', "x,y", 3]];
    const back = parseCsv(toCsv(rows));
    expect(back[0]!.fields).toEqual(["مصر", 'a "b"', "x,y", "3"]);
  });

  it("reports an unclosed quote", () => {
    expect(() => parseCsv('a,b\n"oops,c\n')).toThrow(/Row 2/);
  });
});

describe("parseFrequency", () => {
  it.each([
    ["0.25", 0.25],
    [".5", 0.5],
    ["25%", 0.25],
    ["0,25", 0.25],
    ["٠٫٢٥", 0.25],
    ["1", 1],
    ["", null],
    ["abc", null],
    ["-0.1", null],
  ])("%s → %s", (raw, expected) => {
    expect(parseFrequency(raw)).toBe(expected);
  });
});

describe("parseContentCsv", () => {
  it("accepts a valid day and builds 7 questions", () => {
    const res = parse(day("2026-11-16"));
    expect(hasErrors(res.issues)).toBe(false);
    expect(res.journeys).toHaveLength(1);
    const j = res.journeys[0]!;
    expect(j.track).toBe("daily");
    expect(j.questions.map((q) => q.position)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(j.questions[0]!.answers[0]!.variants).toEqual(["ا1", "alpha1"]);
    expect(j.questions[0]!.answers[0]!.key).toBe("جواب ا 1");
  });

  it("requires exactly 7 questions per date", () => {
    const lines = day("2026-11-16").filter((l) => !l.includes(",4,"));
    const msgs = messages(lines);
    expect(msgs.some((m) => m.includes("missing 4"))).toBe(true);
  });

  it("rejects question numbers outside 1-7, with the row number", () => {
    const lines = day("2026-11-16");
    lines.push("2026-11-16,8,geography,سؤال؟,جواب,,0.1");
    expect(messages(lines)).toContain(
      '✖ Row 23: question_number "8" must be a whole number from 1 to 7.',
    );
  });

  it("rejects duplicate canonicals after normalization", () => {
    const lines = day("2026-11-16", {
      2: [
        "2026-11-16,2,geography,سؤال؟,القاهرة,,0.3",
        "2026-11-16,2,geography,سؤال؟,القاهره,,0.2",
        "2026-11-16,2,geography,سؤال؟,دمشق,,0.1",
      ],
    });
    const msgs = messages(lines);
    expect(msgs.find((m) => m.includes("duplicate canonical"))).toMatch(/^✖ Rows 5, 6:/);
  });

  it("rejects a variant that would match two canonicals", () => {
    const lines = day("2026-11-16", {
      1: [
        "2026-11-16,1,geography,سؤال؟,الأردن,jordan,0.3",
        "2026-11-16,1,geography,سؤال؟,نهر الأردن,Jordan,0.2",
        "2026-11-16,1,geography,سؤال؟,مصر,,0.1",
      ],
    });
    expect(messages(lines).some((m) => m.includes('"jordan" would match both'))).toBe(true);
  });

  it("rejects frequencies out of range and sums above 1", () => {
    const lines = day("2026-11-16", {
      3: [
        "2026-11-16,3,geography,سؤال؟,أ,,1.4",
        "2026-11-16,3,geography,سؤال؟,ب,,0.6",
        "2026-11-16,3,geography,سؤال؟,ج,,0.5",
      ],
    });
    const msgs = messages(lines);
    expect(msgs).toContain("✖ Row 8: seed_frequency 1.4 must be between 0 and 1.");
    expect(msgs.some((m) => m.includes("add up to 1.100"))).toBe(true);
  });

  it("rejects inconsistent question text across rows", () => {
    const lines = day("2026-11-16", {
      5: [
        "2026-11-16,5,geography,سؤال أول؟,أ,,0.1",
        "2026-11-16,5,geography,سؤال آخر؟,ب,,0.1",
        "2026-11-16,5,geography,سؤال أول؟,ج,,0.1",
      ],
    });
    expect(messages(lines).some((m) => m.startsWith("✖ Row 15:") && m.includes("question_text differs"))).toBe(true);
  });

  it("rejects bad dates and unknown categories", () => {
    const lines = day("2026-11-16");
    lines[0] = "2026-02-30,1,geography,سؤال؟,أ,,0.1";
    lines[1] = "2026-11-16,1,astrology,سؤال؟,ب,,0.1";
    const msgs = messages(lines);
    expect(msgs).toContain('✖ Row 2: date "2026-02-30" must be a real date written YYYY-MM-DD.');
    expect(msgs.some((m) => m.startsWith('✖ Row 3: category "astrology" is unknown'))).toBe(true);
  });

  it("reports missing columns", () => {
    const res = parseContentCsv("date,question_number\n2026-11-16,1\n");
    expect(res.issues.map(formatIssue)[0]).toMatch(/Missing column\(s\): category/);
  });

  it("warns about extra columns but keeps going", () => {
    const res = parseContentCsv([HEADER + ",notes", ...day("2026-11-16").map((l) => l + ",ملاحظة")].join("\n"));
    expect(hasErrors(res.issues)).toBe(false);
    expect(res.issues[0]!.message).toMatch(/notes/);
  });

  it("supports several days and an optional track column", () => {
    const res = parseContentCsv(
      [HEADER + ",track", ...day("2026-11-16").map((l) => l + ","), ...day("2026-11-17").map((l) => l + ",sports")].join("\n"),
    );
    expect(hasErrors(res.issues)).toBe(false);
    expect(res.journeys.map((j) => `${j.date}/${j.track}`)).toEqual(["2026-11-16/daily", "2026-11-17/sports"]);
  });
});
