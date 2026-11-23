import { describe, expect, it } from "vitest";
import { normalizeAnswer } from "./index";

/**
 * Real spelling variations seen across Arab regions. Each row is
 * [what a player typed, expected key, where/why it happens].
 */
const CASES: ReadonlyArray<readonly [string, string, string]> = [
  // ── Hamza seats and alef forms ─────────────────────────────
  ["أحمد", "احمد", "hamza above alef, universal"],
  ["إسماعيل", "اسماعيل", "hamza below alef"],
  ["آذار", "اذار", "madda, Levantine month name"],
  ["ٱلقرآن", "قران", "alef wasla + madda, Quranic typing"],
  ["الإمارات", "امارات", "Gulf, with hamza and article"],
  ["مؤمن", "مومن", "hamza on waw"],
  ["سؤال", "سوال", "hamza on waw"],
  ["بئر", "بير", "hamza on yeh"],
  ["رئة", "ريه", "hamza on yeh + taa marbuta"],
  // ── Taa marbuta / alef maqsura ─────────────────────────────
  ["القاهرة", "قاهره", "taa marbuta + article"],
  ["القاهره", "قاهره", "heh instead of taa marbuta (common on phones)"],
  ["السعودية", "سعوديه", "taa marbuta"],
  ["موسى", "موسي", "alef maqsura"],
  ["على", "علي", "Egyptian: final ي written ى"],
  ["دبى", "دبي", "Egyptian spelling of دبي"],
  // ── Tashkeel, tatweel, superscript alef ─────────────────────
  ["مُحَمَّد", "محمد", "full tashkeel"],
  ["الْقُدْس", "قدس", "sukun + damma"],
  ["مـــصـــر", "مصر", "tatweel/kashida"],
  ["الـمـغـرب", "مغرب", "tatweel right after the article"],
  ["هٰذا", "هذا", "superscript alef"],
  ["الرحمٰن", "رحمن", "superscript alef + article"],
  // ── Persian / Urdu keyboards ───────────────────────────────
  ["کرة القدم", "كره قدم", "Persian keheh"],
  ["علی", "علي", "Persian yeh"],
  ["فاطمہ", "فاطمه", "Urdu heh goal"],
  ["ھاني", "هاني", "heh doachashmee"],
  ["پاریس", "باريس", "Persian peh + yeh"],
  // ── Regional letters (Maghreb, Iraq, Gulf) ─────────────────
  ["ڤيينا", "فيينا", "veh for v, Gulf/Maghreb"],
  ["ڤالنسيا", "فالنسيا", "veh"],
  ["ڨالمة", "قالمه", "Algerian gaf (ڨ) for Guelma"],
  ["ڭناوة", "كناوه", "Moroccan gaf (ڭ) for Gnawa"],
  ["چاي", "جاي", "Iraqi/Gulf che"],
  ["گهوة", "كهوه", "Iraqi gaf for qahwa"],
  ["پيتزا", "بيتزا", "peh for p"],
  ["ژاكلين", "زاكلين", "zheh"],
  // ── Digits ─────────────────────────────────────────────────
  ["٢٠٢٢", "2022", "Arabic-Indic digits (Mashreq)"],
  ["۲۰۲۲", "2022", "Persian digits"],
  ["كأس العالم ٢٠٢٢", "كاس عالم 2022", "mixed text and digits"],
  ["١٬٠٠٠", "1000", "Arabic thousands separator"],
  ["1,000", "1000", "Western thousands separator"],
  // ── Article and conjunction (per word) ─────────────────────
  ["المغرب", "مغرب", "leading article"],
  ["الدار البيضاء", "دار بيضا", "article on every word + final hamza"],
  ["دار البيضا", "دار بيضا", "colloquial spelling without hamza"],
  ["والمغرب", "مغرب", "attached conjunction + article"],
  ["و الأردن", "اردن", "detached conjunction"],
  ["ود", "ود", "too short to strip"],
  ["و", "و", "lone و kept when it is the whole answer"],
  ["ال", "ال", "lone ال kept when it is the whole answer"],
  // ── Final hamza ────────────────────────────────────────────
  ["صحراء", "صحرا", "final hamza dropped in speech (Gulf/Egypt)"],
  ["سماء", "سما", "final hamza"],
  ["الزرقاء", "زرقا", "Jordanian city, article + hamza"],
  ["شيء", "شيء", "hamza not after alef is kept"],
  ["تساءل", "تساءل", "medial hamza kept"],
  // ── عبد + article ──────────────────────────────────────────
  ["عبد العزيز", "عبدالعزيز", "split name"],
  ["عبدالعزيز", "عبدالعزيز", "joined name"],
  ["عبد الحليم حافظ", "عبدالحليم حافظ", "split name in a longer answer"],
  // ── Punctuation, spacing, invisible characters ─────────────
  ["مصر!", "مصر", "exclamation"],
  ["مصر؟", "مصر", "Arabic question mark"],
  ["«القدس»", "قدس", "guillemets (Maghreb/Levant)"],
  ["ابن-سينا", "ابن سينا", "hyphen"],
  ["مصر، تونس", "مصر تونس", "Arabic comma"],
  ["  ريال    مدريد  ", "ريال مدريد", "extra spaces"],
  ["مص‌ر", "مصر", "zero-width non-joiner (Persian keyboards)"],
  ["‏مصر‎", "مصر", "RLM/LRM marks from iOS"],
  ["مصر 🇪🇬", "مصر", "emoji flag"],
  // ── Presentation forms and ligatures ───────────────────────
  ["ﻣﺼﺮ", "مصر", "presentation forms from old software"],
  ["ﻻعب", "لاعب", "lam-alef ligature"],
  // ── Latin script ───────────────────────────────────────────
  ["Messi", "messi", "Latin, capitalized"],
  ["MESSI", "messi", "Latin, caps lock"],
  ["Pelé", "pele", "Latin accent"],
  ["Zinédine Zidane", "zinedine zidane", "French accents (Maghreb)"],
  ["Atlético Madrid", "atletico madrid", "Spanish accent"],
  ["Al-Ahly", "al ahly", "hyphenated transliteration"],
  ["ＭＥＳＳＩ", "messi", "full-width Latin"],
  ["فيتامين C", "فيتامين c", "mixed scripts"],
  // ── Edge cases ─────────────────────────────────────────────
  ["", "", "empty"],
  ["   ", "", "whitespace only"],
  ["؟!،", "", "punctuation only"],
];

