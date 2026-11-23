import { describe, expect, it } from "vitest";
import { buildSuggestionIndex, suggest } from "./suggest";

const NAMES = [
  "الرياض",
  "الرباط",
  "روما",
  "جدة",
  "القاهرة",
  "الدار البيضاء",
  "دار السلام",
  "عبد العزيز",
  "أبوظبي",
  "إسطنبول",
  "مكة",
  "مكة المكرمة",
  "المدينة المنورة",
  "مسقط",
  "مستغانم",
  "مسيلة",
  "مصراتة",
];
const index = buildSuggestionIndex(NAMES);
const s = (q: string) => suggest(index, q);

describe("suggestions", () => {
  it("waits for two characters", () => {
    expect(s("")).toEqual([]);
    expect(s("ر")).toEqual([]);
    expect(s(" م ")).toEqual([]);
    expect(s("ال")).toEqual([]); // a bare particle says nothing yet
  });

  it("ignores a leading ال, alef forms, ة/ه, ى/ي and diacritics", () => {
    expect(s("ري")).toEqual(["الرياض"]);
    expect(s("الري")).toEqual(["الرياض"]);
    expect(s("الرِّيا")).toEqual(["الرياض"]);
    expect(s("اسط")).toEqual(["إسطنبول"]);
    expect(s("ابوظ")).toEqual(["أبوظبي"]);
    expect(s("قاهره")).toEqual(["القاهرة"]);
    expect(s("جده")).toEqual(["جدة"]);
  });

  it("keeps suggesting while the player is still typing past ال", () => {
    // "الر" normalizes to itself (too short to strip), but means "ر…"
    expect(s("الر")).toEqual(["الرباط", "الرياض", "روما"]);
    expect(s("والرب")).toEqual(["الرباط"]);
  });

  it("ranks the whole name, then the start of a name, then the start of a later word", () => {
    expect(s("مكه")).toEqual(["مكة", "مكة المكرمة"]);
    expect(s("دار")).toEqual(["الدار البيضاء", "دار السلام"]);
    expect(s("بيض")).toEqual(["الدار البيضاء"]);
    expect(s("منور")).toEqual(["المدينة المنورة"]);
    expect(s("مدينه")).toEqual(["المدينة المنورة"]);
    expect(s("عبدالع")).toEqual(["عبد العزيز"]);
    expect(s("مكرم")).toEqual(["مكة المكرمة"]);
  });

  it("returns at most four, alphabetically within a rank", () => {
    expect(s("مس")).toEqual(["مستغانم", "مسقط", "مسيلة"]);
    expect(s("م").length).toBe(0);
    const many = buildSuggestionIndex(["مدى", "مدار", "مدرسة", "مدفع", "مدينة", "مدن"]);
    expect(suggest(many, "مد")).toEqual(["مدار", "مدرسة", "مدفع", "مدن"]);
  });

  it("doesn't depend on the order of the pool (no hidden popularity)", () => {
    const reversed = buildSuggestionIndex([...NAMES].reverse());
    for (const q of ["مس", "الر", "دار", "مكه", "ري"]) expect(suggest(reversed, q)).toEqual(s(q));
  });

  it("shows one entry per spelling, with the alphabetically first name", () => {
    const dup = buildSuggestionIndex(["رياض", "الرياض", "الرياض"]);
    expect(suggest(dup, "ريا")).toEqual(["الرياض"]);
  });

  it("matches nothing for unrelated or Latin input", () => {
    expect(s("طوكيو")).toEqual([]);
    expect(s("ri")).toEqual([]);
  });
});
