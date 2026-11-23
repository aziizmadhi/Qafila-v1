import { describe, expect, it } from "vitest";
import { normalizeAnswer } from "@/lib/normalize";
import { buildIndex, matchAnswer, withinOneEdit, type AnswerKey } from "./index";

function keys(rows: Record<string, string[]>): AnswerKey[] {
  const out: AnswerKey[] = [];
  for (const [answerId, spellings] of Object.entries(rows)) {
    const seen = new Set<string>();
    for (const s of spellings) {
      const key = normalizeAnswer(s);
      if (!seen.has(key)) out.push({ key, answerId });
      seen.add(key);
    }
  }
  return out;
}

const index = buildIndex(
  keys({
    egypt: ["مصر", "Egypt", "Misr"],
    morocco: ["المغرب", "المملكة المغربية", "Morocco", "Maroc"],
    algeria: ["الجزائر", "Algeria", "Algérie"],
    tunisia: ["تونس", "Tunisia", "Tunisie"],
    mauritania: ["موريتانيا", "Mauritania", "موريتانية"],
    abudhabi: ["أبوظبي", "Abu Dhabi"],
    messi: ["ميسي", "ليونيل ميسي", "Messi"],
    mesut: ["ميسوت أوزيل"],
  }),
);

function m(raw: string) {
  return matchAnswer(normalizeAnswer(raw), index);
}

describe("withinOneEdit", () => {
  it.each([
    ["kitten", "kitten", true],
    ["kitten", "sitten", true], // substitution
    ["kitten", "kittens", true], // insertion
    ["kitten", "kiten", true], // deletion
    ["kitten", "sitting", false],
    ["abc", "cab", false],
    ["موريتانيا", "موريتنيا", true],
    ["", "a", true],
    ["", "ab", false],
  ] as const)("%s vs %s → %s", (a, b, expected) => {
    expect(withinOneEdit(a, b)).toBe(expected);
    expect(withinOneEdit(b, a)).toBe(expected);
  });
});

describe("matchAnswer", () => {
  it("matches canonical spellings exactly", () => {
    expect(m("مصر")).toEqual({ answerId: "egypt", kind: "exact" });
    expect(m("المملكة المغربية")).toEqual({ answerId: "morocco", kind: "exact" });
  });

  it("matches normalized variants exactly", () => {
    expect(m("الْجَزَائِر")).toEqual({ answerId: "algeria", kind: "exact" });
    expect(m("ALGÉRIE")).toEqual({ answerId: "algeria", kind: "exact" });
    expect(m("maroc")).toEqual({ answerId: "morocco", kind: "exact" });
    expect(m("ميسى")).toEqual({ answerId: "messi", kind: "exact" });
  });

  it("accepts a single typo on answers of 5+ characters", () => {
    expect(m("موريتنيا")).toEqual({ answerId: "mauritania", kind: "fuzzy" }); // missing alef
    expect(m("موريطانيا")).toEqual({ answerId: "mauritania", kind: "fuzzy" }); // ت → ط
    expect(m("moroco")).toEqual({ answerId: "morocco", kind: "fuzzy" }); // 1 deletion
    expect(m("morocko")).toEqual({ answerId: "morocco", kind: "fuzzy" }); // 1 substitution
    expect(m("ابو ظبي")).toEqual({ answerId: "abudhabi", kind: "fuzzy" }); // split with a space
  });

  it("does not fuzzy-match short answers", () => {
    expect(m("مصرر")).toBeNull(); // 4 chars
    expect(m("تونز")).toBeNull();
  });

  it("rejects two typos", () => {
    expect(m("موريطنيا")).toBeNull();
  });

  it("rejects a fuzzy match that is ambiguous between two canonicals", () => {
    const amb = buildIndex([
      { key: "سلطان", answerId: "a" },
      { key: "سلطانه", answerId: "b" },
    ]);
    // "سلطانة" normalizes to "سلطانه" → exact b; "سلطا ن" style typo hits both:
    expect(matchAnswer("سلطانا", amb)).toBeNull();
    expect(matchAnswer(normalizeAnswer("سلطانة"), amb)).toEqual({ answerId: "b", kind: "exact" });
  });

  it("allows a fuzzy hit on several keys of the same canonical", () => {
    const idx = buildIndex([
      { key: "ليونيل ميسي", answerId: "messi" },
      { key: "ليونيل ميسى", answerId: "messi" },
    ]);
    expect(matchAnswer("ليونيل ميس", idx)).toEqual({ answerId: "messi", kind: "fuzzy" });
  });

  it("prefers exact over fuzzy", () => {
    // "ميسوت" is within one edit of nothing exact; "ميسي" is exact.
    expect(m("ميسي")?.kind).toBe("exact");
  });

  it("returns null for empty and unknown answers", () => {
    expect(m("")).toBeNull();
    expect(m("   ")).toBeNull();
    expect(m("اليابان")).toBeNull();
  });

  it("refuses an index where one key points at two answers", () => {
    expect(() =>
      buildIndex([
        { key: "x", answerId: "a" },
        { key: "x", answerId: "b" },
      ]),
    ).toThrow();
  });
});
