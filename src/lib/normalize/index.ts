/**
 * Answer normalizer — turns a player's raw answer (or an accepted canonical /
 * variant) into a matching key. Pure, dependency-free, shared by the app
 * server and the CLI scripts.
 *
 * The same function MUST be applied to both sides (accepted answers at import
 * time, player answers at submit time). If you change the rules, bump
 * NORMALIZER_VERSION and run `npm run rescore -- --renormalize` so stored keys
 * and logged answers are rebuilt.
 */
export const NORMALIZER_VERSION = 1;

/** Zero-width, soft hyphen, Arabic letter mark, bidi controls, BOM. */
const INVISIBLE = /[­؜᠎​-‏‪-‮⁠-⁤⁦-⁩﻿]/g;
/** Every combining mark: Arabic tashkeel (incl. hamza above/below, madda), Latin accents, etc. */
const COMBINING = /\p{M}/gu;
/** Arabic tatweel (kashida) is a letter-modifier, not a mark, so it is removed explicitly. */
const TATWEEL = /ـ/g;
const ARABIC_LETTER = /[؀-ۿݐ-ݿࢠ-ࣿ]/;

/**
 * Letter unification. Hamza-seat letters (أ إ آ ؤ ئ) are already reduced to
 * their base letter by NFD + mark stripping; they are listed here as well so
 * the table documents the full rule set.
 */
const LETTER_MAP: Readonly<Record<string, string>> = {
  // alef family
  "أ": "ا", "إ": "ا", "آ": "ا", "ٱ": "ا", "ٲ": "ا", "ٳ": "ا", "ٵ": "ا",
  // taa marbuta and heh variants (Urdu/Kurdish keyboards)
  "ة": "ه", "ۃ": "ه", "ھ": "ه", "ە": "ه", "ۀ": "ه", "ہ": "ه", "ۂ": "ه",
  // yeh family (alef maqsura, Persian/Urdu yeh, yeh with hamza)
  "ى": "ي", "ی": "ي", "ې": "ي", "ے": "ي", "ۓ": "ي", "ئ": "ي", "ٸ": "ي",
  // waw with hamza
  "ؤ": "و", "ٶ": "و",
  // kaf variants: Persian keheh, swash kaf, gaf (Iraq/Gulf), Maghrebi ng/g
  "ک": "ك", "ڪ": "ك", "گ": "ك", "ڭ": "ك",
  // feh variants: veh (Gulf/Levant), Maghrebi veh / feh
  "ڤ": "ف", "ڥ": "ف", "ڢ": "ف",
  // qaf variants: Algerian/Tunisian gaf, Maghrebi qaf, dotless qaf
  "ڨ": "ق", "ڧ": "ق", "ٯ": "ق",
  // Persian letters used for foreign sounds
  "پ": "ب", "چ": "ج", "ژ": "ز",
};

const LETTER_RE = new RegExp(`[${Object.keys(LETTER_MAP).join("")}]`, "g");

/** Arabic-Indic (U+0660–0669) and Extended/Persian (U+06F0–06F9) digits → 0–9. */
function westernDigits(s: string): string {
  return s.replace(/[٠-٩۰-۹]/g, (d) => {
    const cp = d.codePointAt(0)!;
    return String(cp >= 0x06f0 ? cp - 0x06f0 : cp - 0x0660);
  });
}

function isArabicToken(token: string): boolean {
  return ARABIC_LETTER.test(token.charAt(0));
}

/** Per-word clitic stripping: leading و (conjunction) then leading ال, keeping ≥ 2 letters. */
function stripClitics(token: string): string {
  if (!isArabicToken(token)) return token;
  let t = token;
  if (t.startsWith("و") && t.length - 1 >= 2) t = t.slice(1);
  if (t.startsWith("ال") && t.length - 2 >= 2) t = t.slice(2);
  // Word-final hamza after alef is commonly dropped (صحراء ≡ صحرا).
  if (t.length > 2 && t.endsWith("اء")) t = t.slice(0, -1);
  return t;
}

export function normalizeAnswer(raw: string | null | undefined): string {
  if (typeof raw !== "string" || raw.length === 0) return "";

  let s = raw.normalize("NFKC"); // presentation forms, ligatures (ﻻ ﷲ), full-width Latin
  s = s.replace(INVISIBLE, "");
  s = s.toLowerCase();
  s = s.normalize("NFD").replace(COMBINING, "").replace(TATWEEL, "");
  s = s.replace(LETTER_RE, (ch) => LETTER_MAP[ch] ?? ch);
  s = westernDigits(s);
  // Thousands separators between digits: 1,000 / ١٬٠٠٠ → 1000
  s = s.replace(/(\d)[,٬'](?=\d{3}(?:\D|$))/g, "$1");
  // Everything that is not a letter, digit or whitespace becomes a space.
  s = s.replace(/[^\p{L}\p{N}\s]/gu, " ");

  let tokens = s.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return "";

  // "عبد" + "ال…" are written both joined and split: عبد العزيز ≡ عبدالعزيز.
  const joined: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    const next = tokens[i + 1];
    if (t === "عبد" && next !== undefined && next.startsWith("ال") && next.length > 2) {
      joined.push(t + next);
      i++;
    } else {
      joined.push(t);
    }
  }
  tokens = joined;

  // A lone "و" or "ال" is a detached clitic, unless it is the whole answer.
  if (tokens.length > 1) {
    const kept = tokens.filter((t) => t !== "و" && t !== "ال");
    if (kept.length > 0) tokens = kept;
  }

  return tokens.map(stripClitics).join(" ").normalize("NFC");
}

/** Length in code points (what the fuzzy-match threshold is measured in). */
export function keyLength(key: string): number {
  return Array.from(key).length;
}