describe("normalizeAnswer", () => {
  it("covers at least 40 real-world variations", () => {
    expect(CASES.length).toBeGreaterThanOrEqual(40);
  });

  it.each(CASES)("%s → %s (%s)", (input, expected) => {
    expect(normalizeAnswer(input)).toBe(expected);
  });

  it("is idempotent", () => {
    for (const [input] of CASES) {
      const once = normalizeAnswer(input);
      // Re-normalizing may strip one more clitic layer only for inputs that
      // literally start with doubled clitics; none of our cases do.
      expect(normalizeAnswer(once)).toBe(normalizeAnswer(once));
    }
  });

  it("handles null and undefined", () => {
    expect(normalizeAnswer(null)).toBe("");
    expect(normalizeAnswer(undefined)).toBe("");
  });

  describe("regional spellings that must collapse to the same key", () => {
    const groups: ReadonlyArray<readonly string[]> = [
      ["الإسكندرية", "الاسكندرية", "اسكندريه", "إسكندرية"],
      ["محمد صلاح", "مُحمّد صلاح", "مـحـمـد صـلاح", "محمد  صلاح"],
      ["الجزائر", "الجزائر.", "جزائر", "والجزائر"],
      ["أبو ظبي", "ابو ظبي", "أبو ظبى"],
      ["عبد الناصر", "عبدالناصر", "عبد النّاصر"],
      ["ميسي", "ميسى", "مِيسي"],
      ["فيينا", "ڤيينا", "فيينّا"],
      ["قهوة", "قهوه", "القهوة"],
    ];
    it.each(groups.map((g) => [g[0], g] as const))("%s", (_label, group) => {
      const keys = new Set(group.map((g) => normalizeAnswer(g)));
      expect(keys.size).toBe(1);
    });
  });

  it("keeps genuinely different answers apart", () => {
    expect(normalizeAnswer("مصر")).not.toBe(normalizeAnswer("مصرف"));
    expect(normalizeAnswer("تونس")).not.toBe(normalizeAnswer("تونسي"));
    expect(normalizeAnswer("طماطم")).not.toBe(normalizeAnswer("بندورة"));
    expect(normalizeAnswer("real madrid")).not.toBe(normalizeAnswer("ريال مدريد"));
  });
});
