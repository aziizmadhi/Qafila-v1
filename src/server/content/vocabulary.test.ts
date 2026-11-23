import { describe, expect, it } from "vitest";
import { parseVocabularyCsv } from "./vocabulary";

const CATS = new Set(["geography", "sports"]);

describe("vocabulary CSV", () => {
  it("reads category,name rows with their normalized key", () => {
    const r = parseVocabularyCsv("category,name\ngeography,  الرياض \nsports,الهلال\n\n", CATS);
    expect(r.errors).toEqual([]);
    expect(r.entries).toEqual([
      { row: 2, category: "geography", name: "الرياض", key: "رياض" },
      { row: 3, category: "sports", name: "الهلال", key: "هلال" },
    ]);
  });

  it("reports errors by spreadsheet row", () => {
    const r = parseVocabularyCsv("category,name\nhistory,بغداد\ngeography,\ngeography,؟؟", CATS);
    expect(r.errors).toEqual([
      'Row 2: unknown category "history" (known: geography, sports).',
      "Row 3: the name is empty.",
      'Row 4: "؟؟" has no letters or digits after normalization.',
    ]);
  });

  it("skips spellings that normalize the same, with a warning", () => {
    const r = parseVocabularyCsv("category,name\ngeography,القاهرة\ngeography,القاهره\nsports,القاهرة", CATS);
    expect(r.entries.map((e) => e.row)).toEqual([2, 4]);
    expect(r.warnings).toEqual(['Row 3: "القاهره" is the same as row 2 after normalization; skipped.']);
  });

  it("requires the header", () => {
    expect(parseVocabularyCsv("name,category\nالرياض,geography", CATS).errors[0]).toContain('header must be "category,name"');
  });
});
